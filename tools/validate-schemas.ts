#!/usr/bin/env tsx
/**
 * `npm run validate:schemas`
 *
 * Compiles every JSON Schema, validates every published format's config.json (styling) and
 * meta.json (structure/workflow) against their schemas, runs the style-map lint for each, and
 * checks `_registry.json` against the folder tree. This is the fast pre-commit check; `npm test`
 * covers behaviour.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ExportEngineError } from '../core/errors.js';
import {
  SCHEMA_DIR,
  SCHEMA_FILES,
  ajvErrorsToDetails,
  validateDocumentSkeleton,
  validateFormatMeta,
  validateFormatStyle,
  validateProseMirror,
  validateTemplateFacts,
} from '../schemas/index.js';
import { FORMATS_DIR } from '../format-registry/paths.js';
import { checkRegistrySync } from '../format-registry/resolver.js';
import { lintConfigAgainstTemplate } from '../format-registry/style-map-lint.js';
import { checkSkeletonInvariants } from '../format-registry/skeleton-invariants.js';
import { checkFormatFamilyConsistency } from '../format-registry/format-family.js';
import type { FormatConfig, PMNode } from '../core/types.js';

interface Problem {
  where: string;
  message: string;
}

function main(): void {
  const problems: Problem[] = [];

  for (const file of SCHEMA_FILES) {
    const path = join(SCHEMA_DIR, file);
    if (!existsSync(path)) problems.push({ where: file, message: 'schema file is missing' });
  }
  process.stdout.write(`✓ ${SCHEMA_FILES.length} schemas compiled\n`);

  let configCount = 0;
  let skeletonCount = 0;
  let factsCount = 0;
  const validConfigs = new Map<string, FormatConfig>();
  for (const phaseId of readdirSync(FORMATS_DIR).sort()) {
    const phaseDir = join(FORMATS_DIR, phaseId);
    if (!statSync(phaseDir).isDirectory()) continue;
    for (const localId of readdirSync(phaseDir).sort()) {
      const dir = join(phaseDir, localId);
      if (!statSync(dir).isDirectory()) continue;
      const configPath = join(dir, 'config.json');
      const metaPath = join(dir, 'meta.json');
      const where = `${phaseId}/${localId}`;

      if (!existsSync(configPath)) {
        problems.push({ where, message: 'folder has no config.json' });
        continue;
      }
      if (!existsSync(metaPath)) {
        problems.push({ where, message: 'folder has no meta.json' });
        continue;
      }
      configCount += 1;

      const parsedConfig: unknown = JSON.parse(readFileSync(configPath, 'utf8'));
      const parsedMeta: unknown = JSON.parse(readFileSync(metaPath, 'utf8'));

      const maybeFormatId = (parsedConfig as { formatId?: unknown })?.formatId;
      const label = typeof maybeFormatId === 'string' ? maybeFormatId : where;

      const expectedFormatId = `${phaseId}.${localId}`;
      if (maybeFormatId !== expectedFormatId) {
        problems.push({
          where,
          message: `config.json's formatId is "${String(maybeFormatId)}", which does not match this folder's location (expected "${expectedFormatId}") — the resolver computes a format's directory from its formatId, so a mismatch here means this format can never actually resolve`,
        });
        continue;
      }

      let ok = true;
      if (!validateFormatStyle(parsedConfig)) {
        ok = false;
        for (const detail of ajvErrorsToDetails(validateFormatStyle.errors)) {
          problems.push({ where: `${label} (config.json)`, message: detail.message });
        }
      }
      if (!validateFormatMeta(parsedMeta)) {
        ok = false;
        for (const detail of ajvErrorsToDetails(validateFormatMeta.errors)) {
          problems.push({ where: `${label} (meta.json)`, message: detail.message });
        }
      }
      if (!ok) continue;

      const config = parsedConfig as FormatConfig;
      validConfigs.set(config.formatId, config);

      const factsPath = join(dir, 'template-facts.json');
      if (existsSync(factsPath)) {
        factsCount += 1;
        const parsedFacts: unknown = JSON.parse(readFileSync(factsPath, 'utf8'));
        if (!validateTemplateFacts(parsedFacts)) {
          for (const detail of ajvErrorsToDetails(validateTemplateFacts.errors)) {
            problems.push({ where: `${config.formatId} (template-facts.json)`, message: detail.message });
          }
        }
      }

      const templatePath = join(dir, config.templateFile);
      if (!existsSync(templatePath)) {
        problems.push({
          where: config.formatId,
          message: existsSync(factsPath)
            ? `template ${config.templateFile} is missing — run "npm run build:templates" to build it from template-facts.json`
            : `template ${config.templateFile} is missing`,
        });
        continue;
      }

      const report = lintConfigAgainstTemplate(config, readFileSync(templatePath));
      for (const issue of report.issues) {
        problems.push({
          where: config.formatId,
          message: `${issue.message}${issue.didYouMean.length > 0 ? ` (did you mean: ${issue.didYouMean.join(', ')}?)` : ''}`,
        });
      }

      const skeletonPath = join(dir, 'document-skeleton.json');
      if (existsSync(skeletonPath)) {
        skeletonCount += 1;
        const parsedSkeleton: unknown = JSON.parse(readFileSync(skeletonPath, 'utf8'));
        if (!validateDocumentSkeleton(parsedSkeleton)) {
          for (const detail of ajvErrorsToDetails(validateDocumentSkeleton.errors)) {
            problems.push({ where: `${config.formatId} (document-skeleton.json)`, message: detail.message });
          }
        } else {
          const doc = (parsedSkeleton as { doc: unknown }).doc;
          if (!validateProseMirror(doc)) {
            for (const detail of ajvErrorsToDetails(validateProseMirror.errors)) {
              problems.push({ where: `${config.formatId} (document-skeleton.json .doc)`, message: detail.message });
            }
          } else {
            for (const violation of checkSkeletonInvariants(doc as { content?: PMNode[] })) {
              problems.push({ where: `${config.formatId} (document-skeleton.json)`, message: violation.message });
            }
          }
        }
      }
    }
  }
  process.stdout.write(`✓ ${configCount} format configs validated + style-map linted\n`);
  process.stdout.write(`✓ ${skeletonCount} document-skeleton.json files validated\n`);
  process.stdout.write(`✓ ${factsCount} template-facts.json files validated\n`);

  const familyProblems = checkFormatFamilyConsistency(validConfigs);
  for (const problem of familyProblems) problems.push({ where: 'sharedFormattingWith', message: problem.message });
  const familyClaimCount = [...validConfigs.values()].filter((c) => c.sharedFormattingWith).length;
  process.stdout.write(`✓ ${familyClaimCount} sharedFormattingWith claim(s) checked against their sibling config\n`);

  const sync = checkRegistrySync(FORMATS_DIR);
  if (!sync.ok) {
    for (const formatId of sync.missingFromRegistry) {
      problems.push({ where: '_registry.json', message: `"${formatId}" is on disk but not in the registry` });
    }
    for (const formatId of sync.missingFromDisk) {
      problems.push({ where: '_registry.json', message: `"${formatId}" is in the registry but not on disk` });
    }
    for (const mismatch of sync.mismatched) {
      problems.push({
        where: '_registry.json',
        message: `"${mismatch.formatId}".${mismatch.field}: disk="${mismatch.onDisk}" registry="${mismatch.inRegistry}"`,
      });
    }
  } else {
    process.stdout.write('✓ _registry.json is in sync with /formats\n');
  }

  if (problems.length > 0) {
    process.stderr.write(`\n${problems.length} problem(s):\n`);
    for (const problem of problems) process.stderr.write(`  ✗ [${problem.where}] ${problem.message}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('\nAll schema and registry checks passed.\n');
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
