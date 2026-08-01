/**
 * Route handlers, expressed as plain functions over a small request/response shape.
 *
 * Keeping the routing framework-free means the handlers are directly unit-testable and the service
 * can be mounted inside whatever HTTP layer the platform already uses.
 */

import { readFileSync } from 'node:fs';
import { ExportEngineError } from '../core/errors.js';
import type { PMDoc } from '../core/types.js';
import { formatDir, readRegistry, resolveFormat, resolveSkeleton, scanFormats } from '../format-registry/resolver.js';
import {
  lintDraft,
  listDrafts,
  publishDraft,
  readDraft,
  saveDraft,
} from '../format-registry/publish.js';
import { extractOutline } from '../template-extraction/index.js';
import {
  DOCX_CONTENT_TYPE,
  ExportService,
  type AnswersExportRequest,
  type ExportRequest,
  type Principal,
} from './export-service.js';
import { toHttpError } from './http-errors.js';

export interface ApiRequest {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  body?: unknown;
}

export interface ApiResponse {
  status: number;
  headers: Record<string, string>;
  /** JSON body, or raw bytes for a `.docx` download. */
  body: unknown;
}

export interface RouterOptions {
  service: ExportService;
  /** Set false to hide the staging/publish routes (they are admin-only). */
  enableAdminRoutes?: boolean;
}

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

export function principalFrom(headers: Record<string, string | undefined>): Principal {
  const userId = headers['x-user-id'];
  const role = headers['x-user-role'];
  const projectId = headers['x-project-id'];
  if (!userId || !role || !projectId) {
    throw new ExportEngineError('BAD_REQUEST', 'Missing caller identity', [
      {
        message:
          'x-user-id, x-user-role and x-project-id are required. Authentication happens upstream; this service authorises.',
      },
    ]);
  }
  return { userId, role, projectId, tier: headers['x-project-tier'] ?? 'free' };
}

export function createRouter(options: RouterOptions): (request: ApiRequest) => ApiResponse {
  const { service } = options;
  const adminEnabled = options.enableAdminRoutes !== false;

  return function handle(request: ApiRequest): ApiResponse {
    try {
      return route(request);
    } catch (err) {
      const { status, body } = toHttpError(err);
      return { status, headers: JSON_HEADERS, body };
    }
  };

  function route(request: ApiRequest): ApiResponse {
    const { method, path } = request;

    if (method === 'GET' && path === '/health') {
      return json(200, { status: 'ok' });
    }

    // --- formats ----------------------------------------------------------
    if (method === 'GET' && path === '/formats') {
      const registry = readRegistry(service.resolveOptions.root);
      return json(200, { formats: registry.filter((entry) => entry.status === 'active') });
    }

    const formatMatch = /^\/formats\/([a-z0-9-]+\.[a-z0-9-]+)$/.exec(path);
    if (method === 'GET' && formatMatch) {
      const format = resolveFormat(formatMatch[1]!, service.resolveOptions);
      return json(200, {
        formatId: format.config.formatId,
        displayName: format.config.displayName,
        phaseId: format.config.phaseId,
        version: format.config.version,
        status: format.meta.status,
        sectionOrder: format.meta.sectionOrder,
        requiredBlocks: format.meta.requiredBlocks,
        entitlement: format.meta.entitlement ?? { tier: 'free' },
        page: format.config.page,
        toc: format.config.toc,
        pageNumbering: format.config.pageNumbering,
      });
    }

    const skeletonMatch = /^\/formats\/([a-z0-9-]+\.[a-z0-9-]+)\/skeleton$/.exec(path);
    if (method === 'GET' && skeletonMatch) {
      const formatId = skeletonMatch[1]!;
      // Deliberately does not require `active` status — a reviewer previewing a freshly-extracted
      // draft (the extract-research-format skill always produces status: "draft") needs to be able
      // to fetch its skeleton before anyone publishes it.
      if (!formatDir(formatId, service.resolveOptions.root)) {
        return json(404, { error: { code: 'UNKNOWN_FORMAT', message: `"${formatId}" is not a valid formatId`, details: [] } });
      }
      const skeleton = resolveSkeleton(formatId, service.resolveOptions);
      if (!skeleton) {
        return json(404, {
          error: { code: 'UNKNOWN_FORMAT', message: `Format "${formatId}" has no document-skeleton.json`, details: [] },
        });
      }
      return json(200, skeleton);
    }

    // --- exports ----------------------------------------------------------
    if (method === 'POST' && path === '/exports') {
      const principal = principalFrom(request.headers);
      const body = asObject(request.body, 'request body');
      const exportRequest: ExportRequest = {
        formatId: requireString(body.formatId, 'formatId'),
        doc: requireDoc(body.doc),
        documentTitle: requireString(body.documentTitle, 'documentTitle'),
        sourceDocVersion: requireString(body.sourceDocVersion, 'sourceDocVersion'),
        principal,
        ...(typeof body.mode === 'string' ? { mode: body.mode as ExportRequest['mode'] } : {}),
      };

      const result = service.export(exportRequest);
      if (result.kind === 'async') {
        return json(202, {
          jobId: result.job.id,
          status: result.job.status,
          formatId: result.job.formatId,
          statusUrl: `/exports/jobs/${result.job.id}`,
        });
      }

      return {
        status: 200,
        headers: {
          'Content-Type': DOCX_CONTENT_TYPE,
          'Content-Disposition': `attachment; filename="${result.output.filename}"`,
          'X-Export-Id': result.output.exportId,
          'X-Format-Version': result.output.formatVersion,
        },
        body: result.output.bytes,
      };
    }

    // The collab platform's real "click export" entry point: the platform sends the user's private
    // fill-in content (keyed by slotId), not a complete doc — this route merges it into the
    // matching shared skeleton and otherwise behaves exactly like `POST /exports` (same response
    // shapes, same async job ids usable against the routes below).
    if (method === 'POST' && path === '/exports/from-answers') {
      const principal = principalFrom(request.headers);
      const body = asObject(request.body, 'request body');
      const answersRequest: AnswersExportRequest = {
        formatId: requireString(body.formatId, 'formatId'),
        answers: asObject(body.answers, 'answers') as AnswersExportRequest['answers'],
        documentTitle: requireString(body.documentTitle, 'documentTitle'),
        sourceDocVersion: requireString(body.sourceDocVersion, 'sourceDocVersion'),
        principal,
        ...(typeof body.mode === 'string' ? { mode: body.mode as AnswersExportRequest['mode'] } : {}),
      };

      const result = service.exportFromAnswers(answersRequest);
      if (result.kind === 'async') {
        return json(202, {
          jobId: result.job.id,
          status: result.job.status,
          formatId: result.job.formatId,
          statusUrl: `/exports/jobs/${result.job.id}`,
        });
      }

      return {
        status: 200,
        headers: {
          'Content-Type': DOCX_CONTENT_TYPE,
          'Content-Disposition': `attachment; filename="${result.output.filename}"`,
          'X-Export-Id': result.output.exportId,
          'X-Format-Version': result.output.formatVersion,
        },
        body: result.output.bytes,
      };
    }

    const jobMatch = /^\/exports\/jobs\/([A-Za-z0-9-]+)$/.exec(path);
    if (method === 'GET' && jobMatch) {
      const job = service.jobStore.get(jobMatch[1]!);
      if (!job) throw new ExportEngineError('JOB_NOT_FOUND', `No export job with id "${jobMatch[1]}"`);
      return json(200, {
        jobId: job.id,
        status: job.status,
        formatId: job.formatId,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        ...(job.status === 'done'
          ? { downloadUrl: `/exports/jobs/${job.id}/download`, warnings: job.result?.warnings ?? [] }
          : {}),
        ...(job.error ? { error: job.error } : {}),
      });
    }

    const downloadMatch = /^\/exports\/jobs\/([A-Za-z0-9-]+)\/download$/.exec(path);
    if (method === 'GET' && downloadMatch) {
      const job = service.jobStore.get(downloadMatch[1]!);
      if (!job) throw new ExportEngineError('JOB_NOT_FOUND', `No export job with id "${downloadMatch[1]}"`);
      if (job.status !== 'done' || !job.result) {
        return json(409, { error: { code: 'JOB_NOT_READY', message: `Job is ${job.status}`, details: [] } });
      }
      return {
        status: 200,
        headers: {
          'Content-Type': DOCX_CONTENT_TYPE,
          'Content-Disposition': `attachment; filename="${job.result.filename}"`,
        },
        body: job.result.bytes,
      };
    }

    // --- onboarding / staging / publish (admin) ---------------------------
    if (adminEnabled && method === 'POST' && path === '/onboarding/extract') {
      const body = asObject(request.body, 'request body');
      const filename = requireString(body.filename, 'filename');
      const bytes = body.contentBase64
        ? Buffer.from(requireString(body.contentBase64, 'contentBase64'), 'base64')
        : readFileSync(requireString(body.path, 'path'));
      return json(200, { outline: extractOutline(bytes, filename) });
    }

    if (adminEnabled && method === 'GET' && path === '/staging/drafts') {
      return json(200, {
        drafts: listDrafts().map((draft) => ({
          draftId: draft.draftId,
          formatId: draft.config.formatId,
          displayName: draft.config.displayName,
          hasTemplate: draft.hasTemplate,
          hasExtractionOutline: draft.hasExtractionOutline,
          lintOk: draft.styleDiffReport?.ok ?? null,
        })),
      });
    }

    const draftMatch = /^\/staging\/drafts\/([A-Za-z0-9._-]+)$/.exec(path);
    if (adminEnabled && draftMatch) {
      const draftId = draftMatch[1]!;
      if (method === 'GET') {
        const draft = readDraft(draftId);
        return json(200, {
          draftId: draft.draftId,
          config: draft.config,
          meta: draft.meta,
          hasTemplate: draft.hasTemplate,
          hasExtractionOutline: draft.hasExtractionOutline,
          styleDiffReport: draft.styleDiffReport ?? null,
        });
      }
      if (method === 'PUT') {
        const body = asObject(request.body, 'request body');
        const draft = saveDraft(
          draftId,
          asObject(body.config, 'config') as never,
          asObject(body.meta, 'meta') as never,
          {
            ...(typeof body.templateBase64 === 'string'
              ? { templateBytes: Buffer.from(body.templateBase64, 'base64') }
              : {}),
          },
        );
        return json(200, { draftId: draft.draftId, saved: true });
      }
    }

    const lintMatch = /^\/staging\/drafts\/([A-Za-z0-9._-]+)\/lint$/.exec(path);
    if (adminEnabled && method === 'POST' && lintMatch) {
      return json(200, { report: lintDraft(lintMatch[1]!) });
    }

    const publishMatch = /^\/staging\/drafts\/([A-Za-z0-9._-]+)\/publish$/.exec(path);
    if (adminEnabled && method === 'POST' && publishMatch) {
      const body = asObject(request.body, 'request body');
      const result = publishDraft(publishMatch[1]!, {
        reviewedBy: requireString(body.reviewedBy, 'reviewedBy'),
        ...(body.allowSelfReview === true ? { allowSelfReview: true } : {}),
      });
      return json(200, { published: result, registry: scanFormats().length });
    }

    return json(404, {
      error: { code: 'NOT_FOUND', message: `No route for ${method} ${path}`, details: [] },
    });
  }
}

function json(status: number, body: unknown): ApiResponse {
  return { status, headers: JSON_HEADERS, body };
}

function asObject(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ExportEngineError('BAD_REQUEST', `Expected ${what} to be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ExportEngineError('BAD_REQUEST', `"${field}" is required and must be a non-empty string`);
  }
  return value;
}

function requireDoc(value: unknown): PMDoc {
  if (!value || typeof value !== 'object' || (value as PMDoc).type !== 'doc') {
    throw new ExportEngineError('BAD_REQUEST', '"doc" must be a ProseMirror document node');
  }
  return value as PMDoc;
}
