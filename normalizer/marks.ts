/**
 * Inline content -> IR runs.
 *
 * Marks are flattened to strings so the IR stays JSON-primitive: simple marks keep their name
 * (`bold`), parameterised marks use `name:value` (`link:https://…`). Overlapping marks on one text
 * node land on a single run, in the order ProseMirror recorded them.
 */

import type { IRRun, PMMark, PMNode } from '../core/types.js';
import { ExportEngineError } from '../core/errors.js';

/** Marks whose value comes from an attribute rather than from the mark name alone. */
const PARAMETERISED: Record<string, string> = {
  link: 'href',
  footnote: 'text',
  citation: 'key',
};

export function markToString(mark: PMMark, path: string): string {
  // A bare string is shorthand for a mark with no attrs (e.g. "bold" === { type: "bold" }).
  if (typeof mark === 'string') {
    if (mark.length === 0) {
      throw new ExportEngineError('MALFORMED_PROSEMIRROR', 'Mark is an empty string', [
        { path, message: 'A bare-string mark must be a non-empty type name' },
      ]);
    }
    return mark;
  }
  if (typeof mark?.type !== 'string' || mark.type.length === 0) {
    throw new ExportEngineError('MALFORMED_PROSEMIRROR', 'Mark is missing a `type`', [
      { path, message: 'Every mark must have a string `type`' },
    ]);
  }
  const attrKey = PARAMETERISED[mark.type];
  if (!attrKey) return mark.type;
  const raw = mark.attrs?.[attrKey];
  const value = typeof raw === 'string' ? raw : '';
  return `${mark.type}:${value}`;
}

/**
 * Converts a node's inline children into runs. Non-text inline nodes that carry no content of their
 * own (`hardBreak`) become zero-length runs marked with their kind, so the renderer can emit the
 * right Word primitive without the IR needing a Word concept.
 */
export function runsFromInline(content: PMNode[] | undefined, path: string): IRRun[] {
  if (!content || content.length === 0) return [];
  const runs: IRRun[] = [];

  content.forEach((child, index) => {
    const childPath = `${path}.content[${index}]`;
    if (typeof child?.type !== 'string') {
      throw new ExportEngineError('MALFORMED_PROSEMIRROR', 'Inline node is missing a `type`', [
        { path: childPath, message: 'Every node must have a string `type`' },
      ]);
    }

    if (child.type === 'text') {
      if (typeof child.text !== 'string') {
        throw new ExportEngineError('MALFORMED_PROSEMIRROR', 'Text node is missing `text`', [
          { path: childPath, message: 'A `text` node must carry a string `text` property' },
        ]);
      }
      const marks = (child.marks ?? []).map((m, i) => markToString(m, `${childPath}.marks[${i}]`));
      runs.push(marks.length > 0 ? { text: child.text, marks } : { text: child.text });
      return;
    }

    if (child.type === 'hardBreak') {
      runs.push({ text: '', marks: ['break'] });
      return;
    }

    // Anything else appearing inline (e.g. an inline image) keeps its text content, if any, so no
    // data is lost on the way to the IR.
    const nested = runsFromInline(child.content, childPath);
    runs.push(...nested);
  });

  return runs;
}
