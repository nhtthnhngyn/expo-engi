/**
 * List mappers.
 *
 * A list becomes a `list` block whose `attrs.listKind` says bullet or ordered; each item is a
 * `listItem` block whose children are full blocks. Because items hold blocks (not just runs), a
 * table or a nested list inside a list item round-trips with no data loss.
 */

import type { IRBlock, PMNode } from '../../core/types.js';
import { ExportEngineError } from '../../core/errors.js';
import type { NodeMapper, NormalizeContext } from '../context.js';
import { runsFromInline } from '../marks.js';
import { carryAttrs } from './attrs.js';

function listItemBlock(node: PMNode, path: string, ctx: NormalizeContext): IRBlock {
  if (node.type !== 'listItem') {
    throw new ExportEngineError('MALFORMED_PROSEMIRROR', 'List contains a non-`listItem` child', [
      { path, message: `Expected \`listItem\`, got \`${node.type}\`` },
    ]);
  }
  const block: IRBlock = {
    id: ctx.ids.resolve(node.attrs?.id),
    type: 'listItem',
    children: ctx.normalizeNodes(node.content, path),
  };
  const attrs = carryAttrs(node);
  if (attrs) block.attrs = attrs;
  return block;
}

function makeListMapper(listKind: 'bullet' | 'ordered'): NodeMapper {
  return (node, path, ctx) => {
    const children = (node.content ?? []).map((child, index) =>
      listItemBlock(child, `${path}.content[${index}]`, ctx),
    );
    const block: IRBlock = {
      id: ctx.ids.resolve(node.attrs?.id),
      type: 'list',
      children,
      attrs: carryAttrs(node, { listKind }) ?? { listKind },
    };
    return [block];
  };
}

export const bulletListMapper = makeListMapper('bullet');
export const orderedListMapper = makeListMapper('ordered');

/** A bare `listItem` outside any list still normalizes, as a one-item bullet list. */
export const orphanListItemMapper: NodeMapper = (node, path, ctx) => [
  {
    id: ctx.ids.next(),
    type: 'list',
    attrs: { listKind: 'bullet' },
    children: [listItemBlock({ ...node, content: node.content ?? [] }, path, ctx)],
  },
];

/** Exported for tests that need to build an item independently of its list. */
export { listItemBlock, runsFromInline };
