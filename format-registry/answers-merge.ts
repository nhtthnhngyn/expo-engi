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
 * Merge is APPEND, not REPLACE: a fillIn node's existing `content` (e.g. a structured abstract's
 * fixed bold lead-in labels) is preserved, and the answer's content is appended after it. A slot
 * with no matching answer keeps its skeleton content unchanged (usually empty).
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

function mergeNode(node: PMNode, answers: Record<string, string | PMNode[]>, matchedSlots: Set<string>): PMNode {
  const attrs = (node.attrs ?? {}) as Record<string, unknown>;
  const content = node.content ? node.content.map((child) => mergeNode(child, answers, matchedSlots)) : node.content;

  if (attrs.fillIn === true && typeof attrs.slotId === 'string') {
    const slotId = attrs.slotId;
    if (Object.prototype.hasOwnProperty.call(answers, slotId)) {
      matchedSlots.add(slotId);
      const answerContent = answerToContent(answers[slotId]!);
      return { ...node, content: [...(content ?? []), ...answerContent] };
    }
  }

  return content === node.content ? node : { ...node, content };
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
  const doc = mergeNode(skeleton.doc, answers.answers, matchedSlots) as PMDoc;

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
