#!/usr/bin/env tsx
/**
 * Builds every format's `template.dotx` from `template-definitions.ts`.
 *
 * Run with `npm run build:templates`. Output is byte-deterministic, so re-running with no
 * definition change produces no git diff.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FORMATS_DIR, formatDir } from '../format-registry/paths.js';
import { buildDotx } from './dotx-builder.js';
import { TEMPLATE_DEFINITIONS } from './template-definitions.js';

function main(): void {
  let written = 0;
  let unchanged = 0;

  for (const [formatId, definition] of Object.entries(TEMPLATE_DEFINITIONS)) {
    const dir = formatDir(formatId, FORMATS_DIR);
    if (!dir) throw new Error(`"${formatId}" is not a valid formatId`);
    mkdirSync(dir, { recursive: true });

    const bytes = buildDotx(definition);
    const path = join(dir, 'template.dotx');
    if (existsSync(path) && readFileSync(path).equals(bytes)) {
      unchanged += 1;
      continue;
    }
    writeFileSync(path, bytes);
    written += 1;
    process.stdout.write(`wrote ${path}\n`);
  }

  process.stdout.write(`\n${written} template(s) written, ${unchanged} unchanged.\n`);
}

main();
