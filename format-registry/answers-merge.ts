/**
 * Merges a private, per-project `document-answers.json` into a shared `document-skeleton.json` to
 * produce a complete ProseMirror document, ready for the normal normalize -> validate -> render
 * pipeline.
 *
 * This is the mechanism behind "general vs. private" content: `/formats` holds only shared,
 * reusable structure (locked headings, standing labels, empty fillIn slots); a user's own answers —
 * the actual text they type in — live in a separate JSON file, addressed by the stable
 * `attrs.slotId` each fillIn node carries. Nothing under `/formats` is ever mutated by this;
 * `mergeAnswersIntoSkeleton` returns a brand-new document.
 *
 * An answer's content is either **inline** or **block**, decided by shape, not by any extra flag:
 * - A plain string, or an array whose nodes are all `text` (the base contract's only inline leaf
 *   type), is inline content. It is APPENDED into the fillIn node's existing `content` — never
 *   replaced — so fixed lead-in labels a skeleton already carries (e.g. a structured abstract's
 *   bold "Đặt vấn đề:") survive the merge.
 * - An array containing any non-`text` node (`table`, `image`, `codeBlock`, `bulletList`,
 *   `orderedList`, `blockquote`, `horizontalRule`, `paragraph`, `heading`, …) is block content —
 *   the same vocabulary the editor itself produces, so a user's private answer can be as rich as
 *   anything they could type in a Notion-like editor. Block content is SPLICED IN as new siblings
 *   immediately after the fillIn node, in the same content array, leaving the fillIn node's own
 *   (usually empty) content untouched.
 *
 * A slot with no matching answer keeps its skeleton content unchanged (usually empty).
 */

import type { DocumentAnswers, DocumentSkeleton, PMDoc, PMNode } from '../core/types.js';

export interface AnswersMergeResult {
  doc: PMDoc;
  /** slotIds present on the skeleton with no matching entry in `answers.answers`. */
  unfilledSlots: string[];
  /** Keys in `answers.answers` that don't match any slotId on the skeleton — likely typos. */
  unmatchedAnswers: string[];
}

function answerToContent(value: string | PMNode[]): PMNode[] {
  if (typeof value === 'string') {
    return value.length === 0 ? [] : [{ type: 'text', text: value }];
  }
  return value;
}

/** The base contract's only inline leaf type is `text` — anything else is block content. */
function isInlineOnly(nodes: PMNode[]): boolean {
  return nodes.every((node) => node.type === 'text');
}

function mergeNodeList(
  nodes: PMNode[] | undefined,
  answers: Record<string, string | PMNode[]>,
  matchedSlots: Set<string>,
): PMNode[] | undefined {
  if (!nodes) return nodes;
  const out: PMNode[] = [];

  for (const node of nodes) {
    const attrs = (node.attrs ?? {}) as Record<string, unknown>;
    const mergedContent = mergeNodeList(node.content, answers, matchedSlots);
    const mergedNode = mergedContent === node.content ? node : { ...node, content: mergedContent };

    if (attrs.fillIn !== true || typeof attrs.slotId !== 'string') {
      out.push(mergedNode);
      continue;
    }
    const slotId = attrs.slotId;
    if (!Object.prototype.hasOwnProperty.call(answers, slotId)) {
      out.push(mergedNode);
      continue;
    }

    matchedSlots.add(slotId);
    const answerContent = answerToContent(answers[slotId]!);

    if (answerContent.length === 0 || isInlineOnly(answerContent)) {
      out.push({ ...mergedNode, content: [...(mergedNode.content ?? []), ...answerContent] });
    } else {
      // Block content: keep the fillIn node as-is (its own label/content, if any) and splice the
      // answer's block nodes in as new siblings right after it.
      out.push(mergedNode, ...answerContent);
    }
  }

  return out;
}

/**
 * Pure function: neither `skeleton` nor `answers` is mutated. `answers.formatId` must match
 * `skeleton.formatId` — mismatches are a caller bug, not a data problem to silently paper over.
 */
export function mergeAnswersIntoSkeleton(skeleton: DocumentSkeleton, answers: DocumentAnswers): AnswersMergeResult {
  if (answers.formatId !== skeleton.formatId) {
    throw new Error(
      `document-answers.json is for formatId "${answers.formatId}" but the skeleton is "${skeleton.formatId}"`,
    );
  }

  const allSlotIds = collectSlotIds(skeleton.doc);
  const matchedSlots = new Set<string>();
  const content = mergeNodeList(skeleton.doc.content, answers.answers, matchedSlots);
  const doc: PMDoc = { ...skeleton.doc, content } as PMDoc;

  const unfilledSlots = allSlotIds.filter((slotId) => !matchedSlots.has(slotId));
  const unmatchedAnswers = Object.keys(answers.answers).filter((key) => !allSlotIds.includes(key));

  return { doc, unfilledSlots, unmatchedAnswers };
}

function collectSlotIds(node: PMNode): string[] {
  const attrs = (node.attrs ?? {}) as Record<string, unknown>;
  const slotIds: string[] = [];
  if (attrs.fillIn === true && typeof attrs.slotId === 'string') slotIds.push(attrs.slotId);
  for (const child of node.content ?? []) slotIds.push(...collectSlotIds(child));
  return slotIds;
}
