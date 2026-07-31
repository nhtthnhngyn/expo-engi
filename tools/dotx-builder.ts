/**
 * Deterministic `.dotx` builder.
 *
 * In production a template arrives as a real Word file from a journal or an institution. This repo
 * has to carry its templates in git, so they are built from a declarative definition instead of
 * being committed as opaque binaries — reviewable in a diff, and reproducible byte-for-byte.
 *
 * The build direction matters: templates are built from `tools/template-definitions.ts`, **not**
 * from the format configs. A config referencing a style its template does not define still fails
 * the style-map lint, exactly as it would with a third-party template.
 */

import { zipWrite, type ZipEntry } from '../core/ooxml/zip.js';
import { escapeXml } from '../core/ooxml/xml.js';

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
const W_NS =
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

export interface StyleDefinition {
  /** Word display name — what a config's `styleMap` references. */
  name: string;
  /** Internal id. Derived from the name when omitted. */
  styleId?: string;
  type?: 'paragraph' | 'character' | 'table' | 'numbering';
  basedOn?: string;
  /** Half-points, i.e. 24 = 12pt. */
  sizeHalfPoints?: number;
  bold?: boolean;
  italic?: boolean;
  allCaps?: boolean;
  font?: string;
  color?: string;
  alignment?: 'left' | 'center' | 'right' | 'both';
  /** 0-based outline level; set on heading styles so Word's TOC and navigation work. */
  outlineLevel?: number;
  spacingBefore?: number;
  spacingAfter?: number;
  lineSpacing?: number;
  indentLeft?: number;
  indentHanging?: number;
  keepNext?: boolean;
  borders?: boolean;
  shading?: string;
}

export interface TemplateDefinition {
  /** Default body font for the whole template. */
  bodyFont: string;
  /** Default body size in half-points. */
  bodySizeHalfPoints: number;
  styles: StyleDefinition[];
}

export function styleIdFor(definition: StyleDefinition): string {
  return definition.styleId ?? definition.name.replace(/[^A-Za-z0-9]/g, '');
}

function styleXml(definition: StyleDefinition, defaults: TemplateDefinition): string {
  const type = definition.type ?? 'paragraph';
  const id = styleIdFor(definition);

  const pPrParts: string[] = [];
  if (definition.keepNext) pPrParts.push('<w:keepNext/>');
  if (definition.borders) {
    pPrParts.push(
      '<w:pBdr><w:top w:val="single" w:sz="4" w:space="1" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="4" w:color="auto"/>' +
        '<w:bottom w:val="single" w:sz="4" w:space="1" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="4" w:color="auto"/></w:pBdr>',
    );
  }
  if (definition.shading) pPrParts.push(`<w:shd w:val="clear" w:color="auto" w:fill="${definition.shading}"/>`);
  if (definition.indentLeft !== undefined || definition.indentHanging !== undefined) {
    const left = definition.indentLeft !== undefined ? ` w:left="${definition.indentLeft}"` : '';
    const hanging = definition.indentHanging !== undefined ? ` w:hanging="${definition.indentHanging}"` : '';
    pPrParts.push(`<w:ind${left}${hanging}/>`);
  }
  if (
    definition.spacingBefore !== undefined ||
    definition.spacingAfter !== undefined ||
    definition.lineSpacing !== undefined
  ) {
    const before = definition.spacingBefore !== undefined ? ` w:before="${definition.spacingBefore}"` : '';
    const after = definition.spacingAfter !== undefined ? ` w:after="${definition.spacingAfter}"` : '';
    const line = definition.lineSpacing !== undefined ? ` w:line="${definition.lineSpacing}" w:lineRule="auto"` : '';
    pPrParts.push(`<w:spacing${before}${after}${line}/>`);
  }
  if (definition.alignment) pPrParts.push(`<w:jc w:val="${definition.alignment}"/>`);
  if (definition.outlineLevel !== undefined) pPrParts.push(`<w:outlineLvl w:val="${definition.outlineLevel}"/>`);

  const rPrParts: string[] = [];
  const font = definition.font ?? defaults.bodyFont;
  rPrParts.push(`<w:rFonts w:ascii="${escapeXml(font)}" w:hAnsi="${escapeXml(font)}" w:cs="${escapeXml(font)}"/>`);
  if (definition.bold) rPrParts.push('<w:b/>');
  if (definition.italic) rPrParts.push('<w:i/>');
  if (definition.allCaps) rPrParts.push('<w:caps/>');
  if (definition.color) rPrParts.push(`<w:color w:val="${definition.color}"/>`);
  const size = definition.sizeHalfPoints ?? defaults.bodySizeHalfPoints;
  rPrParts.push(`<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`);

  const tblPr =
    type === 'table'
      ? '<w:tblPr><w:tblBorders>' +
        '<w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
        '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
        '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
        '</w:tblBorders><w:tblCellMar><w:top w:w="43" w:type="dxa"/><w:left w:w="86" w:type="dxa"/>' +
        '<w:bottom w:w="43" w:type="dxa"/><w:right w:w="86" w:type="dxa"/></w:tblCellMar></w:tblPr>'
      : '';

  const basedOn = definition.basedOn ? `<w:basedOn w:val="${escapeXml(definition.basedOn)}"/>` : '';
  const pPr = pPrParts.length > 0 && type !== 'character' ? `<w:pPr>${pPrParts.join('')}</w:pPr>` : '';
  const rPr = `<w:rPr>${rPrParts.join('')}</w:rPr>`;

  return (
    `<w:style w:type="${type}" w:styleId="${escapeXml(id)}">` +
    `<w:name w:val="${escapeXml(definition.name)}"/>` +
    basedOn +
    '<w:qFormat/>' +
    tblPr +
    pPr +
    rPr +
    '</w:style>'
  );
}

export function stylesXml(definition: TemplateDefinition): string {
  const docDefaults =
    '<w:docDefaults><w:rPrDefault><w:rPr>' +
    `<w:rFonts w:ascii="${escapeXml(definition.bodyFont)}" w:hAnsi="${escapeXml(definition.bodyFont)}" w:cs="${escapeXml(definition.bodyFont)}"/>` +
    `<w:sz w:val="${definition.bodySizeHalfPoints}"/><w:szCs w:val="${definition.bodySizeHalfPoints}"/>` +
    '</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>';

  const normal =
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>';

  const styles = definition.styles.map((style) => styleXml(style, definition)).join('');

  return `${XML_DECL}<w:styles ${W_NS}>${docDefaults}${normal}${styles}</w:styles>`;
}

/**
 * A bullet list (abstractNum 0 / numId 1) and a decimal list (abstractNum 1 / numId 2). The
 * renderer discovers which is which by reading this file back — it never assumes the ids.
 */
export function numberingXml(): string {
  const levels = (bullet: boolean): string =>
    Array.from({ length: 9 }, (_unused, level) => {
      const indent = 720 * (level + 1);
      const format = bullet ? 'bullet' : level % 3 === 0 ? 'decimal' : level % 3 === 1 ? 'lowerLetter' : 'lowerRoman';
      const text = bullet ? (level % 3 === 0 ? '' : level % 3 === 1 ? 'o' : '') : `%${level + 1}.`;
      const font = bullet ? '<w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr>' : '';
      return (
        `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="${format}"/>` +
        `<w:lvlText w:val="${escapeXml(text)}"/><w:lvlJc w:val="left"/>` +
        `<w:pPr><w:ind w:left="${indent}" w:hanging="360"/></w:pPr>${font}</w:lvl>`
      );
    }).join('');

  return (
    `${XML_DECL}<w:numbering ${W_NS}>` +
    `<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${levels(true)}</w:abstractNum>` +
    `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${levels(false)}</w:abstractNum>` +
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
    '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>' +
    '</w:numbering>'
  );
}

function fontTableXml(definition: TemplateDefinition): string {
  const fonts = [...new Set([definition.bodyFont, ...definition.styles.map((s) => s.font ?? definition.bodyFont), 'Symbol'])].sort();
  const entries = fonts
    .map(
      (font) =>
        `<w:font w:name="${escapeXml(font)}"><w:family w:val="auto"/><w:pitch w:val="variable"/></w:font>`,
    )
    .join('');
  return `${XML_DECL}<w:fonts ${W_NS}>${entries}</w:fonts>`;
}

function contentTypesXml(): string {
  return (
    `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
    '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
    '<Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>' +
    '</Types>'
  );
}

/** Builds the complete `.dotx` bytes. */
export function buildDotx(definition: TemplateDefinition): Buffer {
  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypesXml(), 'utf8') },
    {
      name: '_rels/.rels',
      data: Buffer.from(
        `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
          '</Relationships>',
        'utf8',
      ),
    },
    {
      name: 'word/document.xml',
      data: Buffer.from(
        `${XML_DECL}<w:document ${W_NS}><w:body><w:sectPr><w:pgSz w:w="12240" w:h="15840"/>` +
          '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>' +
          '</w:sectPr></w:body></w:document>',
        'utf8',
      ),
    },
    {
      name: 'word/_rels/document.xml.rels',
      data: Buffer.from(
        `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
          '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
          '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/>' +
          '</Relationships>',
        'utf8',
      ),
    },
    { name: 'word/styles.xml', data: Buffer.from(stylesXml(definition), 'utf8') },
    { name: 'word/numbering.xml', data: Buffer.from(numberingXml(), 'utf8') },
    {
      name: 'word/settings.xml',
      data: Buffer.from(`${XML_DECL}<w:settings ${W_NS}><w:defaultTabStop w:val="720"/></w:settings>`, 'utf8'),
    },
    { name: 'word/fontTable.xml', data: Buffer.from(fontTableXml(definition), 'utf8') },
  ];

  return zipWrite(entries);
}
