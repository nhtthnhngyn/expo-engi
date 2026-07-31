/**
 * Entitlement (paid-tier) gating.
 *
 * A format declares the tier it needs in `entitlement.tier`; the project carries the tier it has.
 * A free-tier project asking for a paid format is rejected with an actionable error naming the
 * format — never a silent failure or a blank document.
 */

import { ExportEngineError } from '../core/errors.js';
import type { FormatMeta } from '../core/types.js';

export type Tier = 'free' | 'paid';

const TIER_RANK: Record<Tier, number> = { free: 0, paid: 1 };

export function isEntitled(projectTier: string, meta: Pick<FormatMeta, 'entitlement'>): boolean {
  const required = meta.entitlement?.tier ?? 'free';
  const held = (projectTier as Tier) in TIER_RANK ? (projectTier as Tier) : 'free';
  return TIER_RANK[held] >= TIER_RANK[required];
}

export function assertEntitled(
  projectTier: string,
  meta: Pick<FormatMeta, 'entitlement' | 'formatId'>,
  displayName: string,
): void {
  if (isEntitled(projectTier, meta)) return;
  const required = meta.entitlement?.tier ?? 'free';
  throw new ExportEngineError('ENTITLEMENT_REQUIRED', `"${displayName}" requires the ${required} tier`, [
    {
      message: `This project is on the "${projectTier}" tier; exporting "${meta.formatId}" requires "${required}".`,
      formatId: meta.formatId,
      requiredTier: required,
      projectTier,
    },
  ]);
}
