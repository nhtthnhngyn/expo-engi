/**
 * Structural extraction tool — the optional, deterministic assist for format onboarding.
 *
 * Its entire job is to save a human author from transcribing style names by hand. It reports what a
 * source file contains and nothing else: no `sectionOrder`, no `requiredBlocks`, no `styleMap`, no
 * generative model, no proposals. `writeOutline` re-checks that guarantee before anything hits
 * disk, so the constraint cannot be lost to a future edit.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { ExportEngineError } from '../core/errors.js';
import { extractFromDocx } from './docx-extractor.js';
import { extractFromPdf } from './pdf-extractor.js';
import { assertNoSemantics, type ExtractionOutline } from './outline.js';

export type SourceKind = 'docx' | 'dotx' | 'pdf';

export function detectKind(filename: string, bytes: Buffer): SourceKind {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.dotx')) return 'dotx';
  if (lower.endsWith('.docx')) return 'docx';
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString('latin1') === '%PDF') return 'pdf';
  if (bytes.length >= 2 && bytes.subarray(0, 2).toString('latin1') === 'PK') return 'docx';
  throw new ExportEngineError('UNSUPPORTED_SOURCE', `Cannot tell what kind of file "${filename}" is`, [
    { message: 'Supported reference documents: .docx, .dotx, .pdf' },
  ]);
}

export function extractOutline(bytes: Buffer, filename: string): ExtractionOutline {
  const kind = detectKind(filename, bytes);
  let outline: ExtractionOutline;
  try {
    outline = kind === 'pdf' ? extractFromPdf(bytes, filename) : extractFromDocx(bytes, filename);
  } catch (err) {
    throw ExportEngineError.wrap(err, 'EXTRACTION_FAILED', `Could not extract structure from "${filename}"`);
  }
  assertNoSemantics(outline);
  return outline;
}

export function extractOutlineFromFile(path: string): ExtractionOutline {
  return extractOutline(readFileSync(path), basename(path));
}

/** Writes the outline. Re-checks the no-semantics guarantee immediately before writing. */
export function writeOutline(outline: ExtractionOutline, path: string): void {
  assertNoSemantics(outline);
  writeFileSync(path, `${JSON.stringify(outline, null, 2)}\n`);
}

export { assertNoSemantics, FORBIDDEN_OUTLINE_FIELDS, OUTLINE_NOTICE, TOOL_INFO } from './outline.js';
export type { ExtractionOutline, ExtractedStyle, ExtractedHeading, ExtractedNumbering, ExtractedTable } from './outline.js';
export { extractFromDocx } from './docx-extractor.js';
export { extractFromPdf, assignHeadingLevels } from './pdf-extractor.js';
