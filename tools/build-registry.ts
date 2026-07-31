#!/usr/bin/env tsx
/**
 * Regenerates `/formats/_registry.json` from what is actually on disk.
 *
 * The index is generated, never hand-edited — that is what keeps it honest. `npm test` fails if the
 * committed index and the folder tree disagree.
 */

import { writeFileSync } from 'node:fs';
import { FORMATS_DIR, REGISTRY_FILE } from '../format-registry/paths.js';
import { scanFormats } from '../format-registry/resolver.js';

function main(): void {
  const entries = scanFormats(FORMATS_DIR);
  writeFileSync(REGISTRY_FILE, `${JSON.stringify(entries, null, 2)}\n`);
  process.stdout.write(`Wrote ${entries.length} entries to ${REGISTRY_FILE}\n`);
  for (const entry of entries) {
    process.stdout.write(`  ${entry.formatId.padEnd(34)} ${entry.version}  ${entry.status}\n`);
  }
}

main();
