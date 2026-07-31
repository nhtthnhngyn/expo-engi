#!/usr/bin/env tsx
/**
 * Node HTTP binding for the router.
 *
 * Thin on purpose: read the request, hand it to `createRouter`, write the response. Everything
 * interesting is in `routes.ts` and the pipeline underneath it.
 */

import { createServer, type Server } from 'node:http';
import { ExportService } from './export-service.js';
import { createRouter, type ApiRequest } from './routes.js';

export interface ServerOptions {
  service?: ExportService;
  enableAdminRoutes?: boolean;
  /** Reject bodies larger than this. Large documents belong on the async path anyway. */
  maxBodyBytes?: number;
}

const DEFAULT_MAX_BODY = 25 * 1024 * 1024;

export function createExportServer(options: ServerOptions = {}): Server {
  const service = options.service ?? new ExportService();
  const handle = createRouter({
    service,
    ...(options.enableAdminRoutes !== undefined ? { enableAdminRoutes: options.enableAdminRoutes } : {}),
  });
  const maxBody = options.maxBodyBytes ?? DEFAULT_MAX_BODY;

  return createServer((req, res) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBody) {
        aborted = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { code: 'BAD_REQUEST', message: `Request body exceeds ${maxBody} bytes`, details: [] },
          }),
        );
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (aborted) return;

      const raw = Buffer.concat(chunks).toString('utf8');
      let body: unknown;
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: { code: 'BAD_REQUEST', message: 'Request body is not valid JSON', details: [] },
            }),
          );
          return;
        }
      }

      const url = new URL(req.url ?? '/', 'http://localhost');
      const request: ApiRequest = {
        method: req.method ?? 'GET',
        path: url.pathname,
        headers: normaliseHeaders(req.headers),
        body,
      };

      const response = handle(request);
      const payload = Buffer.isBuffer(response.body)
        ? response.body
        : Buffer.from(JSON.stringify(response.body ?? null), 'utf8');

      res.writeHead(response.status, { ...response.headers, 'Content-Length': String(payload.length) });
      res.end(payload);
    });
  });
}

function normaliseHeaders(headers: NodeJS.Dict<string | string[]>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
  }
  return out;
}

// Started directly (`npm run api`) rather than imported.
if (process.argv[1] && process.argv[1].endsWith('server.ts')) {
  const port = Number(process.env.PORT ?? 4000);
  createExportServer().listen(port, () => {
    process.stdout.write(`Export engine API listening on http://localhost:${port}\n`);
  });
}
