/**
 * Attribute carry-over.
 *
 * The IR keeps every authored attribute except `id` (which is lifted to the block's own `id`), so
 * nothing a phase put on a node is lost on the way through. Keys are emitted in sorted order so
 * serialised IR is stable input for the renderer.
 */

import type { PMNode } from '../../core/types.js';

const LIFTED = new Set(['id']);

export function carryAttrs(
  node: PMNode,
  extra: Record<string, unknown> = {},
  exclude: readonly string[] = [],
): Record<string, unknown> | undefined {
  const skip = new Set([...LIFTED, ...exclude]);
  const merged: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node.attrs ?? {})) {
    if (skip.has(key)) continue;
    if (value === undefined || value === null) continue;
    merged[key] = value;
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined || value === null) continue;
    merged[key] = value;
  }
  const keys = Object.keys(merged).sort();
  if (keys.length === 0) return undefined;
  const sorted: Record<string, unknown> = {};
  for (const key of keys) sorted[key] = merged[key];
  return sorted;
}
