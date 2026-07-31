/**
 * Turns `template-facts.json` — real style facts the extract-research-format skill pulls directly
 * out of a reference document's own `word/styles.xml` — into an actual `.dotx`.
 *
 * This is the automatic half of onboarding a format from an uploaded reference document: the skill
 * extracts facts (never invents them), this module builds the template deterministically from
 * those facts, and a human only has to review the rendered result — no hand-authored
 * `template-definitions.ts` entry required.
 *
 * Kept as a pure, importable module (mirroring `dotx-builder.ts`) separate from the CLI in
 * `build-templates-from-facts.ts`, so both a script and a test can call it directly.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TemplateFacts } from '../core/types.js';
import { ExportEngineError } from '../core/errors.js';
import { ajvErrorsToDetails, validateTemplateFacts } from '../schemas/index.js';
import { buildDotx, type TemplateDefinition } from './dotx-builder.js';

export function templateDefinitionFromFacts(facts: TemplateFacts): TemplateDefinition {
  return { bodyFont: facts.bodyFont, bodySizeHalfPoints: facts.bodySizeHalfPoints, styles: facts.styles };
}

export function readTemplateFacts(path: string): TemplateFacts {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!validateTemplateFacts(parsed)) {
    throw new ExportEngineError(
      'CONFIG_SCHEMA_INVALID',
      `${path} does not satisfy template-facts.schema.json`,
      ajvErrorsToDetails(validateTemplateFacts.errors),
    );
  }
  return parsed as TemplateFacts;
}

export interface BuildTemplatesFromFactsResult {
  written: string[];
  unchanged: string[];
}

/**
 * Scans every `<phase>/<format>/template-facts.json` under `formatsDir` and (re)builds its
 * `template.dotx` — deterministically, so re-running with unchanged facts writes nothing.
 */
export function buildTemplatesFromFacts(formatsDir: string): BuildTemplatesFromFactsResult {
  const written: string[] = [];
  const unchanged: string[] = [];
  if (!existsSync(formatsDir)) return { written, unchanged };

  for (const phaseId of readdirSync(formatsDir).sort()) {
    const phaseDir = join(formatsDir, phaseId);
    if (!statSync(phaseDir).isDirectory()) continue;
    for (const localId of readdirSync(phaseDir).sort()) {
      const dir = join(phaseDir, localId);
      if (!statSync(dir).isDirectory()) continue;
      const factsPath = join(dir, 'template-facts.json');
      if (!existsSync(factsPath)) continue;

      const facts = readTemplateFacts(factsPath);
      const bytes = buildDotx(templateDefinitionFromFacts(facts));
      const templatePath = join(dir, 'template.dotx');

      if (existsSync(templatePath) && readFileSync(templatePath).equals(bytes)) {
        unchanged.push(templatePath);
        continue;
      }
      mkdirSync(dir, { recursive: true });
      writeFileSync(templatePath, bytes);
      written.push(templatePath);
    }
  }

  return { written, unchanged };
}
