/**
 * Checks the "general vs. private" claim a config makes via `sharedFormattingWith` (see
 * formats/GENERAL_VS_PRIVATE_NOTES.md) against the sibling config it names — mechanically, not
 * just in prose. `sharedFormattingWith` is otherwise documentation-only (the engine never reads it
 * to render), so nothing previously stopped the two configs from silently drifting apart after an
 * edit to just one of them.
 *
 * A format claiming shared formatting must actually match its named sibling on `page`,
 * `typography`, `headingNumbering`, `citationStyle`, and `pageNumbering` (structural fields —
 * section order/content are expected to differ; that's the whole point of them being separate
 * formats). `styleMap`/`headings` are compared only for keys both configs happen to define, since a
 * "general" format family can still have format-specific block kinds.
 */

import type { FormatConfig } from '../core/types.js';

export interface FormatFamilyProblem {
  message: string;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** `configsById` must include every config referenced by a `sharedFormattingWith`, keyed by formatId. */
export function checkFormatFamilyConsistency(
  configsById: Map<string, FormatConfig>,
): FormatFamilyProblem[] {
  const problems: FormatFamilyProblem[] = [];

  for (const config of configsById.values()) {
    const siblingId = config.sharedFormattingWith;
    if (!siblingId) continue;

    const sibling = configsById.get(siblingId);
    if (!sibling) {
      problems.push({
        message: `${config.formatId} claims sharedFormattingWith "${siblingId}", but no such format is registered`,
      });
      continue;
    }

    const structuralFields = ['page', 'typography', 'headingNumbering', 'citationStyle', 'pageNumbering'] as const;
    for (const field of structuralFields) {
      if (!deepEqual(config[field], sibling[field])) {
        problems.push({
          message: `${config.formatId} claims sharedFormattingWith "${siblingId}" but their "${field}" differ — either the claim is stale or one of them drifted; update GENERAL_VS_PRIVATE_NOTES.md or bring them back in sync`,
        });
      }
    }

    for (const key of Object.keys(config.styleMap)) {
      if (!(key in sibling.styleMap)) continue;
      if (!deepEqual(config.styleMap[key], sibling.styleMap[key])) {
        problems.push({
          message: `${config.formatId} and "${siblingId}" both define styleMap["${key}"] but with different values, despite claiming shared formatting`,
        });
      }
    }
  }

  return problems;
}
