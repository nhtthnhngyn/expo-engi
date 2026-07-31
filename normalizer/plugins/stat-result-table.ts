/**
 * Statistical-result table plugin (statistical-analysis phase).
 *
 * Turns a structured result set (`columns` + `rows`) into an IR table with a header row, plus an
 * optional caption paragraph. Cell values are stringified verbatim — no rounding, no locale
 * formatting — because a stats table that silently reformats numbers is a correctness bug.
 */

import type { IRBlock, PMNode } from '../../core/types.js';
import { ExportEngineError } from '../../core/errors.js';
import type { NormalizeContext } from '../context.js';
import type { BlockPlugin } from './registry.js';
import { sortAttrs } from './checklist-item.js';

export const statResultTablePlugin: BlockPlugin = {
  blockKind: 'statResultTable',
  description: 'A statistical result table: header columns plus result rows, with an optional caption.',
  transform(node: PMNode, path: string, ctx: NormalizeContext): IRBlock[] {
    const columns = node.attrs?.columns;
    const rows = node.attrs?.rows;
    if (!Array.isArray(columns) || columns.length === 0) {
      throw new ExportEngineError('PLUGIN_FAILED', 'A `statResultTable` needs a non-empty `columns` array', [
        { path, message: `attrs.columns was ${JSON.stringify(columns)}` },
      ]);
    }
    if (!Array.isArray(rows)) {
      throw new ExportEngineError('PLUGIN_FAILED', 'A `statResultTable` needs a `rows` array', [
        { path, message: `attrs.rows was ${JSON.stringify(rows)}` },
      ]);
    }

    const caption = typeof node.attrs?.caption === 'string' ? node.attrs.caption : '';
    const tableNumber = node.attrs?.tableNumber;
    if (tableNumber !== undefined && typeof tableNumber !== 'string' && typeof tableNumber !== 'number') {
      throw new ExportEngineError('PLUGIN_FAILED', '`tableNumber` must be a string or a number', [
        { path, message: `Got ${JSON.stringify(tableNumber)}` },
      ]);
    }
    const baseAttrs: Record<string, unknown> = { blockKind: 'statResultTable' };
    if (tableNumber !== undefined) baseAttrs.tableNumber = String(tableNumber);
    if (typeof node.attrs?.sectionId === 'string') baseAttrs.sectionId = node.attrs.sectionId;

    const headerRow: IRBlock = {
      id: ctx.ids.next(),
      type: 'tableRow',
      children: (columns as unknown[]).map((column) => cell(ctx, String(column), true)),
    };

    const bodyRows: IRBlock[] = (rows as unknown[]).map((row) => ({
      id: ctx.ids.next(),
      type: 'tableRow',
      children: (Array.isArray(row) ? row : [row]).map((value) => cell(ctx, String(value), false)),
    }));

    const out: IRBlock[] = [
      {
        id: ctx.ids.resolve(node.attrs?.id),
        type: 'table',
        attrs: sortAttrs(baseAttrs),
        children: [headerRow, ...bodyRows],
      },
    ];

    if (caption.length > 0) {
      out.push({
        id: ctx.ids.next(),
        type: 'paragraph',
        runs: [{ text: caption }],
        attrs: sortAttrs({ ...baseAttrs, role: 'caption' }),
      });
    }

    return out;
  },
};

function cell(ctx: NormalizeContext, text: string, header: boolean): IRBlock {
  return {
    id: ctx.ids.next(),
    type: 'tableCell',
    attrs: header ? { colspan: 1, header: true, rowspan: 1 } : { colspan: 1, rowspan: 1 },
    children: [{ id: ctx.ids.next(), type: 'paragraph', runs: [{ text }] }],
  };
}
