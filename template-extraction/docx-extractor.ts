/**
 * Deterministic OOXML structural extraction.
 *
 * Fixed parsing rules over the parts a Word file actually contains:
 *   `styles.xml`    -> every named paragraph/character/table style, verbatim
 *   `numbering.xml` -> abstract numbering definitions and the nums that reference them
 *   `document.xml`  -> heading outline (by style outline level), table shapes
 *   `header*.xml` / `footer*.xml` -> their text
 *
 * No inference, no proposals. If a part is missing or unparseable, that becomes a warning and the
 * rest of the extraction still returns.
 */

import { createHash } from 'node:crypto';
import { zipRead } from '../core/ooxml/zip.js';
import { attr, findAll, parseXml, textOf, type XmlElement } from '../core/ooxml/xml.js';
import { ExportEngineError } from '../core/errors.js';
import {
  OUTLINE_NOTICE,
  TOOL_INFO,
  type ExtractedHeaderFooter,
  type ExtractedHeading,
  type ExtractedNumbering,
  type ExtractedStyle,
  type ExtractedTable,
  type ExtractionOutline,
} from './outline.js';

export function extractFromDocx(bytes: Buffer, filename: string): ExtractionOutline {
  const warnings: string[] = [];
  let files: Map<string, Buffer>;
  try {
    files = zipRead(bytes).files;
  } catch (err) {
    throw new ExportEngineError(
      'UNSUPPORTED_SOURCE',
      `"${filename}" is not a readable OOXML package: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const styles = safely(() => extractStyles(files), warnings, 'styles.xml', [] as ExtractedStyle[]);
  const numbering = safely(() => extractNumbering(files), warnings, 'numbering.xml', [] as ExtractedNumbering[]);
  const styleOutlineLevels = new Map<string, number>();
  for (const style of styles) {
    if (style.outlineLevel !== undefined) styleOutlineLevels.set(style.styleId, style.outlineLevel);
  }
  const styleNames = new Map(styles.map((style) => [style.styleId, style.name]));

  const document = safely(
    () => extractDocument(files, styleOutlineLevels, styleNames),
    warnings,
    'document.xml',
    { headingOutline: [] as ExtractedHeading[], tables: [] as ExtractedTable[] },
  );

  const headersFooters = safely(() => extractHeadersFooters(files), warnings, 'header/footer parts', [] as ExtractedHeaderFooter[]);

  return {
    generator: TOOL_INFO,
    source: {
      filename,
      kind: filename.toLowerCase().endsWith('.dotx') ? 'dotx' : 'docx',
      byteLength: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
    styles,
    numbering,
    headingOutline: document.headingOutline,
    tables: document.tables,
    headersFooters,
    warnings,
    notice: OUTLINE_NOTICE,
  };
}

function safely<T>(fn: () => T, warnings: string[], what: string, fallback: T): T {
  try {
    return fn();
  } catch (err) {
    warnings.push(`Could not fully parse ${what}: ${err instanceof Error ? err.message : String(err)}`);
    return fallback;
  }
}

function extractStyles(files: Map<string, Buffer>): ExtractedStyle[] {
  const part = files.get('word/styles.xml');
  if (!part) return [];
  const root = parseXml(part.toString('utf8'));

  return findAll(root, 'style')
    .map((el): ExtractedStyle | null => {
      const styleId = attr(el, 'styleId');
      if (!styleId) return null;

      const nameEl = el.children.find((child) => child.local === 'name');
      const basedOnEl = el.children.find((child) => child.local === 'basedOn');
      const pPr = el.children.find((child) => child.local === 'pPr');
      const rPr = el.children.find((child) => child.local === 'rPr');

      const outlineEl = pPr?.children.find((child) => child.local === 'outlineLvl');
      const outlineRaw = outlineEl ? attr(outlineEl, 'val') : undefined;

      const fontEl = rPr?.children.find((child) => child.local === 'rFonts');
      const szEl = rPr?.children.find((child) => child.local === 'sz');

      const style: ExtractedStyle = {
        styleId,
        name: (nameEl ? attr(nameEl, 'val') : undefined) ?? styleId,
        type: attr(el, 'type') ?? 'paragraph',
      };
      const basedOn = basedOnEl ? attr(basedOnEl, 'val') : undefined;
      if (basedOn) style.basedOn = basedOn;
      if (outlineRaw !== undefined && Number.isFinite(Number(outlineRaw))) style.outlineLevel = Number(outlineRaw);
      const font = fontEl ? attr(fontEl, 'ascii') : undefined;
      if (font) style.font = font;
      const size = szEl ? attr(szEl, 'val') : undefined;
      if (size !== undefined && Number.isFinite(Number(size))) style.sizeHalfPoints = Number(size);
      if (rPr?.children.some((child) => child.local === 'b')) style.bold = true;
      if (rPr?.children.some((child) => child.local === 'i')) style.italic = true;
      return style;
    })
    .filter((style): style is ExtractedStyle => style !== null)
    .sort((a, b) => a.styleId.localeCompare(b.styleId));
}

function extractNumbering(files: Map<string, Buffer>): ExtractedNumbering[] {
  const part = files.get('word/numbering.xml');
  if (!part) return [];
  const root = parseXml(part.toString('utf8'));

  const numIdByAbstract = new Map<string, string>();
  for (const num of findAll(root, 'num')) {
    const numId = attr(num, 'numId');
    const ref = num.children.find((child) => child.local === 'abstractNumId');
    const abstractId = ref ? attr(ref, 'val') : undefined;
    if (numId && abstractId && !numIdByAbstract.has(abstractId)) numIdByAbstract.set(abstractId, numId);
  }

  return findAll(root, 'abstractNum')
    .map((abstractNum): ExtractedNumbering | null => {
      const abstractNumId = attr(abstractNum, 'abstractNumId');
      if (!abstractNumId) return null;

      const levels = abstractNum.children
        .filter((child) => child.local === 'lvl')
        .map((lvl) => {
          const numFmtEl = lvl.children.find((child) => child.local === 'numFmt');
          const lvlTextEl = lvl.children.find((child) => child.local === 'lvlText');
          const indEl = lvl.children
            .find((child) => child.local === 'pPr')
            ?.children.find((child) => child.local === 'ind');
          const level: ExtractedNumbering['levels'][number] = { ilvl: Number(attr(lvl, 'ilvl') ?? 0) };
          const numFmt = numFmtEl ? attr(numFmtEl, 'val') : undefined;
          if (numFmt) level.numFmt = numFmt;
          const lvlText = lvlTextEl ? attr(lvlTextEl, 'val') : undefined;
          if (lvlText !== undefined) level.lvlText = lvlText;
          const indentLeft = indEl ? attr(indEl, 'left') : undefined;
          if (indentLeft !== undefined && Number.isFinite(Number(indentLeft))) level.indentLeft = Number(indentLeft);
          return level;
        });

      const entry: ExtractedNumbering = { abstractNumId, levels };
      const numId = numIdByAbstract.get(abstractNumId);
      if (numId) entry.numId = numId;
      return entry;
    })
    .filter((entry): entry is ExtractedNumbering => entry !== null);
}

function extractDocument(
  files: Map<string, Buffer>,
  styleOutlineLevels: Map<string, number>,
  styleNames: Map<string, string>,
): { headingOutline: ExtractedHeading[]; tables: ExtractedTable[] } {
  const part = files.get('word/document.xml');
  if (!part) return { headingOutline: [], tables: [] };
  const root = parseXml(part.toString('utf8'));

  const headingOutline: ExtractedHeading[] = [];
  for (const p of findAll(root, 'p')) {
    const styleEl = p.children.find((child) => child.local === 'pPr')?.children.find((child) => child.local === 'pStyle');
    const styleId = styleEl ? attr(styleEl, 'val') : undefined;
    if (!styleId) continue;
    const outlineLevel = styleOutlineLevels.get(styleId);
    if (outlineLevel === undefined) continue;
    const text = paragraphText(p).trim();
    if (text.length === 0) continue;
    const heading: ExtractedHeading = { level: outlineLevel + 1, text };
    const styleName = styleNames.get(styleId);
    if (styleName) heading.styleName = styleName;
    headingOutline.push(heading);
  }

  const tables: ExtractedTable[] = findAll(root, 'tbl').map((tbl, index) => {
    const rows = tbl.children.filter((child) => child.local === 'tr');
    const columns = Math.max(0, ...rows.map((row) => row.children.filter((cell) => cell.local === 'tc').length));
    const firstRow = rows[0];
    const hasHeaderRow =
      firstRow !== undefined &&
      firstRow.children.some(
        (child) => child.local === 'trPr' && child.children.some((prop) => prop.local === 'tblHeader'),
      );
    const table: ExtractedTable = { index, rows: rows.length, columns, hasHeaderRow };
    if (firstRow) {
      table.firstRowCells = firstRow.children
        .filter((cell) => cell.local === 'tc')
        .map((cell) => textOf(cell).trim());
    }
    return table;
  });

  return { headingOutline, tables };
}

function paragraphText(p: XmlElement): string {
  return findAll(p, 't')
    .map((t) => t.text)
    .join('');
}

function extractHeadersFooters(files: Map<string, Buffer>): ExtractedHeaderFooter[] {
  const out: ExtractedHeaderFooter[] = [];
  for (const name of [...files.keys()].sort()) {
    if (!/^word\/(header|footer)\d*\.xml$/.test(name)) continue;
    const root = parseXml(files.get(name)!.toString('utf8'));
    const text = findAll(root, 't')
      .map((t) => t.text)
      .join('')
      .trim();
    out.push({ part: name, text });
  }
  return out;
}
