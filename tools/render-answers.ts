#!/usr/bin/env tsx
/**
 * `npm run render:answers -- --format=<phaseId>.<formatId> [--answers=<path>] [--out=<path>]`
 *
 * Merges a private document-answers.json into a format's shared document-skeleton.json and renders
 * the result — the real end-to-end path from "general template + private content" to a .docx.
 * Defaults to examples/answers/<formatId>.json, the repo's own worked examples.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ExportEngineError } from '../core/errors.js';
import { normalize } from '../normalizer/index.js';
import { validateIr } from '../validator/index.js';
import { resolveFormat, resolveSkeleton } from '../format-registry/resolver.js';
import { mergeAnswersIntoSkeleton } from '../format-registry/answers-merge.js';
import { renderToDocx } from '../renderer/index.js';
import { REPO_ROOT } from '../format-registry/paths.js';
import { assertValid, validateDocumentAnswers } from '../schemas/index.js';
import type { DocumentAnswers } from '../core/types.js';

interface Args {
  format?: string;
  answers?: string;
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
    process.stderr.write('Usage: npm run render:answers -- --format=<phaseId>.<formatId> [--answers=<path>] [--out=<path>]\n');
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

  const answersPath = args.answers
    ? resolve(process.cwd(), args.answers)
    : join(REPO_ROOT, 'examples', 'answers', `${formatId}.json`);
  const parsedAnswers: unknown = JSON.parse(readFileSync(answersPath, 'utf8'));
  assertValid(
    validateDocumentAnswers,
    parsedAnswers,
    'CONFIG_SCHEMA_INVALID',
    `document-answers.json at ${answersPath} does not satisfy document-answers.schema.json`,
  );
  const answers = parsedAnswers as DocumentAnswers;

  const { doc, unfilledSlots, unmatchedAnswers } = mergeAnswersIntoSkeleton(skeleton, answers);

  const ir = normalize(doc, {
    meta: {
      formatId,
      documentTitle: 'Merged document',
      projectId: answers.projectId ?? 'preview',
      generatedAt: new Date(0).toISOString(),
      sourceDocVersion: '1',
    },
    fallback: format.meta.fallback?.unknownBlockKind ?? 'renderAsPlainParagraph',
  });
  validateIr(ir, format.meta);

  const rendered = renderToDocx(ir, format);
  const outPath = args.out ? resolve(process.cwd(), args.out) : join(REPO_ROOT, 'out', `${formatId}.answers.docx`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, rendered.bytes);

  process.stdout.write(`Rendered ${formatId} from ${answersPath}\n`);
  process.stdout.write(`  output  ${outPath} (${rendered.bytes.length} bytes, ${ir.blocks.length} top-level blocks)\n`);
  if (unfilledSlots.length > 0) process.stdout.write(`  unfilled slots: ${unfilledSlots.join(', ')}\n`);
  if (unmatchedAnswers.length > 0) process.stdout.write(`  unmatched answer keys: ${unmatchedAnswers.join(', ')}\n`);
  for (const warning of rendered.warnings) process.stdout.write(`  warning ${warning}\n`);
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
