/**
 * Structured error -> HTTP status.
 *
 * A validation failure must reach the client as the same structured shape the validator produced,
 * with a status that says what actually went wrong — never a generic 500.
 */

import { ExportEngineError, type ErrorCode, type StructuredErrorShape } from '../core/errors.js';

const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  BAD_REQUEST: 400,
  MALFORMED_PROSEMIRROR: 400,
  UNKNOWN_NODE_TYPE: 400,
  IR_SCHEMA_INVALID: 400,
  ENTITLEMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  UNKNOWN_FORMAT: 404,
  FORMAT_NOT_ACTIVE: 404,
  JOB_NOT_FOUND: 404,
  DRAFT_NOT_FOUND: 404,
  TEMPLATE_NOT_FOUND: 404,
  REVIEW_REQUIRED: 409,
  MISSING_REQUIRED_BLOCKS: 422,
  MISSING_BLOCK_KIND: 422,
  CONFIG_SCHEMA_INVALID: 422,
  STYLE_MAP_LINT_FAILED: 422,
  UNSUPPORTED_SOURCE: 415,
  DUPLICATE_PLUGIN: 409,
  PLUGIN_FAILED: 422,
  REGISTRY_OUT_OF_SYNC: 500,
  RENDER_FAILED: 500,
  EXTRACTION_FAILED: 500,
  PUBLISH_FAILED: 500,
  UNSUPPORTED_IMAGE: 422,
};

export function statusFor(error: ExportEngineError): number {
  return STATUS_BY_CODE[error.code] ?? 500;
}

export function toHttpError(err: unknown): { status: number; body: { error: StructuredErrorShape } } {
  const structured = ExportEngineError.is(err)
    ? err
    : ExportEngineError.wrap(err, 'RENDER_FAILED', 'Unexpected server error');
  return { status: statusFor(structured), body: { error: structured.toJSON() } };
}
