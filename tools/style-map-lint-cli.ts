#!/usr/bin/env tsx
/**
 * `npm run lint:stylemap -- [--format=<formatId>] [--draft=<draftId>]`
 *
 * Runs the style-map lint standalone. With no arguments it lints every published format.
 * All mismatches are reported in one pass so an author fixes them in one round.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ExportEngineError } from '../core/errors.js';
import { FORMATS_DIR, formatDir } from '../format-registry/paths.js';
import { loadConfig, scanFormats } from '../format-registry/resolver.js';
import { lintConfigAgainstTemplate } from '../format-registry/style-map-lint.js';
import { lintDraft } from '../format-registry/publish.js';

function lintPublished(formatId: string): boolean {
  const dir = formatDir(formatId, FORMATS_DIR)!;
  const config = loadConfig(join(dir, 'config.json'));
  const report = lintConfigAgainstTemplate(config, readFileSync(join(dir, config.templateFile)));

  if (report.ok) {
    process.stdout.write(`✓ ${formatId} — ${Object.keys(report.resolved).length} styles resolved\n`);
    return true;
  }
  process.stdout.write(`✗ ${formatId} — ${report.issues.length} problem(s)\n`);
  for (const issue of report.issues) {
    const suggestion = issue.didYouMean.length > 0 ? ` (did you mean: ${issue.didYouMean.join(', ')}?)` : '';
    process.stdout.write(`    ${issue.key}: "${issue.requested}" not in template${suggestion}\n`);
  }
  return false;
}

function main(): void {
  const args = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const match = /^--([a-zA-Z]+)=(.*)$/.exec(arg);
    if (match) args.set(match[1]!, match[2]!);
  }

  const draftId = args.get('draft');
  if (draftId) {
    const report = lintDraft(draftId);
    process.stdout.write(
      report.ok
        ? `✓ draft ${draftId} — every styleMap entry exists in its template\n`
        : `✗ draft ${draftId} — ${report.issues.length} problem(s)\n`,
    );
    for (const issue of report.issues) process.stdout.write(`    ${issue.message}\n`);
    if (!report.ok) process.exitCode = 1;
    return;
  }

  const single = args.get('format');
  const formatIds = single ? [single] : scanFormats(FORMATS_DIR).map((entry) => entry.formatId);

  let failures = 0;
  for (const formatId of formatIds) {
    if (!lintPublished(formatId)) failures += 1;
  }

  process.stdout.write(`\n${formatIds.length - failures}/${formatIds.length} format(s) passed the style-map lint.\n`);
  if (failures > 0) process.exitCode = 1;
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
