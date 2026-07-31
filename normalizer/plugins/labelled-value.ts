/**
 * Labelled-value plugin.
 *
 * Covers the many small "one fact, one line" research blocks: a trial registration number, an
 * ethics approval id, a funding statement, a data-availability statement. One implementation
 * registered under several `blockKind`s — the label is data, not code.
 */

import type { IRBlock, PMNode } from '../../core/types.js';
import { ExportEngineError } from '../../core/errors.js';
import type { NormalizeContext } from '../context.js';
import type { BlockPlugin } from './registry.js';
import { sortAttrs } from './checklist-item.js';
import { runsFromInline } from '../marks.js';

export function makeLabelledValuePlugin(blockKind: string, defaultLabel: string, description: string): BlockPlugin {
  return {
    blockKind,
    description,
    transform(node: PMNode, path: string, ctx: NormalizeContext): IRBlock[] {
      const label = typeof node.attrs?.label === 'string' ? node.attrs.label : defaultLabel;
      const explicitValue = node.attrs?.value;
      if (explicitValue !== undefined && typeof explicitValue !== 'string' && typeof explicitValue !== 'number') {
        throw new ExportEngineError('PLUGIN_FAILED', '`value` must be a string or a number', [
          { path, message: `Got ${JSON.stringify(explicitValue)}` },
        ]);
      }

      const inlineRuns = runsFromInline(node.content, path);
      const valueRuns =
        explicitValue !== undefined ? [{ text: String(explicitValue) }] : inlineRuns;

      const attrs: Record<string, unknown> = { blockKind, label };
      if (typeof node.attrs?.sectionId === 'string') attrs.sectionId = node.attrs.sectionId;
      for (const [key, value] of Object.entries(node.attrs ?? {})) {
        if (key === 'id' || key === 'blockKind' || key === 'label' || key === 'value') continue;
        if (value === undefined || value === null) continue;
        attrs[key] = value;
      }

      return [
        {
          id: ctx.ids.resolve(node.attrs?.id),
          type: 'paragraph',
          runs: [{ text: `${label}: `, marks: ['bold'] }, ...valueRuns],
          attrs: sortAttrs(attrs),
        },
      ];
    },
  };
}
