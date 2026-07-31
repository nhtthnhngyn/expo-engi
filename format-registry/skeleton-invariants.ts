/**
 * The one structural invariant a `document-skeleton.json` must hold beyond its JSON Schema: no
 * node is ever marked both `attrs.locked` and `attrs.fillIn` (schema alone can't express
 * "these two boolean attrs are mutually exclusive" across an arbitrarily nested tree).
 *
 * Used everywhere a skeleton is loaded or checked — `loadSkeleton` (so a violation can never even
 * be resolved into a running export), `tools/validate-schemas.ts` (so CI catches it without
 * needing the full test suite), and `publishDraft` (so it can never reach `/formats` from the
 * staging flow either).
 */

import type { PMNode } from '../core/types.js';
import type { ErrorDetail } from '../core/errors.js';

export type SkeletonInvariantViolation = ErrorDetail;

export function checkSkeletonInvariants(doc: { content?: PMNode[] }): SkeletonInvariantViolation[] {
  const violations: SkeletonInvariantViolation[] = [];

  const walk = (nodes: PMNode[] | undefined): void => {
    if (!nodes) return;
    for (const node of nodes) {
      const attrs = (node.attrs ?? {}) as Record<string, unknown>;
      if (attrs.locked === true && attrs.fillIn === true) {
        violations.push({ message: `node ${JSON.stringify(node.attrs)} is marked both locked and fillIn` });
      }
      walk(node.content);
    }
  };

  walk(doc.content);
  return violations;
}
