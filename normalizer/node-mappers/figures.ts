/**
 * Image -> figure.
 *
 * The IR block is `figure`; the caption lives in `runs` (pure content). How that caption is styled,
 * numbered, or positioned is the renderer's business, driven by the format config.
 */

import type { IRBlock } from '../../core/types.js';
import { ExportEngineError } from '../../core/errors.js';
import type { NodeMapper } from '../context.js';
import { carryAttrs } from './attrs.js';

export const imageMapper: NodeMapper = (node, path, ctx) => {
  const src = node.attrs?.src;
  if (typeof src !== 'string' || src.length === 0) {
    throw new ExportEngineError('MALFORMED_PROSEMIRROR', 'Image node is missing `attrs.src`', [
      { path, message: 'An `image` node must carry a non-empty string `attrs.src`' },
    ]);
  }
  const caption = typeof node.attrs?.caption === 'string' ? node.attrs.caption : '';
  const block: IRBlock = {
    id: ctx.ids.resolve(node.attrs?.id),
    type: 'figure',
    attrs: carryAttrs(node)!,
  };
  if (caption.length > 0) block.runs = [{ text: caption }];
  return [block];
};
