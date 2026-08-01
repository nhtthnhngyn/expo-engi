/**
 * Schema loading + compiled validators.
 *
 * The JSON Schemas are the contract (spec section 4); these compiled validators are the single
 * place the rest of the engine checks against them.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { ExportEngineError, type ErrorCode, type ErrorDetail } from '../core/errors.js';

const here = dirname(fileURLToPath(import.meta.url));

export const SCHEMA_DIR = here;

function load(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(here, name), 'utf8')) as Record<string, unknown>;
}

export const prosemirrorBaseSchema = load('prosemirror-base.schema.json');
export const canonicalIrSchema = load('canonical-ir.schema.json');
export const formatStyleSchema = load('format-style.schema.json');
export const formatMetaSchema = load('format-meta.schema.json');
export const documentSkeletonSchema = load('document-skeleton.schema.json');
export const documentAnswersSchema = load('document-answers.schema.json');
export const templateFactsSchema = load('template-facts.schema.json');

export const SCHEMA_FILES = [
  'prosemirror-base.schema.json',
  'canonical-ir.schema.json',
  'format-style.schema.json',
  'format-meta.schema.json',
  'document-skeleton.schema.json',
  'document-answers.schema.json',
  'template-facts.schema.json',
] as const;

const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
addFormats(ajv);

export const validateProseMirror: ValidateFunction = ajv.compile(prosemirrorBaseSchema);
export const validateCanonicalIr: ValidateFunction = ajv.compile(canonicalIrSchema);
export const validateFormatStyle: ValidateFunction = ajv.compile(formatStyleSchema);
export const validateFormatMeta: ValidateFunction = ajv.compile(formatMetaSchema);
export const validateDocumentSkeleton: ValidateFunction = ajv.compile(documentSkeletonSchema);
export const validateDocumentAnswers: ValidateFunction = ajv.compile(documentAnswersSchema);
export const validateTemplateFacts: ValidateFunction = ajv.compile(templateFactsSchema);

export function ajvErrorsToDetails(errors: ErrorObject[] | null | undefined): ErrorDetail[] {
  if (!errors) return [];
  return errors.map((e) => ({
    path: e.instancePath === '' ? '(root)' : e.instancePath,
    message: `${e.instancePath || '(root)'} ${e.message ?? 'is invalid'}`.trim(),
    keyword: e.keyword,
  }));
}

/** Runs a compiled validator and throws a structured error on failure. */
export function assertValid(
  validator: ValidateFunction,
  data: unknown,
  code: ErrorCode,
  message: string,
): void {
  if (validator(data)) return;
  throw new ExportEngineError(code, message, ajvErrorsToDetails(validator.errors));
}
