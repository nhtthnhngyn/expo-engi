#!/usr/bin/env tsx
/**
 * `npm run render:skeleton -- --format=<phaseId>.<formatId> [--out=<path>]`
 *
 * Renders a format's document-skeleton.json as-is — the empty seed document a brand-new document
 * of that format starts from — so an author can open it in Word and see the real starting
 * structure, distinct from any fixture used for acceptance testing.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { normalize } from '../normalizer/index.js';
import { validateIr } from '../validator/index.js';
import { resolveFormat, resolveSkeleton } from '../format-registry/resolver.js';
import { renderToDocx } from '../renderer/index.js';
import { REPO_ROOT } from '../format-registry/paths.js';

interface Args {
  format?: string;
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
    process.stderr.write('Usage: npm run render:skeleton -- --format=<phaseId>.<formatId> [--out=<path>]\n');
    process.exitCode = 1;
    return;
  }

  const formatId = args.format;
  const format = resolveFormat(formatId, { allowInactive: true });
  const skeleton = resolveSkeleton(formatId);
  if (!skeleton) {
    process.stderr.write(`"${formatId}" has no document-skeleton.json\n`);
    process.exitCode = 1;
    return;
  }

  const ir = normalize(skeleton.doc, {
    meta: {
      formatId,
      documentTitle: 'New document',
      projectId: 'preview',
      generatedAt: new Date(0).toISOString(),
      sourceDocVersion: '1',
    },
    fallback: format.meta.fallback?.unknownBlockKind ?? 'renderAsPlainParagraph',
  });
  validateIr(ir, format.meta);

  const rendered = renderToDocx(ir, format);
  const outPath = args.out ? resolve(process.cwd(), args.out) : join(REPO_ROOT, 'out', `${formatId}.skeleton.docx`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, rendered.bytes);

  process.stdout.write(`Rendered skeleton for ${formatId}\n`);
  process.stdout.write(`  output  ${outPath} (${rendered.bytes.length} bytes, ${ir.blocks.length} top-level blocks)\n`);
  for (const warning of rendered.warnings) process.stdout.write(`  warning ${warning}\n`);
}

main();
