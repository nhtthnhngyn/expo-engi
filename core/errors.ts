/**
 * Structured errors.
 *
 * Every failure surfaced by the engine is an `ExportEngineError` carrying a stable machine-readable
 * `code`, a human-readable `message`, and a `details` payload. Callers (the API layer in
 * particular) render these verbatim; nothing in the engine throws a bare `Error` across a component
 * boundary.
 */

export type ErrorCode =
  // normalizer
  | 'MALFORMED_PROSEMIRROR'
  | 'UNKNOWN_NODE_TYPE'
  | 'PLUGIN_FAILED'
  | 'MISSING_BLOCK_KIND'
  // block plugin registry
  | 'DUPLICATE_PLUGIN'
  // validator
  | 'MISSING_REQUIRED_BLOCKS'
  | 'IR_SCHEMA_INVALID'
  // format registry resolver
  | 'UNKNOWN_FORMAT'
  | 'FORMAT_NOT_ACTIVE'
  | 'CONFIG_SCHEMA_INVALID'
  | 'TEMPLATE_NOT_FOUND'
  | 'STYLE_MAP_LINT_FAILED'
  | 'REGISTRY_OUT_OF_SYNC'
  // renderer
  | 'RENDER_FAILED'
  | 'UNSUPPORTED_IMAGE'
  // api
  | 'ENTITLEMENT_REQUIRED'
  | 'FORBIDDEN'
  | 'BAD_REQUEST'
  | 'JOB_NOT_FOUND'
  // extraction
  | 'EXTRACTION_FAILED'
  | 'UNSUPPORTED_SOURCE'
  // admin / publish
  | 'DRAFT_NOT_FOUND'
  | 'REVIEW_REQUIRED'
  | 'PUBLISH_FAILED';

export interface ErrorDetail {
  /** Dotted path into the offending input, when one applies (e.g. `doc.content[3].content[0]`). */
  path?: string;
  /** IR block id the problem is tied to, when one applies. */
  blockId?: string;
  message: string;
  [key: string]: unknown;
}

export interface StructuredErrorShape {
  code: ErrorCode;
  message: string;
  details: ErrorDetail[];
}

export class ExportEngineError extends Error {
  readonly code: ErrorCode;
  readonly details: ErrorDetail[];

  constructor(code: ErrorCode, message: string, details: ErrorDetail[] = []) {
    super(message);
    this.name = 'ExportEngineError';
    this.code = code;
    this.details = details;
  }

  toJSON(): StructuredErrorShape {
    return { code: this.code, message: this.message, details: this.details };
  }

  static is(err: unknown): err is ExportEngineError {
    return err instanceof ExportEngineError;
  }

  /** Wraps anything thrown into a structured error so no raw exception escapes a boundary. */
  static wrap(err: unknown, code: ErrorCode, message: string, extra: ErrorDetail[] = []): ExportEngineError {
    if (ExportEngineError.is(err)) return err;
    const cause = err instanceof Error ? err.message : String(err);
    return new ExportEngineError(code, message, [...extra, { message: cause }]);
  }
}
