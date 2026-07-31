/**
 * Checklist-item plugins (CONSORT / STROBE / PRISMA items, and any future checklist).
 *
 * One implementation, registered under several `blockKind`s. The item number is carried through
 * verbatim in `attrs.checklistNo` — never regenerated — so real-world numbering with gaps and
 * suffixes ("4a", "4b", "13a") survives to the page exactly as authored.
 */

import type { IRBlock, PMNode } from '../../core/types.js';
import { ExportEngineError } from '../../core/errors.js';
import type { NormalizeContext } from '../context.js';
import { runsFromInline } from '../marks.js';
import type { BlockPlugin } from './registry.js';

export function makeChecklistItemPlugin(blockKind: string, description: string): BlockPlugin {
  return {
    blockKind,
    description,
    transform(node: PMNode, path: string, ctx: NormalizeContext): IRBlock[] {
      const checklistNo = node.attrs?.checklistNo;
      if (checklistNo !== undefined && typeof checklistNo !== 'string' && typeof checklistNo !== 'number') {
        throw new ExportEngineError('PLUGIN_FAILED', '`checklistNo` must be a string or a number', [
          { path, message: `Got ${JSON.stringify(checklistNo)}` },
        ]);
      }

      const attrs: Record<string, unknown> = { blockKind };
      if (checklistNo !== undefined) attrs.checklistNo = String(checklistNo);
      for (const [key, value] of Object.entries(node.attrs ?? {})) {
        if (key === 'id' || key === 'blockKind' || key === 'checklistNo') continue;
        if (value === undefined || value === null) continue;
        attrs[key] = value;
      }

      // An item is either inline text (the common case) or block content (a nested list of
      // sub-items). Never both, so nothing is emitted twice.
      const content = node.content ?? [];
      const isInlineOnly = content.every((child) => child.type === 'text' || child.type === 'hardBreak');

      const block: IRBlock = {
        id: ctx.ids.resolve(node.attrs?.id),
        type: 'checklistItem',
        attrs: sortAttrs(attrs),
      };
      if (isInlineOnly) {
        block.runs = runsFromInline(content, path);
      } else {
        block.runs = [];
        block.children = ctx.normalizeNodes(content, path);
      }
      return [block];
    },
  };
}

export function sortAttrs(attrs: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(attrs).sort()) out[key] = attrs[key];
  return out;
}
