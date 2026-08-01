/**
 * Export service: the pipeline, with the gates around it.
 *
 * Order matters and is deliberate — resolve the format, check RBAC, check entitlement, normalize,
 * validate, render, then audit. Cheap rejections happen before expensive work, and the audit entry
 * is written once, on success, with the exact format version and content version used.
 */

import { randomUUID } from 'node:crypto';
import type { CanonicalIR, DocumentAnswers, IRMeta, PMDoc, PMNode } from '../core/types.js';
import { ExportEngineError } from '../core/errors.js';
import { normalize } from '../normalizer/index.js';
import { createDefaultPluginRegistry, type BlockPluginRegistry } from '../normalizer/plugins/index.js';
import { validateIr } from '../validator/index.js';
import { resolveFormat, resolveSkeleton, type ResolveOptions } from '../format-registry/resolver.js';
import { mergeAnswersIntoSkeleton } from '../format-registry/answers-merge.js';
import { renderToDocx } from '../renderer/index.js';
import { assertCanExportPhase } from './rbac.js';
import { assertEntitled } from './entitlements.js';
import { assertValid, validateDocumentAnswers } from '../schemas/index.js';
import { InMemoryAuditLog, type AuditEntry, type AuditLog } from './audit-log.js';
import { InMemoryJobStore, type Job, type JobStore } from './jobs.js';

export const DOCX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Documents above this many top-level nodes are pushed to the async path. */
export const SYNC_NODE_LIMIT = 1500;

export interface Principal {
  userId: string;
  role: string;
  projectId: string;
  /** The project's entitlement tier. */
  tier: string;
}

export interface ExportRequest {
  formatId: string;
  doc: PMDoc;
  documentTitle: string;
  sourceDocVersion: string;
  principal: Principal;
  /** `auto` (default) sends large documents to the async path. */
  mode?: 'sync' | 'async' | 'auto';
}

/**
 * The platform's real "click export" shape: the user's private, per-project fill-in content
 * (schemas/document-answers.schema.json's `answers`, keyed by the slotId the platform's own editor
 * tagged each block with) instead of a complete ProseMirror doc. See `ExportService.exportFromAnswers`.
 */
export interface AnswersExportRequest {
  formatId: string;
  answers: Record<string, string | PMNode[]>;
  documentTitle: string;
  sourceDocVersion: string;
  principal: Principal;
  mode?: 'sync' | 'async' | 'auto';
}

export interface ExportOutput {
  exportId: string;
  bytes: Buffer;
  filename: string;
  contentType: string;
  formatId: string;
  formatVersion: string;
  warnings: string[];
  ir: CanonicalIR;
}

export interface ExportServiceOptions {
  auditLog?: AuditLog;
  jobStore?: JobStore;
  pluginRegistry?: BlockPluginRegistry;
  resolveOptions?: ResolveOptions;
  /** Injectable clock — tests need a fixed one, and determinism forbids hidden `Date.now()`. */
  now?: () => Date;
  /** Injectable id generator, for the same reason. */
  newId?: () => string;
}

export class ExportService {
  readonly auditLog: AuditLog;
  readonly jobStore: JobStore;
  /** Public so the router can resolve/list formats against the same registry root as exports. */
  readonly resolveOptions: ResolveOptions;
  private readonly plugins: BlockPluginRegistry;
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(options: ExportServiceOptions = {}) {
    this.auditLog = options.auditLog ?? new InMemoryAuditLog();
    this.jobStore = options.jobStore ?? new InMemoryJobStore();
    this.plugins = options.pluginRegistry ?? createDefaultPluginRegistry();
    this.resolveOptions = options.resolveOptions ?? {};
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => randomUUID());
  }

  /** True when a document is small enough for the sync path. */
  static fitsSyncPath(doc: PMDoc): boolean {
    return (doc.content?.length ?? 0) <= SYNC_NODE_LIMIT;
  }

  /** Runs the full pipeline and writes exactly one audit entry on success. */
  exportSync(request: ExportRequest): ExportOutput {
    return this.run(request, 'sync');
  }

  /** Creates a job, runs it, and returns the job. Kept explicit so a queue can replace `run`. */
  exportAsync(request: ExportRequest): Job {
    const at = this.now().toISOString();
    const jobId = this.newId();
    this.jobStore.create(jobId, request.formatId, at);
    this.jobStore.update(jobId, { status: 'running' }, at);

    try {
      const output = this.run(request, 'async');
      return this.jobStore.update(
        jobId,
        {
          status: 'done',
          result: { bytes: output.bytes, filename: output.filename, warnings: output.warnings },
        },
        this.now().toISOString(),
      );
    } catch (err) {
      const structured = ExportEngineError.wrap(err, 'RENDER_FAILED', 'Export job failed');
      return this.jobStore.update(
        jobId,
        { status: 'failed', error: structured.toJSON() },
        this.now().toISOString(),
      );
    }
  }

  /** Routes to sync or async per `mode` and document size. */
  export(request: ExportRequest): { kind: 'sync'; output: ExportOutput } | { kind: 'async'; job: Job } {
    const mode = request.mode ?? 'auto';
    if (mode === 'async' || (mode === 'auto' && !ExportService.fitsSyncPath(request.doc))) {
      return { kind: 'async', job: this.exportAsync(request) };
    }
    return { kind: 'sync', output: this.exportSync(request) };
  }

  /**
   * The platform's real "click export" entry point: takes the user's private fill-in content
   * (already keyed by slotId on the platform's own editor) instead of a complete document, resolves
   * the matching format's shared skeleton, merges the two with `mergeAnswersIntoSkeleton`, and
   * hands the resulting complete document to `export()` unchanged — so it goes through the exact
   * same RBAC gate, entitlement gate, audit entry, and sync/async routing as any other export. This
   * is the one place "private content" and "shared /formats content" actually meet.
   */
  exportFromAnswers(
    request: AnswersExportRequest,
  ): { kind: 'sync'; output: ExportOutput } | { kind: 'async'; job: Job } {
    const format = resolveFormat(request.formatId, this.resolveOptions);
    const skeleton = resolveSkeleton(request.formatId, this.resolveOptions);
    if (!skeleton) {
      throw new ExportEngineError(
        'UNKNOWN_FORMAT',
        `Format "${format.config.formatId}" has no document-skeleton.json — there is no shared skeleton to merge private answers into`,
      );
    }

    const documentAnswers: DocumentAnswers = { formatId: request.formatId, answers: request.answers };
    assertValid(
      validateDocumentAnswers,
      documentAnswers,
      'BAD_REQUEST',
      'answers do not satisfy document-answers.schema.json',
    );

    const { doc } = mergeAnswersIntoSkeleton(skeleton, documentAnswers);

    return this.export({
      formatId: request.formatId,
      doc,
      documentTitle: request.documentTitle,
      sourceDocVersion: request.sourceDocVersion,
      principal: request.principal,
      ...(request.mode ? { mode: request.mode } : {}),
    });
  }

  private run(request: ExportRequest, mode: 'sync' | 'async'): ExportOutput {
    const { principal } = request;
    if (!principal?.userId || !principal.role || !principal.projectId) {
      throw new ExportEngineError('BAD_REQUEST', 'An export requires a principal with userId, role and projectId');
    }

    const format = resolveFormat(request.formatId, this.resolveOptions);

    assertCanExportPhase(principal.role, format.config.phaseId, format.config.formatId);
    assertEntitled(principal.tier ?? 'free', format.meta, format.config.displayName);

    const generatedAt = this.now().toISOString();
    const irMeta: IRMeta = {
      formatId: format.config.formatId,
      documentTitle: request.documentTitle,
      projectId: principal.projectId,
      generatedAt,
      sourceDocVersion: request.sourceDocVersion,
    };

    const ir = normalize(request.doc, {
      meta: irMeta,
      registry: this.plugins,
      fallback: format.meta.fallback?.unknownBlockKind ?? 'renderAsPlainParagraph',
    });

    validateIr(ir, format.meta);

    const rendered = renderToDocx(ir, format);
    const exportId = this.newId();

    const entry: AuditEntry = {
      exportId,
      at: generatedAt,
      userId: principal.userId,
      role: principal.role,
      projectId: principal.projectId,
      formatId: format.config.formatId,
      formatVersion: format.config.version,
      contentVersion: request.sourceDocVersion,
      mode,
      outputBytes: rendered.bytes.length,
      ...(rendered.warnings.length > 0 ? { warnings: rendered.warnings } : {}),
    };
    this.auditLog.write(entry);

    return {
      exportId,
      bytes: rendered.bytes,
      filename: filenameFor(request.documentTitle, format.config.formatId),
      contentType: DOCX_CONTENT_TYPE,
      formatId: format.config.formatId,
      formatVersion: format.config.version,
      warnings: rendered.warnings,
      ir,
    };
  }
}

export function filenameFor(documentTitle: string, formatId: string): string {
  const slug = documentTitle
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .toLowerCase();
  return `${slug || 'document'}.${formatId}.docx`;
}
