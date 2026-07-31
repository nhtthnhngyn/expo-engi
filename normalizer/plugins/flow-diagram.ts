/**
 * Flow-diagram plugins (CONSORT participant flow, PRISMA study-selection flow).
 *
 * A flow diagram authored as an image becomes a `figure` block plus a caption paragraph. A flow
 * diagram authored as structured stages becomes a single-column `table` (one row per stage) plus
 * the same caption paragraph — so a format whose template has no image support still renders the
 * real content instead of a hole.
 */

import type { IRBlock, PMNode } from '../../core/types.js';
import { ExportEngineError } from '../../core/errors.js';
import type { NormalizeContext } from '../context.js';
import type { BlockPlugin } from './registry.js';
import { sortAttrs } from './checklist-item.js';

interface Stage {
  label: string;
  count?: number | string;
}

function readStages(node: PMNode, path: string): Stage[] {
  const raw = node.attrs?.stages;
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new ExportEngineError('PLUGIN_FAILED', '`stages` must be an array', [
      { path, message: `Got ${JSON.stringify(raw)}` },
    ]);
  }
  return raw.map((entry, index) => {
    const stage = entry as Record<string, unknown>;
    const label = stage?.label;
    if (typeof label !== 'string' || label.length === 0) {
      throw new ExportEngineError('PLUGIN_FAILED', 'Every flow-diagram stage needs a `label`', [
        { path: `${path}.attrs.stages[${index}]`, message: 'Missing string `label`' },
      ]);
    }
    const count = stage.count;
    return typeof count === 'number' || typeof count === 'string' ? { label, count } : { label };
  });
}

export function makeFlowDiagramPlugin(blockKind: string, description: string): BlockPlugin {
  return {
    blockKind,
    description,
    transform(node: PMNode, path: string, ctx: NormalizeContext): IRBlock[] {
      const src = node.attrs?.src;
      const caption = typeof node.attrs?.caption === 'string' ? node.attrs.caption : '';
      const stages = readStages(node, path);

      if (typeof src !== 'string' && stages.length === 0) {
        throw new ExportEngineError(
          'PLUGIN_FAILED',
          'A flow diagram needs either `attrs.src` (an image) or `attrs.stages`',
          [{ path, message: 'Neither `src` nor `stages` was provided' }],
        );
      }

      const out: IRBlock[] = [];
      const baseAttrs: Record<string, unknown> = { blockKind };
      if (typeof node.attrs?.sectionId === 'string') baseAttrs.sectionId = node.attrs.sectionId;

      if (typeof src === 'string' && src.length > 0) {
        out.push({
          id: ctx.ids.resolve(node.attrs?.id),
          type: 'figure',
          attrs: sortAttrs({ ...baseAttrs, src, alt: caption || blockKind }),
        });
      } else {
        out.push({
          id: ctx.ids.resolve(node.attrs?.id),
          type: 'table',
          attrs: sortAttrs(baseAttrs),
          children: stages.map((stage) => ({
            id: ctx.ids.next(),
            type: 'tableRow' as const,
            children: [
              {
                id: ctx.ids.next(),
                type: 'tableCell' as const,
                attrs: { colspan: 1, rowspan: 1 },
                children: [
                  {
                    id: ctx.ids.next(),
                    type: 'paragraph' as const,
                    runs: [
                      {
                        text: stage.count === undefined ? stage.label : `${stage.label} (n = ${stage.count})`,
                      },
                    ],
                  },
                ],
              },
            ],
          })),
        });
      }

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
}
