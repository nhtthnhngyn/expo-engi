/**
 * Table mappers.
 *
 * Merged cells are carried as `attrs.colspan` / `attrs.rowspan` on the cell block; header cells are
 * flagged with `attrs.header`. Cell children are full blocks, so a list (or another table) inside a
 * cell survives normalization intact.
 */

import type { IRBlock, PMNode } from '../../core/types.js';
import { ExportEngineError } from '../../core/errors.js';
import type { NodeMapper, NormalizeContext } from '../context.js';
import { carryAttrs } from './attrs.js';

function toInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function cellBlock(node: PMNode, path: string, ctx: NormalizeContext): IRBlock {
  if (node.type !== 'tableCell' && node.type !== 'tableHeader') {
    throw new ExportEngineError('MALFORMED_PROSEMIRROR', 'Table row contains a non-cell child', [
      { path, message: `Expected \`tableCell\` or \`tableHeader\`, got \`${node.type}\`` },
    ]);
  }
  const extra: Record<string, unknown> = {
    colspan: toInt(node.attrs?.colspan, 1),
    rowspan: toInt(node.attrs?.rowspan, 1),
  };
  if (node.type === 'tableHeader') extra.header = true;

  return {
    id: ctx.ids.resolve(node.attrs?.id),
    type: 'tableCell',
    children: ctx.normalizeNodes(node.content, path),
    attrs: carryAttrs(node, extra)!,
  };
}

function rowBlock(node: PMNode, path: string, ctx: NormalizeContext): IRBlock {
  if (node.type !== 'tableRow') {
    throw new ExportEngineError('MALFORMED_PROSEMIRROR', 'Table contains a non-`tableRow` child', [
      { path, message: `Expected \`tableRow\`, got \`${node.type}\`` },
    ]);
  }
  const block: IRBlock = {
    id: ctx.ids.resolve(node.attrs?.id),
    type: 'tableRow',
    children: (node.content ?? []).map((cell, index) => cellBlock(cell, `${path}.content[${index}]`, ctx)),
  };
  const attrs = carryAttrs(node);
  if (attrs) block.attrs = attrs;
  return block;
}

export const tableMapper: NodeMapper = (node, path, ctx) => {
  const block: IRBlock = {
    id: ctx.ids.resolve(node.attrs?.id),
    type: 'table',
    children: (node.content ?? []).map((row, index) => rowBlock(row, `${path}.content[${index}]`, ctx)),
  };
  const attrs = carryAttrs(node);
  if (attrs) block.attrs = attrs;
  return [block];
};
