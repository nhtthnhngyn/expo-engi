/**
 * Role-based access control for exports.
 *
 * Authentication is the gateway's job — by the time a request reaches this service the caller's
 * identity and role are already established. What this module does is *authorization*: may this
 * role export this phase?
 *
 * The policy is a data table. A new phase does not need code here; it needs a row.
 */

import { ExportEngineError } from '../core/errors.js';

export type Role =
  | 'owner'
  | 'principal-investigator'
  | 'statistician'
  | 'coordinator'
  | 'data-manager'
  | 'contributor'
  | 'viewer';

export interface RolePolicy {
  /** Phases this role may export. `'*'` means every phase, including phases added later. */
  exportPhases: '*' | string[];
}

export const ROLE_POLICIES: Readonly<Record<Role, RolePolicy>> = Object.freeze({
  owner: { exportPhases: '*' },
  'principal-investigator': { exportPhases: '*' },
  statistician: {
    exportPhases: ['data-processing', 'stat-analysis', 'report-writing'],
  },
  coordinator: {
    exportPhases: ['protocol-design', 'data-collection'],
  },
  'data-manager': {
    exportPhases: ['data-collection', 'data-processing'],
  },
  contributor: {
    exportPhases: ['protocol-design', 'report-writing'],
  },
  viewer: { exportPhases: [] },
});

export function isKnownRole(role: string): role is Role {
  return Object.prototype.hasOwnProperty.call(ROLE_POLICIES, role);
}

export function canExportPhase(role: string, phaseId: string): boolean {
  if (!isKnownRole(role)) return false;
  const policy = ROLE_POLICIES[role];
  return policy.exportPhases === '*' || policy.exportPhases.includes(phaseId);
}

export function assertCanExportPhase(role: string, phaseId: string, formatId: string): void {
  if (canExportPhase(role, phaseId)) return;
  throw new ExportEngineError(
    'FORBIDDEN',
    `Role "${role}" may not export ${phaseId} documents`,
    [
      {
        message: isKnownRole(role)
          ? `"${role}" has export permission for: ${ROLE_POLICIES[role].exportPhases === '*' ? 'every phase' : (ROLE_POLICIES[role].exportPhases as string[]).join(', ') || '(no phases)'}`
          : `"${role}" is not a role this project model recognises`,
        role,
        phaseId,
        formatId,
      },
    ],
  );
}
