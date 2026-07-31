#!/usr/bin/env tsx
/**
 * `npm run extract:outline -- --source=<file.docx|file.pdf> [--out=extraction-outline.json]`
 *
 * Step 1 of Path B onboarding. Reports the structure of a reference document so a human author does
 * not have to transcribe style names by hand. It writes nothing but the outline, and the outline
 * contains no configuration decisions.
 */

import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { ExportEngineError } from '../core/errors.js';
import { extractOutline, writeOutline } from '../template-extraction/index.js';

function main(): void {
  const args = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const match = /^--([a-zA-Z]+)=(.*)$/.exec(arg);
    if (match) args.set(match[1]!, match[2]!);
  }

  const source = args.get('source');
  if (!source) {
    process.stderr.write('Usage: npm run extract:outline -- --source=<file.docx|file.pdf> [--out=<path>]\n');
    process.exitCode = 1;
    return;
  }

  const path = resolve(process.cwd(), source);
  const outline = extractOutline(readFileSync(path), basename(path));
  const outPath = resolve(process.cwd(), args.get('out') ?? 'extraction-outline.json');
  writeOutline(outline, outPath);

  process.stdout.write(`Extracted structure from ${basename(path)} (${outline.source.kind})\n`);
  process.stdout.write(`  styles           ${outline.styles.length}\n`);
  process.stdout.write(`  numbering defs   ${outline.numbering.length}\n`);
  process.stdout.write(`  headings         ${outline.headingOutline.length}\n`);
  process.stdout.write(`  tables           ${outline.tables.length}\n`);
  process.stdout.write(`  headers/footers  ${outline.headersFooters.length}\n`);
  for (const warning of outline.warnings) process.stdout.write(`  warning: ${warning}\n`);
  process.stdout.write(`\nWrote ${outPath}\n`);
  process.stdout.write(
    'This file is reference material. sectionOrder, requiredBlocks and styleMap are yours to author.\n',
  );
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
