/**
 * CRF field plugin (data-collection phase).
 *
 * A case-report-form field becomes a two-column table row: the prompt on the left, the answer
 * space on the right. Option lists are rendered into the answer cell so a printed CRF is usable.
 */

import type { IRBlock, PMNode } from '../../core/types.js';
import { ExportEngineError } from '../../core/errors.js';
import type { NormalizeContext } from '../context.js';
import type { BlockPlugin } from './registry.js';
import { sortAttrs } from './checklist-item.js';

const ANSWER_PLACEHOLDER: Record<string, string> = {
  text: '____________________',
  number: '__________',
  date: '__ / __ / ____',
  boolean: '☐ Yes   ☐ No',
};

export const crfFieldPlugin: BlockPlugin = {
  blockKind: 'crfField',
  description: 'A single case-report-form field: prompt, field type, and answer space.',
  transform(node: PMNode, path: string, ctx: NormalizeContext): IRBlock[] {
    const fieldName = node.attrs?.fieldName;
    if (typeof fieldName !== 'string' || fieldName.length === 0) {
      throw new ExportEngineError('PLUGIN_FAILED', 'A `crfField` needs a `fieldName`', [
        { path, message: 'Missing string `attrs.fieldName`' },
      ]);
    }
    const fieldType = typeof node.attrs?.fieldType === 'string' ? node.attrs.fieldType : 'text';
    const required = node.attrs?.required === true;
    const options = Array.isArray(node.attrs?.options)
      ? (node.attrs.options as unknown[]).map((o) => String(o))
      : [];

    const prompt = required ? `${fieldName} *` : fieldName;
    const answer = options.length > 0 ? options.map((o) => `☐ ${o}`).join('   ') : (ANSWER_PLACEHOLDER[fieldType] ?? ANSWER_PLACEHOLDER.text!);

    const fieldNumber = node.attrs?.fieldNumber;
    if (fieldNumber !== undefined && typeof fieldNumber !== 'string' && typeof fieldNumber !== 'number') {
      throw new ExportEngineError('PLUGIN_FAILED', '`fieldNumber` must be a string or a number', [
        { path, message: `Got ${JSON.stringify(fieldNumber)}` },
      ]);
    }

    const attrs = sortAttrs({
      blockKind: 'crfField',
      fieldName,
      fieldType,
      required,
      ...(fieldNumber !== undefined ? { fieldNumber: String(fieldNumber) } : {}),
      ...(typeof node.attrs?.sectionId === 'string' ? { sectionId: node.attrs.sectionId } : {}),
    });

    return [
      {
        id: ctx.ids.resolve(node.attrs?.id),
        type: 'table',
        attrs,
        children: [
          {
            id: ctx.ids.next(),
            type: 'tableRow',
            children: [
              cell(ctx, prompt),
              cell(ctx, answer),
            ],
          },
        ],
      },
    ];
  },
};

function cell(ctx: NormalizeContext, text: string): IRBlock {
  return {
    id: ctx.ids.next(),
    type: 'tableCell',
    attrs: { colspan: 1, rowspan: 1 },
    children: [{ id: ctx.ids.next(), type: 'paragraph', runs: [{ text }] }],
  };
}
