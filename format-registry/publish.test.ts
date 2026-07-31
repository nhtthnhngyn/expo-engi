/**
 * Staging + publish flow tests: every gate in spec section 8 must actually block publish.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { publishDraft, saveDraft, lintDraft, readDraft } from './publish.js';
import { checkRegistrySync } from './resolver.js';
import { buildDotx } from '../tools/dotx-builder.js';
import { ExportEngineError } from '../core/errors.js';
import type { FormatConfig, FormatMeta } from '../core/types.js';

const GOOD_TEMPLATE = buildDotx({
  bodyFont: 'Calibri',
  bodySizeHalfPoints: 22,
  styles: [{ name: 'Body Text' }],
});

function draftConfig(overrides: Partial<FormatConfig> = {}): FormatConfig {
  return {
    formatId: 'phase-a.new-format',
    displayName: 'New Format',
    phaseId: 'phase-a',
    version: 'v1',
    templateFile: 'template.dotx',
    page: { size: 'letter', widthTwips: 12240, heightTwips: 15840, orientation: 'portrait', margins: { topTwips: 1440, rightTwips: 1440, bottomTwips: 1440, leftTwips: 1440 } },
    typography: { defaultFont: 'Calibri', defaultSizePt: 11, defaultLineSpacing: 'single', defaultAlignment: 'left' },
    headings: {},
    styleMap: { paragraph: 'Body Text' },
    toc: { enabled: false, depth: 0, autoGenerateFromHeadings: false },
    headingNumbering: { auto: false },
    citationStyle: 'none',
    pageNumbering: 'none',
    ...overrides,
  };
}

function draftMeta(overrides: Partial<FormatMeta> = {}): FormatMeta {
  return {
    formatId: 'phase-a.new-format',
    phaseId: 'phase-a',
    sourcePlatform: 'Test',
    addedBy: 'author-1',
    addedAt: '2026-01-01T00:00:00.000Z',
    status: 'draft',
    sectionOrder: [],
    requiredBlocks: [],
    provenance: { authoredBy: 'author-1', reviewedBy: null, addedAt: '2026-01-01T00:00:00.000Z', extractionAssisted: false },
    ...overrides,
  };
}

describe('staging + publish', () => {
  let stagingRoot: string;
  let formatsRoot: string;

  beforeEach(() => {
    stagingRoot = mkdtempSync(join(tmpdir(), 'export-engine-staging-'));
    formatsRoot = mkdtempSync(join(tmpdir(), 'export-engine-formats-'));
  });

  afterEach(() => {
    rmSync(stagingRoot, { recursive: true, force: true });
    rmSync(formatsRoot, { recursive: true, force: true });
  });

  it('saves and reads back a draft', () => {
    saveDraft('draft-1', draftConfig(), draftMeta(), { stagingRoot, templateBytes: GOOD_TEMPLATE });
    const draft = readDraft('draft-1', stagingRoot);
    expect(draft.config.formatId).toBe('phase-a.new-format');
    expect(draft.hasTemplate).toBe(true);
  });

  it('lintDraft reports a styleMap mismatch and writes style-diff-report.json', () => {
    saveDraft('draft-1', draftConfig({ styleMap: { paragraph: 'Missing Style' } }), draftMeta(), {
      stagingRoot,
      templateBytes: GOOD_TEMPLATE,
    });
    const report = lintDraft('draft-1', stagingRoot);
    expect(report.ok).toBe(false);
    expect(existsSync(join(stagingRoot, 'draft-1', 'style-diff-report.json'))).toBe(true);
  });

  it('publish fails without a template', () => {
    saveDraft('draft-1', draftConfig(), draftMeta(), { stagingRoot });
    expect(() =>
      publishDraft('draft-1', { reviewedBy: 'reviewer-1', stagingRoot, formatsRoot, runAcceptanceChecks: false }),
    ).toThrow(ExportEngineError);
  });

  it('publish fails when the style-map lint fails', () => {
    saveDraft('draft-1', draftConfig({ styleMap: { paragraph: 'Missing Style' } }), draftMeta(), {
      stagingRoot,
      templateBytes: GOOD_TEMPLATE,
    });
    try {
      publishDraft('draft-1', { reviewedBy: 'reviewer-1', stagingRoot, formatsRoot, runAcceptanceChecks: false });
      throw new Error('expected a throw');
    } catch (err) {
      expect((err as ExportEngineError).code).toBe('STYLE_MAP_LINT_FAILED');
    }
  });

  it('publish fails when draft-skeleton.json has a node marked both locked and fillIn', () => {
    saveDraft('draft-1', draftConfig(), draftMeta(), {
      stagingRoot,
      templateBytes: GOOD_TEMPLATE,
      skeleton: {
        formatId: 'phase-a.new-format',
        skeletonVersion: 'v1',
        doc: { type: 'doc', content: [{ type: 'paragraph', attrs: { locked: true, fillIn: true }, content: [] }] },
      },
    });
    try {
      publishDraft('draft-1', { reviewedBy: 'reviewer-1', stagingRoot, formatsRoot, runAcceptanceChecks: false });
      throw new Error('expected a throw');
    } catch (err) {
      expect((err as ExportEngineError).code).toBe('CONFIG_SCHEMA_INVALID');
      expect((err as ExportEngineError).message).toMatch(/both locked and fillIn/);
    }
  });

  it('publish fails when the reviewer is the same as the author (self-review not allowed by default)', () => {
    saveDraft('draft-1', draftConfig(), draftMeta(), { stagingRoot, templateBytes: GOOD_TEMPLATE });
    try {
      publishDraft('draft-1', { reviewedBy: 'author-1', stagingRoot, formatsRoot, runAcceptanceChecks: false });
      throw new Error('expected a throw');
    } catch (err) {
      expect((err as ExportEngineError).code).toBe('REVIEW_REQUIRED');
    }
  });

  it('publish fails without a golden fixture (definition of done)', () => {
    saveDraft('draft-1', draftConfig(), draftMeta(), { stagingRoot, templateBytes: GOOD_TEMPLATE });
    try {
      publishDraft('draft-1', { reviewedBy: 'reviewer-1', stagingRoot, formatsRoot });
      throw new Error('expected a throw');
    } catch (err) {
      expect((err as ExportEngineError).code).toBe('PUBLISH_FAILED');
      expect((err as ExportEngineError).message).toContain('golden fixture');
    }
  });

  it('a clean draft publishes: writes config+meta+template into /formats and updates the registry index', () => {
    saveDraft('draft-1', draftConfig(), draftMeta(), { stagingRoot, templateBytes: GOOD_TEMPLATE });
    const result = publishDraft('draft-1', {
      reviewedBy: 'reviewer-1',
      stagingRoot,
      formatsRoot,
      runAcceptanceChecks: false,
    });

    expect(result.formatId).toBe('phase-a.new-format');
    expect(existsSync(join(formatsRoot, 'phase-a', 'new-format', 'config.json'))).toBe(true);
    expect(existsSync(join(formatsRoot, 'phase-a', 'new-format', 'meta.json'))).toBe(true);
    expect(existsSync(join(formatsRoot, 'phase-a', 'new-format', 'template.dotx'))).toBe(true);
    expect(checkRegistrySync(formatsRoot).ok).toBe(true);
  });

  it('allowSelfReview: true lets a single-author team publish, recorded via the flag', () => {
    saveDraft('draft-1', draftConfig(), draftMeta(), { stagingRoot, templateBytes: GOOD_TEMPLATE });
    const result = publishDraft('draft-1', {
      reviewedBy: 'author-1',
      allowSelfReview: true,
      stagingRoot,
      formatsRoot,
      runAcceptanceChecks: false,
    });
    expect(result.formatId).toBe('phase-a.new-format');
  });
});
