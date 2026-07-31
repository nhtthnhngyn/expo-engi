/**
 * Where the registry lives on disk.
 *
 * `/formats` is the published registry — the only thing the export API may read. `/formats-staging`
 * holds in-progress drafts and is never resolvable for export.
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = resolve(here, '..');
export const FORMATS_DIR = join(REPO_ROOT, 'formats');
export const STAGING_DIR = join(REPO_ROOT, 'formats-staging');
export const REGISTRY_FILE = join(FORMATS_DIR, '_registry.json');

/** Splits `report-writing.consort` into its phase and local format id. */
export function splitFormatId(formatId: string): { phaseId: string; localId: string } | null {
  const match = /^([a-z0-9-]+)\.([a-z0-9-]+)$/.exec(formatId);
  if (!match) return null;
  return { phaseId: match[1]!, localId: match[2]! };
}

export function formatDir(formatId: string, root = FORMATS_DIR): string | null {
  const parts = splitFormatId(formatId);
  if (!parts) return null;
  return join(root, parts.phaseId, parts.localId);
}
