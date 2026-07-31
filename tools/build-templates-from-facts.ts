#!/usr/bin/env tsx
/**
 * Builds `template.dotx` for every format that has a `template-facts.json` on disk — the real style
 * facts extract-research-format extracts from an uploaded reference document. Run alongside
 * `make-templates.ts` via `npm run build:templates`. Output is byte-deterministic, so re-running
 * with no facts change produces no git diff.
 */

import { FORMATS_DIR } from '../format-registry/paths.js';
import { buildTemplatesFromFacts } from './template-from-facts.js';
import { ExportEngineError } from '../core/errors.js';

function main(): void {
  const { written, unchanged } = buildTemplatesFromFacts(FORMATS_DIR);
  for (const path of written) process.stdout.write(`wrote ${path}\n`);
  process.stdout.write(`\n${written.length} template(s) built from facts, ${unchanged.length} unchanged.\n`);
}

try {
  main();
} catch (err) {
  if (ExportEngineError.is(err)) {
    process.stderr.write(`${err.code}: ${err.message}\n`);
    for (const detail of err.details) process.stderr.write(`  - ${detail.message}\n`);
  } else {
    process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  }
  process.exitCode = 1;
}
