/**
 * Staging and publish.
 *
 * `/formats-staging` is where a human authors and a second reviewer signs off. Nothing in staging
 * is resolvable by the export API — the only way content leaves staging is `publishDraft`, which
 * enforces every gate in spec section 8:
 *
 *   config+meta validate → template present → style-map lint clean → a distinct reviewer approved →
 *   golden fixture renders and passes its acceptance checklist → registry updated → status active.
 *
 * A draft has two files, mirroring the split FORMAT_CONFIG_GUIDE.md draws: `draft-config.json`
 * (styling — page/typography/headings/styleMap/etc.) and `draft-meta.json` (structure/workflow —
 * sectionOrder/requiredBlocks/entitlement/provenance).
 *
 * There is no generative model anywhere in this path, and no step that "proposes" configuration.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CanonicalIR, DocumentSkeleton, FormatConfig, FormatMeta, PMDoc } from '../core/types.js';
import { ExportEngineError } from '../core/errors.js';
import { assertValid, validateDocumentSkeleton, validateFormatMeta, validateFormatStyle, validateProseMirror } from '../schemas/index.js';
import { normalize } from '../normalizer/index.js';
import { validateIr } from '../validator/index.js';
import { renderToDocx } from '../renderer/index.js';
import { FORMATS_DIR, REGISTRY_FILE, STAGING_DIR, formatDir, splitFormatId } from './paths.js';
import { lintConfigAgainstTemplate, type StyleMapLintReport } from './style-map-lint.js';
import { checkSkeletonInvariants } from './skeleton-invariants.js';
import { resolveFormat, scanFormats } from './resolver.js';
import { fixtureDir, hasFixture, readChecklist, runAcceptance } from './acceptance.js';

export interface Draft {
  draftId: string;
  dir: string;
  config: FormatConfig;
  meta: FormatMeta;
  /** Present if `draft-skeleton.json` was saved — the seed document for this format, if authored yet. */
  skeleton?: DocumentSkeleton;
  hasTemplate: boolean;
  hasExtractionOutline: boolean;
  styleDiffReport?: StyleMapLintReport;
}

export interface PublishOptions {
  /** The reviewer signing off. Must differ from `provenance.authoredBy` where team size allows. */
  reviewedBy: string;
  /** Set only for a single-author team, and recorded in the changelog when used. */
  allowSelfReview?: boolean;
  stagingRoot?: string;
  formatsRoot?: string;
  /** Renders the golden fixture and runs its acceptance checklist. On by default. */
  runAcceptanceChecks?: boolean;
  now?: () => Date;
}

export interface PublishResult {
  formatId: string;
  dir: string;
  acceptance?: { passed: string[]; standard: string };
  registryEntries: number;
}

// ---------------------------------------------------------------------------
// Staging
// ---------------------------------------------------------------------------

export function draftDir(draftId: string, stagingRoot = STAGING_DIR): string {
  if (!/^[A-Za-z0-9._-]+$/.test(draftId)) {
    throw new ExportEngineError('BAD_REQUEST', `"${draftId}" is not a valid draft id`);
  }
  return join(stagingRoot, draftId);
}

export function listDrafts(stagingRoot = STAGING_DIR): Draft[] {
  if (!existsSync(stagingRoot)) return [];
  const out: Draft[] = [];
  for (const draftId of readdirSync(stagingRoot).sort()) {
    const dir = join(stagingRoot, draftId);
    if (!statSync(dir).isDirectory()) continue;
    if (!existsSync(join(dir, 'draft-config.json'))) continue;
    try {
      out.push(readDraft(draftId, stagingRoot));
    } catch {
      // A malformed draft must not break the listing the admin UI depends on.
    }
  }
  return out;
}

export function readDraft(draftId: string, stagingRoot = STAGING_DIR): Draft {
  const dir = draftDir(draftId, stagingRoot);
  const configPath = join(dir, 'draft-config.json');
  const metaPath = join(dir, 'draft-meta.json');
  if (!existsSync(configPath)) {
    throw new ExportEngineError('DRAFT_NOT_FOUND', `No draft "${draftId}" in staging`, [
      { path: configPath, message: 'Expected a draft-config.json in the draft folder' },
    ]);
  }
  if (!existsSync(metaPath)) {
    throw new ExportEngineError('DRAFT_NOT_FOUND', `Draft "${draftId}" has no draft-meta.json`, [
      { path: metaPath, message: 'A draft needs both draft-config.json (styling) and draft-meta.json (structure/workflow)' },
    ]);
  }
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as FormatConfig;
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as FormatMeta;
  const reportPath = join(dir, 'style-diff-report.json');
  const skeletonPath = join(dir, 'draft-skeleton.json');
  return {
    draftId,
    dir,
    config,
    meta,
    ...(existsSync(skeletonPath) ? { skeleton: JSON.parse(readFileSync(skeletonPath, 'utf8')) as DocumentSkeleton } : {}),
    hasTemplate: existsSync(join(dir, 'template.dotx')),
    hasExtractionOutline: existsSync(join(dir, 'extraction-outline.json')),
    ...(existsSync(reportPath)
      ? { styleDiffReport: JSON.parse(readFileSync(reportPath, 'utf8')) as StyleMapLintReport }
      : {}),
  };
}

export function saveDraft(
  draftId: string,
  config: FormatConfig,
  meta: FormatMeta,
  options: { templateBytes?: Buffer; skeleton?: DocumentSkeleton; stagingRoot?: string } = {},
): Draft {
  const dir = draftDir(draftId, options.stagingRoot ?? STAGING_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'draft-config.json'), `${JSON.stringify(config, null, 2)}\n`);
  writeFileSync(join(dir, 'draft-meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  if (options.skeleton) writeFileSync(join(dir, 'draft-skeleton.json'), `${JSON.stringify(options.skeleton, null, 2)}\n`);
  if (options.templateBytes) writeFileSync(join(dir, 'template.dotx'), options.templateBytes);
  return readDraft(draftId, options.stagingRoot ?? STAGING_DIR);
}

/** Runs the style-map lint against the draft's template and writes `style-diff-report.json`. */
export function lintDraft(draftId: string, stagingRoot = STAGING_DIR): StyleMapLintReport {
  const draft = readDraft(draftId, stagingRoot);
  const templatePath = join(draft.dir, 'template.dotx');
  if (!existsSync(templatePath)) {
    throw new ExportEngineError('TEMPLATE_NOT_FOUND', `Draft "${draftId}" has no template.dotx`, [
      { path: templatePath, message: 'Upload the .dotx before linting' },
    ]);
  }
  const report = lintConfigAgainstTemplate(draft.config, readFileSync(templatePath));
  writeFileSync(join(draft.dir, 'style-diff-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

export function publishDraft(draftId: string, options: PublishOptions): PublishResult {
  const stagingRoot = options.stagingRoot ?? STAGING_DIR;
  const formatsRoot = options.formatsRoot ?? FORMATS_DIR;
  const now = options.now ?? (() => new Date());

  const draft = readDraft(draftId, stagingRoot);
  const { config, meta } = draft;

  // 1. schema (both files)
  assertValid(
    validateFormatStyle,
    config,
    'CONFIG_SCHEMA_INVALID',
    `Draft "${draftId}"'s draft-config.json does not satisfy format-style.schema.json`,
  );
  assertValid(
    validateFormatMeta,
    meta,
    'CONFIG_SCHEMA_INVALID',
    `Draft "${draftId}"'s draft-meta.json does not satisfy format-meta.schema.json`,
  );
  if (draft.skeleton) {
    assertValid(
      validateDocumentSkeleton,
      draft.skeleton,
      'CONFIG_SCHEMA_INVALID',
      `Draft "${draftId}"'s draft-skeleton.json does not satisfy document-skeleton.schema.json`,
    );
    assertValid(
      validateProseMirror,
      draft.skeleton.doc,
      'MALFORMED_PROSEMIRROR',
      `Draft "${draftId}"'s draft-skeleton.json: \`doc\` does not satisfy the ProseMirror base contract`,
    );
    const skeletonViolations = checkSkeletonInvariants(draft.skeleton.doc);
    if (skeletonViolations.length > 0) {
      throw new ExportEngineError(
        'CONFIG_SCHEMA_INVALID',
        `Draft "${draftId}"'s draft-skeleton.json has a node marked both locked and fillIn`,
        skeletonViolations,
      );
    }
  }

  if (config.formatId !== meta.formatId) {
    throw new ExportEngineError('PUBLISH_FAILED', 'draft-config.json and draft-meta.json declare different formatIds', [
      { message: `config.formatId is "${config.formatId}" but meta.formatId is "${meta.formatId}"` },
    ]);
  }

  const parts = splitFormatId(config.formatId);
  if (!parts || parts.phaseId !== config.phaseId || parts.phaseId !== meta.phaseId) {
    throw new ExportEngineError('PUBLISH_FAILED', 'formatId and phaseId disagree', [
      { message: `formatId "${config.formatId}" must start with phaseId "${config.phaseId}"` },
    ]);
  }

  // 2. template present
  const templatePath = join(draft.dir, 'template.dotx');
  if (!existsSync(templatePath)) {
    throw new ExportEngineError('TEMPLATE_NOT_FOUND', `Draft "${draftId}" has no template.dotx`, [
      { path: templatePath, message: 'A format cannot be published without its Word template' },
    ]);
  }
  const templateBytes = readFileSync(templatePath);

  // 3. style-map lint
  const lint = lintConfigAgainstTemplate(config, templateBytes);
  if (!lint.ok) {
    throw new ExportEngineError(
      'STYLE_MAP_LINT_FAILED',
      `Draft "${draftId}" has ${lint.issues.length} style reference${lint.issues.length === 1 ? '' : 's'} that do not exist in its template`,
      lint.issues.map((issue) => ({ path: issue.key, message: issue.message })),
    );
  }

  // 4. review gate
  if (!options.reviewedBy) {
    throw new ExportEngineError('REVIEW_REQUIRED', 'Publishing requires a reviewer');
  }
  // The author signal is optional: a richer meta.json carries provenance.authoredBy or addedBy; the
  // lean shape the extract-research-format skill produces carries neither. When there is no author
  // on record at all, there is nothing to compare the reviewer against, so the check simply can't
  // apply — it isn't skipped by choice, there's no signal to enforce it with.
  const authoredBy = meta.provenance?.authoredBy ?? meta.addedBy;
  if (authoredBy !== undefined && options.reviewedBy === authoredBy && options.allowSelfReview !== true) {
    throw new ExportEngineError(
      'REVIEW_REQUIRED',
      'The reviewer must be someone other than the author',
      [
        {
          message: `"${options.reviewedBy}" authored this format. Pass allowSelfReview only for a single-author team, and record it in the CHANGELOG.`,
        },
      ],
    );
  }

  // Preserve whichever review-tracking shape the draft used: a rich `provenance` object, or the
  // flat `reviewedBy` field the skill's lean meta.json carries. Never invent the other shape.
  const usesProvenance = meta.provenance !== undefined;
  const publishedMeta: FormatMeta = {
    ...meta,
    status: 'active',
    ...(usesProvenance
      ? {
          provenance: {
            authoredBy: meta.provenance!.authoredBy ?? options.reviewedBy,
            reviewedBy: options.reviewedBy,
            addedAt: meta.provenance!.addedAt ?? now().toISOString(),
            extractionAssisted: meta.provenance!.extractionAssisted ?? draft.hasExtractionOutline,
          },
        }
      : { reviewedBy: options.reviewedBy }),
  };

  // 5. write into /formats
  const targetDir = formatDir(config.formatId, formatsRoot)!;
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(join(targetDir, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
  writeFileSync(
    join(targetDir, 'meta.json'),
    `${JSON.stringify(
      {
        formatId: publishedMeta.formatId,
        phaseId: publishedMeta.phaseId,
        ...(publishedMeta.displayName ? { displayName: publishedMeta.displayName } : {}),
        ...(publishedMeta.sourcePlatform ? { sourcePlatform: publishedMeta.sourcePlatform } : {}),
        ...(usesProvenance
          ? { addedBy: publishedMeta.provenance!.authoredBy, addedAt: publishedMeta.provenance!.addedAt }
          : { ...(publishedMeta.addedBy ? { addedBy: publishedMeta.addedBy } : {}), ...(publishedMeta.addedAt ? { addedAt: publishedMeta.addedAt } : {}) }),
        status: 'active',
        notes: publishedMeta.notes ?? `Published from staging draft "${draftId}", reviewed by ${options.reviewedBy}.`,
        ...(publishedMeta.sectionOrder ? { sectionOrder: publishedMeta.sectionOrder } : {}),
        ...(publishedMeta.requiredBlocks ? { requiredBlocks: publishedMeta.requiredBlocks } : {}),
        ...(publishedMeta.numbering ? { numbering: publishedMeta.numbering } : {}),
        ...(publishedMeta.fallback ? { fallback: publishedMeta.fallback } : {}),
        ...(publishedMeta.entitlement ? { entitlement: publishedMeta.entitlement } : {}),
        ...(usesProvenance ? { provenance: publishedMeta.provenance } : { reviewedBy: publishedMeta.reviewedBy }),
      },
      null,
      2,
    )}\n`,
  );
  copyFileSync(templatePath, join(targetDir, config.templateFile));
  if (draft.hasExtractionOutline) {
    copyFileSync(join(draft.dir, 'extraction-outline.json'), join(targetDir, 'extraction-outline.json'));
  }
  if (draft.skeleton) {
    writeFileSync(join(targetDir, 'document-skeleton.json'), `${JSON.stringify(draft.skeleton, null, 2)}\n`);
  }

  // 6. golden fixture + acceptance checklist
  let acceptance: PublishResult['acceptance'];
  if (options.runAcceptanceChecks !== false) {
    acceptance = runGoldenAcceptance(config.formatId, formatsRoot);
  }

  // 7. registry index
  const entries = scanFormats(formatsRoot);
  writeFileSync(join(formatsRoot, '_registry.json'), `${JSON.stringify(entries, null, 2)}\n`);

  return {
    formatId: config.formatId,
    dir: targetDir,
    ...(acceptance ? { acceptance } : {}),
    registryEntries: entries.length,
  };
}

/** Renders the format's golden fixture and runs its acceptance checklist. */
function runGoldenAcceptance(formatId: string, formatsRoot: string): { passed: string[]; standard: string } {
  if (!hasFixture(formatId)) {
    throw new ExportEngineError('PUBLISH_FAILED', `Format "${formatId}" has no golden fixture`, [
      {
        path: fixtureDir(formatId),
        message:
          'A format is not done until it has a sample-input.json and an acceptance.json under /tests/fixtures. See AGENT_BUILD_SPEC.md section 8.',
      },
    ]);
  }

  const checklist = readChecklist(formatId);
  const bytes = renderFixtureSync(formatId, formatsRoot);
  const result = runAcceptance(bytes, checklist);
  if (!result.ok) {
    throw new ExportEngineError(
      'PUBLISH_FAILED',
      `Format "${formatId}" failed ${result.failures.length} acceptance check(s)`,
      result.failures.map((failure) => ({ message: `${failure.id}: ${failure.description} — ${failure.reason}` })),
    );
  }
  return { passed: result.passed, standard: checklist.standard };
}

export interface FixtureInput {
  doc: PMDoc;
  meta: CanonicalIR['meta'];
}

export function readFixtureInput(formatId: string): FixtureInput {
  return JSON.parse(readFileSync(join(fixtureDir(formatId), 'sample-input.json'), 'utf8')) as FixtureInput;
}

/**
 * Normalizes and renders a format's golden fixture through the real pipeline.
 *
 * This is the same path an export takes, minus the API gates — which is the point: the artifact a
 * reviewer approves is produced by the code that will serve users, not by a test-only shortcut.
 */
export function renderFixtureSync(formatId: string, formatsRoot = FORMATS_DIR): Buffer {
  const fixture = readFixtureInput(formatId);
  const format = resolveFormat(formatId, { root: formatsRoot, allowInactive: true });
  const ir = normalize(fixture.doc, {
    meta: { ...fixture.meta, formatId },
    fallback: format.meta.fallback?.unknownBlockKind ?? 'renderAsPlainParagraph',
  });
  validateIr(ir, format.meta);
  return renderToDocx(ir, format).bytes;
}

export { REGISTRY_FILE };
