#!/usr/bin/env tsx
/**
 * Admin UI: author, lint, review, publish a format config.
 *
 * This is a CRUD surface over `/formats-staging`, not a new pipeline — every action here calls the
 * same functions `npm run render:fixture` and `npm run lint:stylemap` use. There is no format- or
 * phase-specific code in this file; it renders whatever `styleMap` keys and `sectionOrder` entries
 * the draft under edit happens to have.
 */

import { createServer } from 'node:http';
import { ExportEngineError } from '../core/errors.js';
import { readRegistry, scanFormats } from '../format-registry/resolver.js';
import { FORMATS_DIR } from '../format-registry/paths.js';
import { lintDraft, listDrafts, publishDraft, readDraft, saveDraft } from '../format-registry/publish.js';
import { renderPage } from './render.js';
import type { FormatConfig, FormatMeta } from '../core/types.js';

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createAdminServer() {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const send = (status: number, contentType: string, body: string): void => {
      res.writeHead(status, { 'Content-Type': contentType });
      res.end(body);
    };
    const sendJson = (status: number, body: unknown): void => send(status, 'application/json', JSON.stringify(body, null, 2));

    try {
      if (req.method === 'GET' && url.pathname === '/') {
        const published = scanFormats(FORMATS_DIR);
        const drafts = listDrafts();
        send(200, 'text/html; charset=utf-8', renderPage('dashboard', { published, drafts }));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/registry.json') {
        sendJson(200, readRegistry(FORMATS_DIR));
        return;
      }

      const draftMatch = /^\/drafts\/([A-Za-z0-9._-]+)$/.exec(url.pathname);
      if (req.method === 'GET' && draftMatch) {
        const draft = readDraft(draftMatch[1]!);
        send(200, 'text/html; charset=utf-8', renderPage('draft', { draft }));
        return;
      }

      if (req.method === 'PUT' && draftMatch) {
        const body = JSON.parse(await readBody(req)) as { config: FormatConfig; meta: FormatMeta };
        saveDraft(draftMatch[1]!, body.config, body.meta);
        sendJson(200, { saved: true });
        return;
      }

      const lintMatch = /^\/drafts\/([A-Za-z0-9._-]+)\/lint$/.exec(url.pathname);
      if (req.method === 'POST' && lintMatch) {
        sendJson(200, lintDraft(lintMatch[1]!));
        return;
      }

      const publishMatch = /^\/drafts\/([A-Za-z0-9._-]+)\/publish$/.exec(url.pathname);
      if (req.method === 'POST' && publishMatch) {
        const body = JSON.parse(await readBody(req)) as { reviewedBy: string; allowSelfReview?: boolean };
        const result = publishDraft(publishMatch[1]!, {
          reviewedBy: body.reviewedBy,
          ...(body.allowSelfReview ? { allowSelfReview: true } : {}),
        });
        sendJson(200, result);
        return;
      }

      send(404, 'text/plain', 'Not found');
    } catch (err) {
      const structured = ExportEngineError.is(err) ? err.toJSON() : { code: 'INTERNAL', message: String(err), details: [] };
      sendJson(err instanceof ExportEngineError ? 422 : 500, { error: structured });
    }
  });
}

if (process.argv[1] && process.argv[1].endsWith('server.ts')) {
  const port = Number(process.env.ADMIN_PORT ?? 4100);
  createAdminServer().listen(port, () => {
    process.stdout.write(`Admin UI listening on http://localhost:${port}\n`);
  });
}
