import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRouter, principalFrom, type ApiRequest } from './routes.js';
import { ExportService } from './export-service.js';
import { buildDotx } from '../tools/dotx-builder.js';
import { ExportEngineError } from '../core/errors.js';
import type { DocumentSkeleton, FormatConfig, FormatMeta } from '../core/types.js';

const TEMPLATE = buildDotx({ bodyFont: 'Calibri', bodySizeHalfPoints: 22, styles: [{ name: 'Body Text' }] });

function config(overrides: Partial<FormatConfig> = {}): FormatConfig {
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

describe('principalFrom', () => {
  it('throws BAD_REQUEST when identity headers are missing', () => {
    expect(() => principalFrom({})).toThrow(ExportEngineError);
  });

  it('builds a principal from headers, defaulting tier to free', () => {
    const principal = principalFrom({ 'x-user-id': 'u1', 'x-user-role': 'owner', 'x-project-id': 'p1' });
    expect(principal).toEqual({ userId: 'u1', role: 'owner', projectId: 'p1', tier: 'free' });
  });
});

describe('router', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'export-engine-routes-'));
    const dir = join(root, 'phase-a', 'format-a');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.json'), JSON.stringify(config(), null, 2));
    writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta(), null, 2));
    writeFileSync(join(dir, 'template.dotx'), TEMPLATE);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function router() {
    return createRouter({ service: new ExportService({ resolveOptions: { root } }) });
  }

  it('GET /health returns 200', () => {
    const response = router()({ method: 'GET', path: '/health', headers: {} });
    expect(response.status).toBe(200);
  });

  it('POST /exports without identity headers returns 400 with the structured error shape', () => {
    const request: ApiRequest = {
      method: 'POST',
      path: '/exports',
      headers: {},
      body: { formatId: 'phase-a.format-a', doc: { type: 'doc', content: [] }, documentTitle: 't', sourceDocVersion: '1' },
    };
    const response = router()(request);
    expect(response.status).toBe(400);
    expect((response.body as { error: { code: string } }).error.code).toBe('BAD_REQUEST');
  });

  it('POST /exports with a permitted principal returns a 200 with docx bytes', () => {
    const request: ApiRequest = {
      method: 'POST',
      path: '/exports',
      headers: { 'x-user-id': 'u1', 'x-user-role': 'owner', 'x-project-id': 'p1', 'x-project-tier': 'free' },
      body: {
        formatId: 'phase-a.format-a',
        doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] },
        documentTitle: 'Doc',
        sourceDocVersion: '1',
      },
    };
    const response = router()(request);
    expect(response.status).toBe(200);
    expect(response.headers['Content-Type']).toContain('wordprocessingml');
    expect(Buffer.isBuffer(response.body)).toBe(true);
  });

  it('unknown format returns 404', () => {
    const request: ApiRequest = {
      method: 'POST',
      path: '/exports',
      headers: { 'x-user-id': 'u1', 'x-user-role': 'owner', 'x-project-id': 'p1' },
      body: { formatId: 'phase-a.does-not-exist', doc: { type: 'doc', content: [] }, documentTitle: 't', sourceDocVersion: '1' },
    };
    const response = router()(request);
    expect(response.status).toBe(404);
  });

  it('unrecognised role returns 403', () => {
    const request: ApiRequest = {
      method: 'POST',
      path: '/exports',
      headers: { 'x-user-id': 'u1', 'x-user-role': 'not-a-real-role', 'x-project-id': 'p1' },
      body: {
        formatId: 'phase-a.format-a',
        doc: { type: 'doc', content: [] },
        documentTitle: 't',
        sourceDocVersion: '1',
      },
    };
    const response = router()(request);
    expect(response.status).toBe(403);
  });

  it('GET /formats/:id returns format metadata', () => {
    const response = router()({ method: 'GET', path: '/formats/phase-a.format-a', headers: {} });
    expect(response.status).toBe(200);
    expect((response.body as { formatId: string }).formatId).toBe('phase-a.format-a');
  });

  it('GET on an unknown route returns 404', () => {
    const response = router()({ method: 'GET', path: '/nope', headers: {} });
    expect(response.status).toBe(404);
  });

  describe('POST /exports/from-answers', () => {
    const SKELETON: DocumentSkeleton = {
      formatId: 'phase-a.format-a',
      skeletonVersion: 'v1',
      doc: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1, locked: true }, content: [{ type: 'text', text: 'Title' }] },
          { type: 'paragraph', attrs: { fillIn: true, slotId: 'body' }, content: [] },
        ],
      },
    };

    beforeEach(() => {
      writeFileSync(join(root, 'phase-a', 'format-a', 'document-skeleton.json'), JSON.stringify(SKELETON, null, 2));
    });

    it('merges the platform-supplied private answers into the shared skeleton and returns a docx', () => {
      const request: ApiRequest = {
        method: 'POST',
        path: '/exports/from-answers',
        headers: { 'x-user-id': 'u1', 'x-user-role': 'owner', 'x-project-id': 'p1', 'x-project-tier': 'free' },
        body: {
          formatId: 'phase-a.format-a',
          answers: { body: 'What the user actually typed on the platform.' },
          documentTitle: 'Doc',
          sourceDocVersion: '1',
        },
      };
      const response = router()(request);
      expect(response.status).toBe(200);
      expect(response.headers['Content-Type']).toContain('wordprocessingml');
      expect(Buffer.isBuffer(response.body)).toBe(true);
    });

    it('without identity headers returns 400', () => {
      const request: ApiRequest = {
        method: 'POST',
        path: '/exports/from-answers',
        headers: {},
        body: { formatId: 'phase-a.format-a', answers: { body: 'x' }, documentTitle: 't', sourceDocVersion: '1' },
      };
      const response = router()(request);
      expect(response.status).toBe(400);
    });

    it('a format with no skeleton returns a structured error, not a crash', () => {
      const bareRoot = mkdtempSync(join(tmpdir(), 'export-engine-routes-bare-'));
      const dir = join(bareRoot, 'phase-a', 'format-a');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'config.json'), JSON.stringify(config(), null, 2));
      writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta(), null, 2));
      writeFileSync(join(dir, 'template.dotx'), TEMPLATE);

      const bareRouter = createRouter({ service: new ExportService({ resolveOptions: { root: bareRoot } }) });
      const request: ApiRequest = {
        method: 'POST',
        path: '/exports/from-answers',
        headers: { 'x-user-id': 'u1', 'x-user-role': 'owner', 'x-project-id': 'p1' },
        body: { formatId: 'phase-a.format-a', answers: { body: 'x' }, documentTitle: 't', sourceDocVersion: '1' },
      };
      const response = bareRouter(request);
      expect(response.status).toBe(404);
      expect((response.body as { error: { code: string } }).error.code).toBe('UNKNOWN_FORMAT');
      rmSync(bareRoot, { recursive: true, force: true });
    });
  });
});
