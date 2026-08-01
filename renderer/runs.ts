/**
 * IR runs -> WordprocessingML runs.
 *
 * Marks arrive as strings (`bold`, `link:https://…`). Everything here is keyed by mark name only —
 * there is no way for a format to change what `bold` means, and no format-specific branch.
 *
 * A block can also carry **direct formatting** from its resolved style source (a `headings.N` or
 * `styleMap.<key>` entry with `bold`/`italic`/`font`/`sizePt`, per FORMAT_CONFIG_GUIDE.md). That
 * formatting is the baseline for every run in the block; a run's own marks layer on top of it
 * (explicit `bold` mark still wins over an absent block-level bold, and vice versa nothing here
 * lets a mark *remove* formatting the block applies).
 *
 * Citation rendering is table-driven off `citationStyle`: numeric styles get a first-appearance
 * number, author-year styles get the citation key, and `none` renders the bare key with no
 * decoration. Unknown styles fall back to numeric, the most common convention in the medical
 * literature these formats target.
 */

import type { IRRun } from '../core/types.js';
import { escapeXml } from '../core/ooxml/xml.js';
import { RenderState } from './render-state.js';
import type { DirectFormatting } from '../format-registry/style-sources.js';

export interface CitationStyle {
  kind: 'numeric' | 'author-year' | 'bare';
  open: string;
  close: string;
  superscript: boolean;
}

/** Data, not logic: adding a citation style is a line in this table. */
export const CITATION_STYLES: Readonly<Record<string, CitationStyle>> = Object.freeze({
  'numbered-bracket': { kind: 'numeric', open: '[', close: ']', superscript: false },
  'author-date': { kind: 'author-year', open: '(', close: ')', superscript: false },
  none: { kind: 'bare', open: '', close: '', superscript: false },
  vancouver: { kind: 'numeric', open: '[', close: ']', superscript: false },
  'vancouver-superscript': { kind: 'numeric', open: '', close: '', superscript: true },
  ieee: { kind: 'numeric', open: '[', close: ']', superscript: false },
  numeric: { kind: 'numeric', open: '[', close: ']', superscript: false },
  apa: { kind: 'author-year', open: '(', close: ')', superscript: false },
  harvard: { kind: 'author-year', open: '(', close: ')', superscript: false },
  chicago: { kind: 'author-year', open: '(', close: ')', superscript: false },
});

const DEFAULT_CITATION_STYLE: CitationStyle = CITATION_STYLES.numeric!;

export interface RunContext {
  state: RenderState;
  citationStyle: string | undefined;
  /** styleId to apply to footnote reference marks, if the format maps one. */
  footnoteStyleId?: string | undefined;
  /** Direct formatting from the enclosing block's resolved style source — the baseline for every run. */
  blockDirect?: DirectFormatting;
  /** typography.language (BCP-47), applied as `w:lang` on every run when set. */
  language?: string | null | undefined;
}

interface ParsedMarks {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  superscript: boolean;
  subscript: boolean;
  isBreak: boolean;
  link?: string;
  footnote?: string;
  citation?: string;
}

export function parseMarks(marks: string[] | undefined): ParsedMarks {
  const parsed: ParsedMarks = {
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    superscript: false,
    subscript: false,
    isBreak: false,
  };
  for (const mark of marks ?? []) {
    const colon = mark.indexOf(':');
    const name = colon >= 0 ? mark.slice(0, colon) : mark;
    const value = colon >= 0 ? mark.slice(colon + 1) : '';
    switch (name) {
      case 'bold':
        parsed.bold = true;
        break;
      case 'italic':
        parsed.italic = true;
        break;
      case 'underline':
        parsed.underline = true;
        break;
      case 'strike':
        parsed.strike = true;
        break;
      case 'superscript':
        parsed.superscript = true;
        break;
      case 'subscript':
        parsed.subscript = true;
        break;
      case 'break':
        parsed.isBreak = true;
        break;
      case 'link':
        parsed.link = value;
        break;
      case 'footnote':
        parsed.footnote = value;
        break;
      case 'citation':
        parsed.citation = value;
        break;
      default:
        // Unknown marks are ignored rather than fatal: an editor that adds a new decorative mark
        // must not be able to break an export.
        break;
    }
  }
  return parsed;
}

/** Emits `<w:rPr>` in the element order the OOXML schema requires. */
export function runPropertiesXml(
  marks: ParsedMarks,
  styleId?: string,
  direct: DirectFormatting = {},
  language?: string | null,
): string {
  const parts: string[] = [];
  if (styleId) parts.push(`<w:rStyle w:val="${escapeXml(styleId)}"/>`);
  if (direct.font) {
    parts.push(`<w:rFonts w:ascii="${escapeXml(direct.font)}" w:hAnsi="${escapeXml(direct.font)}" w:cs="${escapeXml(direct.font)}"/>`);
  }
  if (language) parts.push(`<w:lang w:val="${escapeXml(language)}"/>`);
  if (marks.bold || direct.bold) parts.push('<w:b/>');
  if (marks.italic || direct.italic) parts.push('<w:i/>');
  if (marks.strike) parts.push('<w:strike/>');
  if (marks.underline || direct.underline) parts.push('<w:u w:val="single"/>');
  if (marks.superscript) parts.push('<w:vertAlign w:val="superscript"/>');
  else if (marks.subscript) parts.push('<w:vertAlign w:val="subscript"/>');
  if (direct.sizePt) {
    const halfPoints = Math.round(direct.sizePt * 2);
    parts.push(`<w:sz w:val="${halfPoints}"/><w:szCs w:val="${halfPoints}"/>`);
  }
  if (parts.length === 0) return '';
  return `<w:rPr>${parts.join('')}</w:rPr>`;
}

/** ST_Jc has no "justify" value — OOXML's word for justified text is "both". */
const JC_VALUE: Readonly<Record<string, string>> = Object.freeze({
  left: 'left',
  right: 'right',
  center: 'center',
  justify: 'both',
});

/** Emits the `<w:jc>` paragraph-alignment override a block's direct formatting may specify. */
export function directParagraphPropsXml(direct: DirectFormatting): string {
  return direct.alignment ? `<w:jc w:val="${JC_VALUE[direct.alignment]}"/>` : '';
}

export function runsXml(runs: IRRun[] | undefined, ctx: RunContext): string {
  if (!runs || runs.length === 0) return '';
  return runs.map((run) => singleRunXml(run, ctx)).join('');
}

function singleRunXml(run: IRRun, ctx: RunContext): string {
  const marks = parseMarks(run.marks);
  const rPr = runPropertiesXml(marks, undefined, ctx.blockDirect, ctx.language);

  const pieces: string[] = [];

  if (marks.isBreak) {
    pieces.push(`<w:r>${rPr}<w:br/></w:r>`);
  }

  if (run.text.length > 0) {
    const lines = run.text.split('\n');
    const body = lines
      .map((line, index) => {
        const br = index === 0 ? '' : '<w:br/>';
        return `${br}<w:t xml:space="preserve">${escapeXml(line)}</w:t>`;
      })
      .join('');
    pieces.push(`<w:r>${rPr}${body}</w:r>`);
  }

  if (marks.citation !== undefined) {
    pieces.push(citationRunXml(marks.citation, ctx));
  }

  if (marks.footnote !== undefined) {
    const footnoteId = ctx.state.addFootnote(marks.footnote);
    const refProps = ctx.footnoteStyleId
      ? `<w:rPr><w:rStyle w:val="${escapeXml(ctx.footnoteStyleId)}"/><w:vertAlign w:val="superscript"/></w:rPr>`
      : '<w:rPr><w:vertAlign w:val="superscript"/></w:rPr>';
    pieces.push(`<w:r>${refProps}<w:footnoteReference w:id="${footnoteId}"/></w:r>`);
  }

  const inner = pieces.join('');

  if (marks.link !== undefined && marks.link.length > 0) {
    const relId = ctx.state.addHyperlink(marks.link);
    return `<w:hyperlink r:id="${escapeXml(relId)}">${inner}</w:hyperlink>`;
  }

  return inner;
}

function citationRunXml(key: string, ctx: RunContext): string {
  const style = CITATION_STYLES[(ctx.citationStyle ?? '').toLowerCase()] ?? DEFAULT_CITATION_STYLE;
  const body = style.kind === 'numeric' ? String(ctx.state.citationNumber(key)) : key;
  const text = `${style.open}${body}${style.close}`;
  const rPr = style.superscript ? '<w:rPr><w:vertAlign w:val="superscript"/></w:rPr>' : '';
  return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}
