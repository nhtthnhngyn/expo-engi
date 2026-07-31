import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkRegistrySync, loadConfig, loadMeta, resolveFormat, scanFormats } from './resolver.js';
import { buildDotx } from '../tools/dotx-builder.js';
import { ExportEngineError } from '../core/errors.js';
import type { FormatConfig, FormatMeta } from '../core/types.js';

function baseConfig(overrides: Partial<FormatConfig> = {}): FormatConfig {
  return {
    formatId: 'phase-a.format-a',
    displayName: 'Format A',
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

function baseMeta(overrides: Partial<FormatMeta> = {}): FormatMeta {
  return {
    formatId: 'phase-a.format-a',
    phaseId: 'phase-a',
    sourcePlatform: 'Test',
    addedBy: 'tester',
    addedAt: '2026-01-01T00:00:00.000Z',
    status: 'active',
    sectionOrder: [],
    requiredBlocks: [],
    ...overrides,
  };
}

const TEMPLATE = buildDotx({
  bodyFont: 'Calibri',
  bodySizeHalfPoints: 22,
  styles: [{ name: 'Body Text', sizeHalfPoints: 22 }],
});

describe('format registry resolver', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'export-engine-resolver-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeFormat(
    localId: string,
    config: FormatConfig,
    meta: FormatMeta,
    options: { withTemplate?: boolean; withMeta?: boolean } = {},
  ) {
    const dir = join(root, config.phaseId, localId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.json'), JSON.stringify(config, null, 2));
    if (options.withMeta !== false) writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
    if (options.withTemplate !== false) writeFileSync(join(dir, 'template.dotx'), TEMPLATE);
    return dir;
  }

  it('loads a valid config.json + meta.json and confirms both validate against their schemas', () => {
    writeFormat('format-a', baseConfig(), baseMeta());
    const resolved = resolveFormat('phase-a.format-a', { root });
    expect(resolved.config.formatId).toBe('phase-a.format-a');
    expect(resolved.meta.status).toBe('active');
  });

  it('rejects a config that references a templateFile that does not exist on disk', () => {
    writeFormat('format-a', baseConfig({ templateFile: 'missing.dotx' }), baseMeta(), { withTemplate: false });
    expect(() => resolveFormat('phase-a.format-a', { root })).toThrow(ExportEngineError);
    try {
      resolveFormat('phase-a.format-a', { root });
    } catch (err) {
      expect((err as ExportEngineError).code).toBe('TEMPLATE_NOT_FOUND');
    }
  });

  it('rejects a config whose styleMap references a style name absent from the .dotx (style-map lint)', () => {
    writeFormat('format-a', baseConfig({ styleMap: { paragraph: 'Nonexistent Style' } }), baseMeta());
    expect(() => resolveFormat('phase-a.format-a', { root })).toThrow(ExportEngineError);
    try {
      resolveFormat('phase-a.format-a', { root });
    } catch (err) {
      expect((err as ExportEngineError).code).toBe('STYLE_MAP_LINT_FAILED');
    }
  });

  it('rejects a document-skeleton.json with a node marked both locked and fillIn', () => {
    const dir = writeFormat('format-a', baseConfig(), baseMeta());
    writeFileSync(
      join(dir, 'document-skeleton.json'),
      JSON.stringify({
        formatId: 'phase-a.format-a',
        skeletonVersion: 'v1',
        doc: {
          type: 'doc',
          content: [{ type: 'paragraph', attrs: { locked: true, fillIn: true }, content: [] }],
        },
      }),
    );
    expect(() => resolveFormat('phase-a.format-a', { root })).toThrow(ExportEngineError);
    try {
      resolveFormat('phase-a.format-a', { root });
    } catch (err) {
      expect((err as ExportEngineError).code).toBe('CONFIG_SCHEMA_INVALID');
      expect((err as ExportEngineError).message).toMatch(/both locked and fillIn/);
    }
  });

  it('returns a clear "unknown formatId" error for a non-existent format', () => {
    expect(() => resolveFormat('phase-a.does-not-exist', { root })).toThrow(ExportEngineError);
    try {
      resolveFormat('phase-a.does-not-exist', { root });
    } catch (err) {
      expect((err as ExportEngineError).code).toBe('UNKNOWN_FORMAT');
    }
  });

  it('returns a clear error for a format still sitting in staging (meta.status: draft)', () => {
    writeFormat('format-a', baseConfig(), baseMeta({ status: 'draft' }));
    expect(() => resolveFormat('phase-a.format-a', { root })).toThrow(ExportEngineError);
    try {
      resolveFormat('phase-a.format-a', { root });
    } catch (err) {
      expect((err as ExportEngineError).code).toBe('FORMAT_NOT_ACTIVE');
    }
  });

  it('loadConfig rejects invalid JSON with a structured error', () => {
    const dir = join(root, 'phase-a', 'broken');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.json'), '{not valid json');
    expect(() => loadConfig(join(dir, 'config.json'))).toThrow(ExportEngineError);
  });

  it('loadMeta rejects a meta.json missing required fields', () => {
    const dir = join(root, 'phase-a', 'broken-meta');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'meta.json'), JSON.stringify({ formatId: 'phase-a.broken-meta' }));
    expect(() => loadMeta(join(dir, 'meta.json'))).toThrow(ExportEngineError);
  });

  it('registry sync: fails if a folder exists without a registry entry', () => {
    writeFormat('format-a', baseConfig(), baseMeta());
    writeFileSync(join(root, '_registry.json'), '[]');
    const report = checkRegistrySync(root);
    expect(report.ok).toBe(false);
    expect(report.missingFromRegistry).toEqual(['phase-a.format-a']);
  });

  it('registry sync: fails if the registry lists a formatId with no folder on disk', () => {
    writeFileSync(
      join(root, '_registry.json'),
      JSON.stringify([{ formatId: 'phase-a.ghost', phaseId: 'phase-a', displayName: 'x', version: 'v1', status: 'active', sourcePlatform: 'x' }]),
    );
    const report = checkRegistrySync(root);
    expect(report.ok).toBe(false);
    expect(report.missingFromDisk).toEqual(['phase-a.ghost']);
  });

  it('registry sync: passes when disk and registry agree', () => {
    writeFormat('format-a', baseConfig(), baseMeta());
    const entries = scanFormats(root);
    writeFileSync(join(root, '_registry.json'), JSON.stringify(entries));
    expect(checkRegistrySync(root).ok).toBe(true);
  });
});
