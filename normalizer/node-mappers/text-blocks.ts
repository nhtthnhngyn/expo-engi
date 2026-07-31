/**
 * Mappers for the leaf-ish text blocks: paragraph, heading, codeBlock, horizontalRule, hardBreak.
 */

import type { IRBlock } from '../../core/types.js';
import { ExportEngineError } from '../../core/errors.js';
import type { NodeMapper } from '../context.js';
import { runsFromInline } from '../marks.js';
import { carryAttrs } from './attrs.js';

export const paragraphMapper: NodeMapper = (node, path, ctx) => {
  const block: IRBlock = {
    id: ctx.ids.resolve(node.attrs?.id),
    type: 'paragraph',
    runs: runsFromInline(node.content, path),
  };
  const attrs = carryAttrs(node);
  if (attrs) block.attrs = attrs;
  return [block];
};

export const headingMapper: NodeMapper = (node, path, ctx) => {
  const rawLevel = node.attrs?.level;
  const level = typeof rawLevel === 'number' ? rawLevel : Number(rawLevel);
  if (!Number.isInteger(level) || level < 1 || level > 6) {
    throw new ExportEngineError('MALFORMED_PROSEMIRROR', 'Heading has an invalid `level`', [
      { path, message: `heading.attrs.level must be an integer 1–6, got ${JSON.stringify(rawLevel)}` },
    ]);
  }
  const block: IRBlock = {
    id: ctx.ids.resolve(node.attrs?.id),
    type: 'heading',
    level,
    runs: runsFromInline(node.content, path),
  };
  const attrs = carryAttrs(node, {}, ['level']);
  if (attrs) block.attrs = attrs;
  return [block];
};

export const codeBlockMapper: NodeMapper = (node, path, ctx) => {
  const block: IRBlock = {
    id: ctx.ids.resolve(node.attrs?.id),
    type: 'codeBlock',
    runs: runsFromInline(node.content, path),
  };
  const attrs = carryAttrs(node);
  if (attrs) block.attrs = attrs;
  return [block];
};

export const horizontalRuleMapper: NodeMapper = (node, _path, ctx) => {
  const block: IRBlock = {
    id: ctx.ids.resolve(node.attrs?.id),
    type: 'horizontalRule',
  };
  const attrs = carryAttrs(node);
  if (attrs) block.attrs = attrs;
  return [block];
};

/**
 * A `hardBreak` at block level (rather than inside a paragraph's inline content) becomes an empty
 * paragraph carrying a single break run — no content is dropped.
 */
export const hardBreakMapper: NodeMapper = (node, _path, ctx) => [
  {
    id: ctx.ids.resolve(node.attrs?.id),
    type: 'paragraph',
    runs: [{ text: '', marks: ['break'] }],
  },
];

export const blockquoteMapper: NodeMapper = (node, path, ctx) => {
  const block: IRBlock = {
    id: ctx.ids.resolve(node.attrs?.id),
    type: 'blockquote',
    children: ctx.normalizeNodes(node.content, path),
  };
  const attrs = carryAttrs(node);
  if (attrs) block.attrs = attrs;
  return [block];
};
