/**
 * Section ordering.
 *
 * A format config declares the order its sections must appear in (`sectionOrder`). The IR carries
 * whatever order the author happened to write in. This module reconciles the two.
 *
 * Rules — generic, and identical for every format:
 *  1. A block with `attrs.sectionId` opens (or continues) that section.
 *  2. A block without one inherits the section currently open, so a heading's body travels with it.
 *  3. Blocks appearing before any section is opened form the implicit preamble and stay first.
 *  4. Sections named in `sectionOrder` render in that order. Sections not named render after them,
 *     in first-appearance order — so an unlisted section is never silently dropped.
 *  5. Within a section, original document order is preserved.
 */

import type { IRBlock } from '../core/types.js';

export const PREAMBLE = '__preamble__';

export interface OrderedSection {
  sectionId: string;
  blocks: IRBlock[];
  /** True when the section is not named in the config's `sectionOrder`. */
  unlisted: boolean;
}

export function groupBySection(blocks: IRBlock[]): Map<string, IRBlock[]> {
  const groups = new Map<string, IRBlock[]>();
  let current = PREAMBLE;

  for (const block of blocks) {
    const sectionId = block.attrs?.sectionId;
    if (typeof sectionId === 'string' && sectionId.length > 0) current = sectionId;
    const bucket = groups.get(current);
    if (bucket) bucket.push(block);
    else groups.set(current, [block]);
  }

  return groups;
}

export function orderSections(blocks: IRBlock[], sectionOrder: string[]): OrderedSection[] {
  const groups = groupBySection(blocks);
  const out: OrderedSection[] = [];
  const consumed = new Set<string>();

  const preamble = groups.get(PREAMBLE);
  if (preamble && preamble.length > 0) {
    out.push({ sectionId: PREAMBLE, blocks: preamble, unlisted: false });
    consumed.add(PREAMBLE);
  }

  for (const sectionId of sectionOrder) {
    const bucket = groups.get(sectionId);
    if (!bucket || consumed.has(sectionId)) continue;
    out.push({ sectionId, blocks: bucket, unlisted: false });
    consumed.add(sectionId);
  }

  for (const [sectionId, bucket] of groups) {
    if (consumed.has(sectionId)) continue;
    out.push({ sectionId, blocks: bucket, unlisted: true });
  }

  return out;
}

/** The flat block list in final render order. */
export function orderBlocks(blocks: IRBlock[], sectionOrder: string[]): IRBlock[] {
  return orderSections(blocks, sectionOrder).flatMap((section) => section.blocks);
}
