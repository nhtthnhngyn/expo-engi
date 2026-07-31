/**
 * The extraction outline: what the tool is allowed to produce.
 *
 * This file encodes the guardrail from spec sections 7 and 10 as a type *and* as a runtime check.
 * The outline reports structure that literally exists in the source file — style names verbatim,
 * numbering definitions, heading outline, table shapes. It must never contain `sectionOrder`,
 * `requiredBlocks` or `styleMap`: those are semantic judgments reserved for a human author.
 *
 * `assertNoSemantics` is the enforcement point, and it is tested.
 */

import { ExportEngineError } from '../core/errors.js';

export interface ExtractedStyle {
  styleId: string;
  /** Verbatim from the source file. Never invented, never normalised into a new name. */
  name: string;
  type: string;
  basedOn?: string;
  outlineLevel?: number;
  font?: string;
  sizeHalfPoints?: number;
  bold?: boolean;
  italic?: boolean;
}

export interface ExtractedNumberingLevel {
  ilvl: number;
  numFmt?: string;
  lvlText?: string;
  indentLeft?: number;
}

export interface ExtractedNumbering {
  numId?: string;
  abstractNumId: string;
  levels: ExtractedNumberingLevel[];
}

export interface ExtractedHeading {
  /** Outline level as recorded in the file (docx) or inferred by the size heuristic (pdf). */
  level: number;
  text: string;
  /** The style that produced it, when the source records one. */
  styleName?: string;
  /** For PDF sources: what the heuristic keyed on, so an author can judge how much to trust it. */
  evidence?: string;
}

export interface ExtractedTable {
  index: number;
  rows: number;
  columns: number;
  hasHeaderRow: boolean;
  firstRowCells?: string[];
}

export interface ExtractedHeaderFooter {
  part: string;
  text: string;
}

export interface ExtractionOutline {
  generator: { tool: string; version: string; deterministic: true; usesGenerativeModel: false };
  source: {
    filename: string;
    kind: 'docx' | 'dotx' | 'pdf';
    byteLength: number;
    sha256: string;
  };
  styles: ExtractedStyle[];
  numbering: ExtractedNumbering[];
  headingOutline: ExtractedHeading[];
  tables: ExtractedTable[];
  headersFooters: ExtractedHeaderFooter[];
  /** Populated when a source could only be parsed partially — the job still returns a result. */
  warnings: string[];
  /**
   * Restated in the artifact itself so it survives being copied around: this file is reference
   * material for a human author, not a config.
   */
  notice: string;
}

export const OUTLINE_NOTICE =
  'Read-only structural extraction. Reports only what was found in the source file. ' +
  'It contains no sectionOrder, requiredBlocks or styleMap — those are authored by a human and reviewed before publishing.';

export const TOOL_INFO = {
  tool: 'export-engine/template-extraction',
  version: '1.0.0',
  deterministic: true,
  usesGenerativeModel: false,
} as const;

/** Fields the outline may never carry. Checked at runtime, not just at the type level. */
export const FORBIDDEN_OUTLINE_FIELDS = ['sectionOrder', 'requiredBlocks', 'styleMap'] as const;

export function assertNoSemantics(outline: unknown): void {
  const found: string[] = [];
  const walk = (value: unknown, path: string): void => {
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if ((FORBIDDEN_OUTLINE_FIELDS as readonly string[]).includes(key)) {
        found.push(`${path}.${key}`.replace(/^\./, ''));
      }
      walk(child, `${path}.${key}`);
    }
  };
  walk(outline, '');

  if (found.length > 0) {
    throw new ExportEngineError(
      'EXTRACTION_FAILED',
      'The extraction outline contains config semantics it is not allowed to author',
      found.map((path) => ({
        path,
        message: `"${path}" is a semantic decision reserved for the human author (spec sections 7 and 10)`,
      })),
    );
  }
}
