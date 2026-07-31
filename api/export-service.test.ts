/**
 * Export API unit tests (spec section 9.6), against a small hand-built format so entitlement,
 * RBAC and validation can each be exercised in isolation.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ExportService, DOCX_CONTENT_TYPE, SYNC_NODE_LIMIT } from './export-service.js';
import { InMemoryAuditLog } from './audit-log.js';
import { buildDotx } from '../tools/dotx-builder.js';
import { ExportEngineError } from '../core/errors.js';
import type { FormatConfig, FormatMeta, PMDoc } from '../core/types.js';

const TEMPLATE = buildDotx({
  bodyFont: 'Calibri',
  bodySizeHalfPoints: 22,
  styles: [{ name: 'Body Text' }, { name: 'Heading One', outlineLevel: 0 }],
});

function config(overrides: Partial<FormatConfig> = {}): FormatConfig {
  return {
    formatId: 'phase-a.format-a',
    displayName: 'Format A',
    phaseId: 'phase-a',
    version: 'v1',
    templateFile: 'template.dotx',
    page: { size: 'letter', widthTwips: 12240, heightTwips: 15840, orientation: 'portrait', margins: { topTwips: 1440, rightTwips: 1440, bottomTwips: 1440, leftTwips: 1440 } },
    typography: { defaultFont: 'Calibri', defaultSizePt: 11, defaultLineSpacing: 'single', defaultAlignment: 'left' },
    headings: { '1': { wordStyle: 'Heading One' } },
    styleMap: { paragraph: 'Body Text' },
    toc: { enabled: false, depth: 0, autoGenerateFromHeadings: false },
    headingNumbering: { auto: false },
    citationStyle: 'none',
    pageNumbering: 'none',
    ...overrides,
  };
}

function meta(overrides: Partial<FormatMeta> = {}): FormatMeta {
  return {
    formatId: 'phase-a.format-a',
    phaseId: 'phase-a',
    sourcePlatform: 'Test',
    addedBy: 'tester',
    addedAt: '2026-01-01T00:00:00.000Z',
    status: 'active',
    sectionOrder: [],
    requiredBlocks: [],
    entitlement: { tier: 'free' },
    ...overrides,
  };
}

const SIMPLE_DOC: PMDoc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] };

describe('ExportService', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'export-engine-api-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function setup(cfg: FormatConfig, m: FormatMeta) {
    const dir = join(root, cfg.phaseId, 'format-a');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.json'), JSON.stringify(cfg, null, 2));
    writeFileSync(join(dir, 'meta.json'), JSON.stringify(m, null, 2));
    writeFileSync(join(dir, 'template.dotx'), TEMPLATE);
  }

  it('sync path returns a valid .docx with the correct content type for a small document', () => {
    setup(config(), meta());
    const service = new ExportService({ resolveOptions: { root } });
    const output = service.exportSync({
      formatId: 'phase-a.format-a',
      doc: SIMPLE_DOC,
      documentTitle: 'Doc',
      sourceDocVersion: '1',
      principal: { userId: 'u1', role: 'owner', projectId: 'proj1', tier: 'free' },
    });
    expect(output.contentType).toBe(DOCX_CONTENT_TYPE);
    expect(output.bytes.length).toBeGreaterThan(0);
    expect(output.bytes.subarray(0, 2).toString('ascii')).toBe('PK'); // it's a real zip
  });

  it('async path returns a jobId, and the status transitions pending -> done with a retrievable output', () => {
    setup(config(), meta());
    const service = new ExportService({ resolveOptions: { root } });
    const job = service.exportAsync({
      formatId: 'phase-a.format-a',
      doc: SIMPLE_DOC,
      documentTitle: 'Doc',
      sourceDocVersion: '1',
      principal: { userId: 'u1', role: 'owner', projectId: 'proj1', tier: 'free' },
    });
    expect(job.status).toBe('done');
    expect(job.result?.bytes.length).toBeGreaterThan(0);

    const fetched = service.jobStore.get(job.id);
    expect(fetched?.status).toBe('done');
  });

  it('export() routes a large document to the async path automatically', () => {
    setup(config(), meta());
    const service = new ExportService({ resolveOptions: { root } });
    const bigDoc: PMDoc = {
      type: 'doc',
      content: Array.from({ length: SYNC_NODE_LIMIT + 5 }, () => ({
        type: 'paragraph',
        content: [{ type: 'text', text: 'x' }],
      })),
    };
    const result = service.export({
      formatId: 'phase-a.format-a',
      doc: bigDoc,
      documentTitle: 'Big Doc',
      sourceDocVersion: '1',
      principal: { userId: 'u1', role: 'owner', projectId: 'proj1', tier: 'free' },
    });
    expect(result.kind).toBe('async');
  });

  it('entitlement gate: rejects a free-tier project for a paid-tier format with a clear error', () => {
    setup(config(), meta({ entitlement: { tier: 'paid' } }));
    const service = new ExportService({ resolveOptions: { root } });
    expect(() =>
      service.exportSync({
        formatId: 'phase-a.format-a',
        doc: SIMPLE_DOC,
        documentTitle: 'Doc',
        sourceDocVersion: '1',
        principal: { userId: 'u1', role: 'owner', projectId: 'proj1', tier: 'free' },
      }),
    ).toThrow(ExportEngineError);
    try {
      service.exportSync({
        formatId: 'phase-a.format-a',
        doc: SIMPLE_DOC,
        documentTitle: 'Doc',
        sourceDocVersion: '1',
        principal: { userId: 'u1', role: 'owner', projectId: 'proj1', tier: 'free' },
      });
    } catch (err) {
      expect((err as ExportEngineError).code).toBe('ENTITLEMENT_REQUIRED');
    }
  });

  it('entitlement gate: a paid-tier project succeeds against a paid-tier format', () => {
    setup(config(), meta({ entitlement: { tier: 'paid' } }));
    const service = new ExportService({ resolveOptions: { root } });
    const output = service.exportSync({
      formatId: 'phase-a.format-a',
      doc: SIMPLE_DOC,
      documentTitle: 'Doc',
      sourceDocVersion: '1',
      principal: { userId: 'u1', role: 'owner', projectId: 'proj1', tier: 'paid' },
    });
    expect(output.bytes.length).toBeGreaterThan(0);
  });

  it('RBAC gate: a role without export permission for the phase is rejected', () => {
    setup(config(), meta());
    const service = new ExportService({ resolveOptions: { root } });
    expect(() =>
      service.exportSync({
        formatId: 'phase-a.format-a',
        doc: SIMPLE_DOC,
        documentTitle: 'Doc',
        sourceDocVersion: '1',
        principal: { userId: 'u1', role: 'viewer', projectId: 'proj1', tier: 'free' },
      }),
    ).toThrow(ExportEngineError);
    try {
      service.exportSync({
        formatId: 'phase-a.format-a',
        doc: SIMPLE_DOC,
        documentTitle: 'Doc',
        sourceDocVersion: '1',
        principal: { userId: 'u1', role: 'viewer', projectId: 'proj1', tier: 'free' },
      });
    } catch (err) {
      expect((err as ExportEngineError).code).toBe('FORBIDDEN');
    }
  });

  it('RBAC gate: a permitted role succeeds', () => {
    setup(
      config({ phaseId: 'protocol-design', formatId: 'protocol-design.format-a' }),
      meta({ phaseId: 'protocol-design', formatId: 'protocol-design.format-a' }),
    );
    const service = new ExportService({ resolveOptions: { root } });
    const output = service.exportSync({
      formatId: 'protocol-design.format-a',
      doc: SIMPLE_DOC,
      documentTitle: 'Doc',
      sourceDocVersion: '1',
      principal: { userId: 'u1', role: 'coordinator', projectId: 'proj1', tier: 'free' },
    });
    expect(output.bytes.length).toBeGreaterThan(0);
  });

  it('writes exactly one audit log entry per successful export with who/when/formatId/formatVersion/contentVersion', () => {
    setup(config(), meta());
    const auditLog = new InMemoryAuditLog();
    const service = new ExportService({ resolveOptions: { root }, auditLog });
    service.exportSync({
      formatId: 'phase-a.format-a',
      doc: SIMPLE_DOC,
      documentTitle: 'Doc',
      sourceDocVersion: '7',
      principal: { userId: 'u42', role: 'owner', projectId: 'projX', tier: 'free' },
    });
    expect(auditLog.entries.length).toBe(1);
    expect(auditLog.entries[0]).toMatchObject({
      userId: 'u42',
      formatId: 'phase-a.format-a',
      formatVersion: 'v1',
      contentVersion: '7',
    });
    expect(typeof auditLog.entries[0]?.at).toBe('string');
  });

  it('a validation failure (missing required block) surfaces as the same structured error shape', () => {
    setup(config(), meta({ requiredBlocks: ['must-have-this'] }));
    const service = new ExportService({ resolveOptions: { root } });
    try {
      service.exportSync({
        formatId: 'phase-a.format-a',
        doc: SIMPLE_DOC,
        documentTitle: 'Doc',
        sourceDocVersion: '1',
        principal: { userId: 'u1', role: 'owner', projectId: 'proj1', tier: 'free' },
      });
      throw new Error('expected a throw');
    } catch (err) {
      expect(ExportEngineError.is(err)).toBe(true);
      const structured = (err as ExportEngineError).toJSON();
      expect(structured.code).toBe('MISSING_REQUIRED_BLOCKS');
      expect(Array.isArray(structured.details)).toBe(true);
    }
  });
});
