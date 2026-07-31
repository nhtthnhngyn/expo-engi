/**
 * Builders for the non-body parts of the package: cover page, TOC, headers/footers, footnotes,
 * settings, content types and relationships.
 *
 * Every toggle here is read from the format config. Page setup comes from `config.page`; the cover
 * page and header/footer text come from `config.docFeatures` (an engine capability beyond
 * FORMAT_CONFIG_GUIDE.md's own vocabulary — optional and additive, see core/types.ts).
 */

import type { CanonicalIR, FormatConfig, PageConfig } from '../core/types.js';
import { escapeXml } from '../core/ooxml/xml.js';
import type { RenderState, Relationship } from './render-state.js';
import { tocBookmarkName } from './document-xml.js';
import type { StyleResolver } from './style-resolver.js';

export const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

export const DOC_NAMESPACES = [
  'xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"',
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
  'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"',
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
  'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"',
].join(' ');

// ---------------------------------------------------------------------------
// Cover page
// ---------------------------------------------------------------------------

export function coverPageXml(ir: CanonicalIR, styles: StyleResolver): string {
  const title = styles.forPath('styleMap.title');
  const titleStyle = title.styleId ?? styles.forPath('headings.1').styleId ?? styles.forPath('styleMap.heading:1').styleId;
  const subtitleStyle = styles.forPath('styleMap.subtitle').styleId ?? styles.forPath('styleMap.paragraph').styleId;

  const line = (styleId: string | undefined, text: string): string =>
    `<w:p>${styleId ? `<w:pPr><w:pStyle w:val="${escapeXml(styleId)}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;

  return (
    line(titleStyle, ir.meta.documentTitle) +
    line(subtitleStyle, `Project: ${ir.meta.projectId}`) +
    line(subtitleStyle, `Document version: ${ir.meta.sourceDocVersion}`) +
    line(subtitleStyle, `Generated: ${ir.meta.generatedAt}`) +
    '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
  );
}

// ---------------------------------------------------------------------------
// Table of contents
// ---------------------------------------------------------------------------

export interface TocHeading {
  level: number;
  text: string;
  id: string;
}

/**
 * A real TOC field (so Word refreshes page numbers on open) wrapped around static entries (so the
 * document is correct and inspectable before anyone opens Word).
 */
export function tocXml(headings: TocHeading[], depth: number, styles: StyleResolver): string {
  if (depth <= 0) return '';

  const headingStyle = styles.forPath('styleMap.tocHeading').styleId;
  const heading = headingStyle
    ? `<w:p><w:pPr><w:pStyle w:val="${escapeXml(headingStyle)}"/></w:pPr></w:p>`
    : '';
  const instruction = ` TOC \\o "1-${depth}" \\h \\z \\u `;

  const begin =
    '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    `<w:r><w:instrText xml:space="preserve">${escapeXml(instruction)}</w:instrText></w:r>` +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r></w:p>';

  const entries = headings
    .filter((entry) => entry.level <= depth)
    .map((entry) => {
      const entryStyle = styles.forPath(`styleMap.toc:${entry.level}`).styleId;
      const style = entryStyle ? `<w:pPr><w:pStyle w:val="${escapeXml(entryStyle)}"/></w:pPr>` : '';
      const indent = entryStyle ? '' : '    '.repeat(Math.max(0, entry.level - 1));
      return (
        `<w:p>${style}<w:hyperlink w:anchor="${escapeXml(tocBookmarkName(entry.id))}">` +
        `<w:r><w:t xml:space="preserve">${escapeXml(indent + entry.text)}</w:t></w:r>` +
        '</w:hyperlink></w:p>'
      );
    })
    .join('');

  const end = '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';

  return `${heading}${begin}${entries}${end}`;
}

// ---------------------------------------------------------------------------
// Headers / footers
// ---------------------------------------------------------------------------

const HDR_NAMESPACES = DOC_NAMESPACES;

/** Substitutes the tokens a header/footer string may contain. Unknown tokens are left alone. */
export function substituteTokens(template: string, ir: CanonicalIR): string {
  return template
    .replace(/\{documentTitle\}/g, ir.meta.documentTitle)
    .replace(/\{projectId\}/g, ir.meta.projectId)
    .replace(/\{formatId\}/g, ir.meta.formatId)
    .replace(/\{sourceDocVersion\}/g, ir.meta.sourceDocVersion);
}

export function headerXml(text: string): string {
  return (
    `${XML_DECL}<w:hdr ${HDR_NAMESPACES}>` +
    `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>` +
    '</w:hdr>'
  );
}

export function footerXml(text: string, pageNumbering: FormatConfig['pageNumbering'] | undefined): string {
  const textPart = text
    ? `<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`
    : '';
  const separator = text && pageNumbering && pageNumbering !== 'none'
    ? '<w:r><w:t xml:space="preserve">  </w:t></w:r>'
    : '';
  const pagePart =
    pageNumbering && pageNumbering !== 'none'
      ? '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        `<w:r><w:instrText xml:space="preserve"> PAGE ${pageNumbering === 'roman' ? '\\* roman ' : ''}</w:instrText></w:r>` +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        '<w:r><w:t>1</w:t></w:r>' +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
      : '';

  return (
    `${XML_DECL}<w:ftr ${HDR_NAMESPACES}>` +
    `<w:p>${textPart}${separator}${pagePart}</w:p>` +
    '</w:ftr>'
  );
}

// ---------------------------------------------------------------------------
// Section properties — page size/margins/orientation come from config.page
// ---------------------------------------------------------------------------

export function sectPrXml(options: {
  page: PageConfig;
  headerRelId?: string | undefined;
  footerRelId?: string | undefined;
  pageNumbering: FormatConfig['pageNumbering'] | undefined;
}): string {
  const refs =
    (options.headerRelId ? `<w:headerReference w:type="default" r:id="${escapeXml(options.headerRelId)}"/>` : '') +
    (options.footerRelId ? `<w:footerReference w:type="default" r:id="${escapeXml(options.footerRelId)}"/>` : '');

  const pgNumType =
    options.pageNumbering === 'roman'
      ? '<w:pgNumType w:fmt="lowerRoman" w:start="1"/>'
      : options.pageNumbering === 'arabic'
        ? '<w:pgNumType w:fmt="decimal" w:start="1"/>'
        : '';

  const { page } = options;
  const orient = page.orientation === 'landscape' ? ' w:orient="landscape"' : '';
  const m = page.margins;

  return (
    '<w:sectPr>' +
    refs +
    `<w:pgSz w:w="${page.widthTwips}" w:h="${page.heightTwips}"${orient}/>` +
    `<w:pgMar w:top="${m.topTwips}" w:right="${m.rightTwips}" w:bottom="${m.bottomTwips}" w:left="${m.leftTwips}" w:header="720" w:footer="720" w:gutter="0"/>` +
    pgNumType +
    '<w:cols w:space="720"/>' +
    '<w:docGrid w:linePitch="360"/>' +
    '</w:sectPr>'
  );
}

/** The US Letter default a format's `page` block can always fall back to being explicit about. */
export const DEFAULT_PAGE: PageConfig = {
  size: 'letter',
  widthTwips: 12240,
  heightTwips: 15840,
  orientation: 'portrait',
  margins: { topTwips: 1440, rightTwips: 1440, bottomTwips: 1440, leftTwips: 1440 },
};

// ---------------------------------------------------------------------------
// Footnotes
// ---------------------------------------------------------------------------

export function footnotesXml(state: RenderState, styles: StyleResolver): string {
  const footnoteStyle = styles.forPath('styleMap.footnote').styleId;
  const stylePr = footnoteStyle ? `<w:pPr><w:pStyle w:val="${escapeXml(footnoteStyle)}"/></w:pPr>` : '';

  const separators =
    '<w:footnote w:type="separator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote>' +
    '<w:footnote w:type="continuationSeparator" w:id="1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>';

  const entries = state.footnotes
    .map(
      (footnote) =>
        `<w:footnote w:id="${footnote.id}"><w:p>${stylePr}` +
        '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteRef/></w:r>' +
        `<w:r><w:t xml:space="preserve"> ${escapeXml(footnote.text)}</w:t></w:r>` +
        '</w:p></w:footnote>',
    )
    .join('');

  return `${XML_DECL}<w:footnotes ${DOC_NAMESPACES}>${separators}${entries}</w:footnotes>`;
}

// ---------------------------------------------------------------------------
// Settings / properties / package plumbing
// ---------------------------------------------------------------------------

export function settingsXml(options: { updateFields: boolean; hasFootnotes: boolean }): string {
  const update = options.updateFields ? '<w:updateFields w:val="true"/>' : '';
  const footnotePr = options.hasFootnotes
    ? '<w:footnotePr><w:footnote w:id="0"/><w:footnote w:id="1"/></w:footnotePr>'
    : '';
  return (
    `${XML_DECL}<w:settings ${DOC_NAMESPACES}>` +
    '<w:zoom w:percent="100"/>' +
    footnotePr +
    '<w:defaultTabStop w:val="720"/>' +
    update +
    '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>' +
    '</w:settings>'
  );
}

export function corePropsXml(ir: CanonicalIR): string {
  return (
    `${XML_DECL}<cp:coreProperties ` +
    'xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
    'xmlns:dcterms="http://purl.org/dc/terms/" ' +
    'xmlns:dcmitype="http://purl.org/dc/dcmitype/" ' +
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${escapeXml(ir.meta.documentTitle)}</dc:title>` +
    `<dc:description>${escapeXml(`${ir.meta.formatId} / ${ir.meta.projectId} / ${ir.meta.sourceDocVersion}`)}</dc:description>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${escapeXml(ir.meta.generatedAt)}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${escapeXml(ir.meta.generatedAt)}</dcterms:modified>` +
    '<cp:revision>1</cp:revision>' +
    '</cp:coreProperties>'
  );
}

const CONTENT_TYPE_BY_PART: Record<string, string> = {
  'word/document.xml': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  'word/styles.xml': 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml',
  'word/numbering.xml': 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml',
  'word/settings.xml': 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml',
  'word/fontTable.xml': 'application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml',
  'word/footnotes.xml': 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml',
  'word/theme/theme1.xml': 'application/vnd.openxmlformats-officedocument.theme+xml',
  'docProps/core.xml': 'application/vnd.openxmlformats-package.core-properties+xml',
};

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
};

/** Built from the parts actually present, so the package never advertises a part it lacks. */
export function contentTypesXml(partNames: string[]): string {
  const extensions = new Set<string>(['rels', 'xml']);
  for (const name of partNames) {
    const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
    if (IMAGE_CONTENT_TYPES[ext]) extensions.add(ext);
  }

  const defaults = [...extensions]
    .sort()
    .map((ext) => {
      const type =
        ext === 'rels'
          ? 'application/vnd.openxmlformats-package.relationships+xml'
          : ext === 'xml'
            ? 'application/xml'
            : IMAGE_CONTENT_TYPES[ext]!;
      return `<Default Extension="${ext}" ContentType="${type}"/>`;
    })
    .join('');

  const overrides = partNames
    .filter((name) => CONTENT_TYPE_BY_PART[name])
    .map((name) => `<Override PartName="/${name}" ContentType="${CONTENT_TYPE_BY_PART[name]}"/>`)
    .join('');

  const headerFooterOverrides = partNames
    .filter((name) => /^word\/(header|footer)\d+\.xml$/.test(name))
    .map(
      (name) =>
        `<Override PartName="/${name}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${name.includes('header') ? 'header' : 'footer'}+xml"/>`,
    )
    .join('');

  return (
    `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    defaults +
    overrides +
    headerFooterOverrides +
    '</Types>'
  );
}

export function packageRelsXml(): string {
  return (
    `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '</Relationships>'
  );
}

export function documentRelsXml(relationships: Relationship[]): string {
  const entries = relationships
    .map(
      (rel) =>
        `<Relationship Id="${escapeXml(rel.id)}" Type="${escapeXml(rel.type)}" Target="${escapeXml(rel.target)}"${rel.external ? ' TargetMode="External"' : ''}/>`,
    )
    .join('');
  return (
    `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    entries +
    '</Relationships>'
  );
}
