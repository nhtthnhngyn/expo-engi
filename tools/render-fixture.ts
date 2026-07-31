#!/usr/bin/env tsx
/**
 * `npm run render:fixture -- --format=report-writing.consort [--fixture=path] [--out=path]`
 *
 * Renders one fixture locally. This is the loop a format author works in: edit `config.json`,
 * re-render, open the result in Word, compare against the source document.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ExportEngineError } from '../core/errors.js';
import { normalize } from '../normalizer/index.js';
import { validateIr } from '../validator/index.js';
import { resolveFormat } from '../format-registry/resolver.js';
import { renderToDocx } from '../renderer/index.js';
import { fixtureDir, hasFixture, readChecklist, runAcceptance } from '../format-registry/acceptance.js';
import { REPO_ROOT } from '../format-registry/paths.js';
import type { CanonicalIR, PMDoc } from '../core/types.js';

interface Args {
  format?: string;
  fixture?: string;
  out?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (const arg of argv) {
    const match = /^--([a-zA-Z]+)=(.*)$/.exec(arg);
    if (!match) continue;
    (args as Record<string, string>)[match[1]!] = match[2]!;
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!args.format) {
    process.stderr.write(
      'Usage: npm run render:fixture -- --format=<phaseId>.<formatId> [--fixture=<path>] [--out=<path>]\n',
    );
    process.exitCode = 1;
    return;
  }

  const formatId = args.format;
  const inputPath = args.fixture
    ? resolve(process.cwd(), args.fixture)
    : join(fixtureDir(formatId), 'sample-input.json');

  const fixture = JSON.parse(readFileSync(inputPath, 'utf8')) as { doc: PMDoc; meta: CanonicalIR['meta'] };
  const format = resolveFormat(formatId, { allowInactive: true });

  const ir = normalize(fixture.doc, {
    meta: { ...fixture.meta, formatId },
    fallback: format.meta.fallback?.unknownBlockKind ?? 'renderAsPlainParagraph',
  });
  validateIr(ir, format.meta);

  const rendered = renderToDocx(ir, format);
  const outPath = args.out
    ? resolve(process.cwd(), args.out)
    : join(REPO_ROOT, 'out', `${formatId}.docx`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, rendered.bytes);

  process.stdout.write(`Rendered ${formatId}\n`);
  process.stdout.write(`  input   ${inputPath}\n`);
  process.stdout.write(`  output  ${outPath} (${rendered.bytes.length} bytes, ${ir.blocks.length} top-level blocks)\n`);
  for (const warning of rendered.warnings) process.stdout.write(`  warning ${warning}\n`);

  if (hasFixture(formatId)) {
    const checklist = readChecklist(formatId);
    const result = runAcceptance(rendered.bytes, checklist);
    process.stdout.write(
      `  acceptance (${checklist.standard}): ${result.passed.length} passed, ${result.failures.length} failed\n`,
    );
    for (const failure of result.failures) {
      process.stdout.write(`    ✗ ${failure.id}: ${failure.description} — ${failure.reason}\n`);
    }
    if (!result.ok) process.exitCode = 1;
  }
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
