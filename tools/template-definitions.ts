/**
 * The declarative source for every format's `.dotx`.
 *
 * These stand in for the real Word templates a journal or institution would supply. They are
 * deliberately *different from each other* — different style names, different typography, different
 * available styles — because that is what proves the renderer is generic. The same renderer binary
 * has to produce a two-column IEEE paper and a CRF grid with no code differences between them.
 */

import type { StyleDefinition, TemplateDefinition } from './dotx-builder.js';

interface StyleNames {
  title: string;
  subtitle: string;
  heading: (level: number) => string;
  body: string;
  bullet: string;
  ordered: string;
  table: string;
  tableHeader: string;
  figure: string;
  caption: string;
  checklist?: string;
  quote: string;
  code: string;
  toc: string;
  footnote: string;
  /** Extra styles this template offers beyond the standard set. */
  extra?: StyleDefinition[];
}

interface Typography {
  bodyFont: string;
  headingFont?: string;
  bodySizeHalfPoints: number;
  titleSizeHalfPoints: number;
  headingSizes: [number, number, number, number, number, number];
  headingCaps?: boolean;
  bodyLineSpacing?: number;
  justified?: boolean;
}

function buildTemplate(names: StyleNames, type: Typography): TemplateDefinition {
  const headingFont = type.headingFont ?? type.bodyFont;
  const styles: StyleDefinition[] = [
    {
      name: names.title,
      font: headingFont,
      sizeHalfPoints: type.titleSizeHalfPoints,
      bold: true,
      alignment: 'center',
      spacingBefore: 0,
      spacingAfter: 240,
      keepNext: true,
    },
    {
      name: names.subtitle,
      font: headingFont,
      sizeHalfPoints: type.bodySizeHalfPoints + 2,
      italic: true,
      alignment: 'center',
      spacingAfter: 120,
    },
    ...type.headingSizes.map((size, index): StyleDefinition => ({
      name: names.heading(index + 1),
      font: headingFont,
      sizeHalfPoints: size,
      bold: true,
      allCaps: type.headingCaps === true && index === 0,
      outlineLevel: index,
      keepNext: true,
      spacingBefore: 240 - index * 20,
      spacingAfter: 120,
    })),
    {
      name: names.body,
      font: type.bodyFont,
      sizeHalfPoints: type.bodySizeHalfPoints,
      alignment: type.justified ? 'both' : 'left',
      lineSpacing: type.bodyLineSpacing ?? 276,
      spacingAfter: 120,
    },
    {
      name: names.bullet,
      font: type.bodyFont,
      sizeHalfPoints: type.bodySizeHalfPoints,
      spacingAfter: 60,
    },
    {
      name: names.ordered,
      font: type.bodyFont,
      sizeHalfPoints: type.bodySizeHalfPoints,
      spacingAfter: 60,
    },
    {
      name: names.table,
      type: 'table',
      font: type.bodyFont,
      sizeHalfPoints: type.bodySizeHalfPoints - 2,
    },
    {
      name: names.tableHeader,
      font: type.bodyFont,
      sizeHalfPoints: type.bodySizeHalfPoints - 2,
      bold: true,
      shading: 'EEEEEE',
      spacingAfter: 0,
    },
    {
      name: names.figure,
      font: type.bodyFont,
      sizeHalfPoints: type.bodySizeHalfPoints,
      alignment: 'center',
      spacingBefore: 120,
      spacingAfter: 60,
    },
    {
      name: names.caption,
      font: type.bodyFont,
      sizeHalfPoints: type.bodySizeHalfPoints - 2,
      italic: true,
      alignment: 'center',
      spacingAfter: 180,
    },
    {
      name: names.quote,
      font: type.bodyFont,
      sizeHalfPoints: type.bodySizeHalfPoints,
      italic: true,
      indentLeft: 720,
      spacingAfter: 120,
    },
    {
      name: names.code,
      font: 'Consolas',
      sizeHalfPoints: type.bodySizeHalfPoints - 2,
      shading: 'F4F4F4',
      spacingAfter: 120,
    },
    {
      name: names.toc,
      font: type.bodyFont,
      sizeHalfPoints: type.bodySizeHalfPoints,
      spacingAfter: 40,
    },
    {
      name: names.footnote,
      font: type.bodyFont,
      sizeHalfPoints: type.bodySizeHalfPoints - 4,
      spacingAfter: 0,
    },
  ];

  if (names.checklist) {
    styles.push({
      name: names.checklist,
      font: type.bodyFont,
      sizeHalfPoints: type.bodySizeHalfPoints,
      indentLeft: 720,
      indentHanging: 720,
      spacingAfter: 60,
    });
  }

  if (names.extra) styles.push(...names.extra);

  return { bodyFont: type.bodyFont, bodySizeHalfPoints: type.bodySizeHalfPoints, styles };
}

// ---------------------------------------------------------------------------
// One entry per published format.
// ---------------------------------------------------------------------------

export const TEMPLATE_DEFINITIONS: Record<string, TemplateDefinition> = {
  'protocol-design.default': buildTemplate(
    {
      title: 'Protocol Title',
      subtitle: 'Protocol Subtitle',
      heading: (n) => `Protocol Heading ${n}`,
      body: 'Protocol Body',
      bullet: 'Protocol Bullet',
      ordered: 'Protocol Numbered',
      table: 'Protocol Table',
      tableHeader: 'Protocol Table Header',
      figure: 'Protocol Figure',
      caption: 'Protocol Caption',
      quote: 'Protocol Quote',
      code: 'Protocol Code',
      toc: 'Protocol Contents Entry',
      footnote: 'Protocol Footnote',
      extra: [
        { name: 'Protocol Version Note', italic: true, sizeHalfPoints: 18, alignment: 'right' },
      ],
    },
    {
      bodyFont: 'Calibri',
      bodySizeHalfPoints: 22,
      titleSizeHalfPoints: 36,
      headingSizes: [30, 26, 24, 22, 22, 22],
    },
  ),

  'data-collection.crf-redcap': buildTemplate(
    {
      title: 'CRF Title',
      subtitle: 'CRF Subtitle',
      heading: (n) => `CRF Section ${n}`,
      body: 'CRF Body',
      bullet: 'CRF Bullet',
      ordered: 'CRF Numbered',
      table: 'CRF Grid',
      tableHeader: 'CRF Grid Header',
      figure: 'CRF Figure',
      caption: 'CRF Caption',
      quote: 'CRF Note',
      code: 'CRF Code',
      toc: 'CRF Contents Entry',
      footnote: 'CRF Footnote',
      extra: [
        { name: 'CRF Field Label', bold: true, sizeHalfPoints: 20, spacingAfter: 0 },
        { name: 'CRF Instruction', italic: true, sizeHalfPoints: 18, color: '555555' },
      ],
    },
    {
      bodyFont: 'Arial',
      bodySizeHalfPoints: 20,
      titleSizeHalfPoints: 28,
      headingSizes: [24, 22, 20, 20, 20, 20],
    },
  ),

  'data-processing.log-default': buildTemplate(
    {
      title: 'Log Title',
      subtitle: 'Log Subtitle',
      heading: (n) => `Log Heading ${n}`,
      body: 'Log Body',
      bullet: 'Log Bullet',
      ordered: 'Log Numbered',
      table: 'Log Table',
      tableHeader: 'Log Table Header',
      figure: 'Log Figure',
      caption: 'Log Caption',
      quote: 'Log Note',
      code: 'Log Code',
      toc: 'Log Contents Entry',
      footnote: 'Log Footnote',
      extra: [{ name: 'Log Timestamp', font: 'Consolas', sizeHalfPoints: 18, color: '444444' }],
    },
    {
      bodyFont: 'Calibri',
      bodySizeHalfPoints: 20,
      titleSizeHalfPoints: 28,
      headingSizes: [26, 24, 22, 20, 20, 20],
    },
  ),

  'stat-analysis.default': buildTemplate(
    {
      title: 'Stats Report Title',
      subtitle: 'Stats Report Subtitle',
      heading: (n) => `Stats Heading ${n}`,
      body: 'Stats Body',
      bullet: 'Stats Bullet',
      ordered: 'Stats Numbered',
      table: 'Stats Result Table',
      tableHeader: 'Stats Result Header',
      figure: 'Stats Figure',
      caption: 'Stats Table Caption',
      quote: 'Stats Note',
      code: 'Stats Syntax',
      toc: 'Stats Contents Entry',
      footnote: 'Stats Footnote',
      extra: [{ name: 'Stats Footnote Symbol', type: 'character', sizeHalfPoints: 16 }],
    },
    {
      bodyFont: 'Calibri',
      bodySizeHalfPoints: 22,
      titleSizeHalfPoints: 32,
      headingSizes: [28, 26, 24, 22, 22, 22],
    },
  ),

  // Style names here match the worked example in AGENT_BUILD_SPEC.md section 4.3.
  'report-writing.consort': buildTemplate(
    {
      title: 'Title',
      subtitle: 'Subtitle',
      heading: (n) => `Heading ${n}`,
      body: 'Body Text',
      bullet: 'List Bullet',
      ordered: 'List Number',
      table: 'Table Grid Research',
      tableHeader: 'Table Heading',
      figure: 'Figure Caption',
      caption: 'Caption',
      checklist: 'CONSORT Checklist Row',
      quote: 'Quote',
      code: 'Code Block',
      toc: 'TOC Entry',
      footnote: 'Footnote Text',
    },
    {
      bodyFont: 'Times New Roman',
      bodySizeHalfPoints: 24,
      titleSizeHalfPoints: 32,
      headingSizes: [28, 26, 24, 24, 24, 24],
      bodyLineSpacing: 480,
    },
  ),

  'report-writing.strobe': buildTemplate(
    {
      title: 'STROBE Title',
      subtitle: 'STROBE Subtitle',
      heading: (n) => `STROBE Heading ${n}`,
      body: 'STROBE Body',
      bullet: 'STROBE Bullet',
      ordered: 'STROBE Numbered',
      table: 'STROBE Table',
      tableHeader: 'STROBE Table Header',
      figure: 'STROBE Figure',
      caption: 'STROBE Caption',
      checklist: 'STROBE Checklist Item',
      quote: 'STROBE Quote',
      code: 'STROBE Code',
      toc: 'STROBE Contents Entry',
      footnote: 'STROBE Footnote',
    },
    {
      bodyFont: 'Times New Roman',
      bodySizeHalfPoints: 24,
      titleSizeHalfPoints: 32,
      headingSizes: [28, 26, 24, 24, 24, 24],
      bodyLineSpacing: 480,
    },
  ),

  'report-writing.prisma': buildTemplate(
    {
      title: 'PRISMA Title',
      subtitle: 'PRISMA Subtitle',
      heading: (n) => `PRISMA Heading ${n}`,
      body: 'PRISMA Body',
      bullet: 'PRISMA Bullet',
      ordered: 'PRISMA Numbered',
      table: 'PRISMA Table',
      tableHeader: 'PRISMA Table Header',
      figure: 'PRISMA Figure',
      caption: 'PRISMA Caption',
      checklist: 'PRISMA Checklist Item',
      quote: 'PRISMA Quote',
      code: 'PRISMA Code',
      toc: 'PRISMA Contents Entry',
      footnote: 'PRISMA Footnote',
    },
    {
      bodyFont: 'Times New Roman',
      bodySizeHalfPoints: 24,
      titleSizeHalfPoints: 32,
      headingSizes: [28, 26, 24, 24, 24, 24],
      bodyLineSpacing: 480,
    },
  ),

  'journal-submission.ieee': buildTemplate(
    {
      title: 'IEEE Paper Title',
      subtitle: 'IEEE Author Block',
      heading: (n) => `IEEE Heading ${n}`,
      body: 'IEEE Body',
      bullet: 'IEEE Bullet',
      ordered: 'IEEE Numbered',
      table: 'IEEE Table',
      tableHeader: 'IEEE Table Head',
      figure: 'IEEE Figure',
      caption: 'IEEE Caption',
      quote: 'IEEE Quote',
      code: 'IEEE Code',
      toc: 'IEEE Contents Entry',
      footnote: 'IEEE Footnote',
      extra: [{ name: 'IEEE Abstract', bold: true, italic: true, sizeHalfPoints: 18 }],
    },
    {
      bodyFont: 'Times New Roman',
      bodySizeHalfPoints: 20,
      titleSizeHalfPoints: 48,
      headingSizes: [20, 20, 20, 20, 20, 20],
      headingCaps: true,
      justified: true,
      bodyLineSpacing: 240,
    },
  ),

  'journal-submission.elsevier': buildTemplate(
    {
      title: 'Elsevier Title',
      subtitle: 'Elsevier Authors',
      heading: (n) => `Elsevier Heading ${n}`,
      body: 'Elsevier Body',
      bullet: 'Elsevier Bullet',
      ordered: 'Elsevier Numbered',
      table: 'Elsevier Table',
      tableHeader: 'Elsevier Table Header',
      figure: 'Elsevier Figure',
      caption: 'Elsevier Caption',
      quote: 'Elsevier Quote',
      code: 'Elsevier Code',
      toc: 'Elsevier Contents Entry',
      footnote: 'Elsevier Footnote',
      extra: [{ name: 'Elsevier Highlights', bold: true, sizeHalfPoints: 20, indentLeft: 360 }],
    },
    {
      bodyFont: 'Times New Roman',
      bodySizeHalfPoints: 24,
      titleSizeHalfPoints: 36,
      headingSizes: [28, 26, 24, 24, 24, 24],
      bodyLineSpacing: 480,
    },
  ),

  'journal-submission.plos-one': buildTemplate(
    {
      title: 'PLOS Title',
      subtitle: 'PLOS Authors',
      heading: (n) => `PLOS Heading ${n}`,
      body: 'PLOS Body',
      bullet: 'PLOS Bullet',
      ordered: 'PLOS Numbered',
      table: 'PLOS Table',
      tableHeader: 'PLOS Table Header',
      figure: 'PLOS Figure',
      caption: 'PLOS Caption',
      quote: 'PLOS Quote',
      code: 'PLOS Code',
      toc: 'PLOS Contents Entry',
      footnote: 'PLOS Footnote',
    },
    {
      bodyFont: 'Arial',
      bodySizeHalfPoints: 24,
      titleSizeHalfPoints: 32,
      headingSizes: [28, 26, 24, 24, 24, 24],
      bodyLineSpacing: 480,
    },
  ),
};

// ---------------------------------------------------------------------------
// Formats whose config.json was supplied ready-made (FORMAT_CONFIG_GUIDE.md's own worked
// examples). Their style names are exact and literal — built directly as StyleDefinition arrays
// rather than through buildTemplate(), which normalises spacing/casing buildTemplate's own way.
// ---------------------------------------------------------------------------

/** general.plain-document: headings.*.wordStyle + styleMap use these names verbatim. */
TEMPLATE_DEFINITIONS['general.plain-document'] = {
  bodyFont: 'Times New Roman',
  bodySizeHalfPoints: 24,
  styles: [
    { name: 'Heading1', styleId: 'Heading1', outlineLevel: 0, sizeHalfPoints: 32, bold: true, keepNext: true },
    { name: 'Heading2', styleId: 'Heading2', outlineLevel: 1, sizeHalfPoints: 28, bold: true, keepNext: true },
    { name: 'Heading3', styleId: 'Heading3', outlineLevel: 2, sizeHalfPoints: 26, bold: true, keepNext: true },
    { name: 'Heading4', styleId: 'Heading4', outlineLevel: 3, sizeHalfPoints: 24, bold: true, keepNext: true },
    { name: 'Heading5', styleId: 'Heading5', outlineLevel: 4, sizeHalfPoints: 24, bold: true, keepNext: true },
    { name: 'Heading6', styleId: 'Heading6', outlineLevel: 5, sizeHalfPoints: 24, bold: true, keepNext: true },
    { name: 'Caption', styleId: 'Caption', italic: true, sizeHalfPoints: 20, alignment: 'center' },
    { name: 'TableGrid', styleId: 'TableGrid', type: 'table' },
    { name: 'TOCHeading', styleId: 'TOCHeading', outlineLevel: 0, sizeHalfPoints: 32, bold: true },
    { name: 'TOC1', styleId: 'TOC1', sizeHalfPoints: 24 },
    { name: 'TOC2', styleId: 'TOC2', sizeHalfPoints: 24, indentLeft: 240 },
    { name: 'TOC3', styleId: 'TOC3', sizeHalfPoints: 24, indentLeft: 480 },
  ],
};

/** protocol-design.vn-academic-thesis-protocol: headings.*.wordStyle + styleMap use these names verbatim. */
TEMPLATE_DEFINITIONS['protocol-design.vn-academic-thesis-protocol'] = {
  bodyFont: 'Times New Roman',
  bodySizeHalfPoints: 26,
  styles: [
    { name: 'Heading1', styleId: 'Heading1', outlineLevel: 0, sizeHalfPoints: 26, bold: true, alignment: 'center', keepNext: true },
    { name: 'Heading2', styleId: 'Heading2', outlineLevel: 1, sizeHalfPoints: 26, bold: true, keepNext: true },
    { name: 'Heading3', styleId: 'Heading3', outlineLevel: 2, sizeHalfPoints: 26, bold: true, alignment: 'both', keepNext: true },
    { name: 'Caption', styleId: 'Caption', bold: true, sizeHalfPoints: 26, alignment: 'center' },
    { name: 'Bibliography', styleId: 'Bibliography', sizeHalfPoints: 26, indentLeft: 360, indentHanging: 360 },
    { name: 'TableGrid', styleId: 'TableGrid', type: 'table' },
    { name: 'TOCHeading', styleId: 'TOCHeading', outlineLevel: 0, sizeHalfPoints: 30, bold: true, alignment: 'center' },
    { name: 'TOC1', styleId: 'TOC1', sizeHalfPoints: 26 },
    { name: 'TOC2', styleId: 'TOC2', sizeHalfPoints: 26, indentLeft: 240 },
    { name: 'TOC3', styleId: 'TOC3', sizeHalfPoints: 26, indentLeft: 480 },
    { name: 'TableofFigures', styleId: 'TableofFigures', sizeHalfPoints: 26 },
  ],
};

/**
 * report-writing.vn-academic-thesis-full shares its underlying convention byte-for-byte with
 * protocol-design.vn-academic-thesis-protocol (same page setup, same named styles, same heading
 * direct formatting — see GENERAL_VS_PRIVATE_NOTES.md); only which chapters exist differs, and
 * that lives in the document skeleton, not the template. Same style definition, deliberately.
 */
TEMPLATE_DEFINITIONS['report-writing.vn-academic-thesis-full'] = TEMPLATE_DEFINITIONS['protocol-design.vn-academic-thesis-protocol']!;

/**
 * journal-submission.vn-academic-imrad-manuscript: every style reference in the config is
 * "Normal" — the format uses direct formatting exclusively, on top of the single base style.
 */
TEMPLATE_DEFINITIONS['journal-submission.vn-academic-imrad-manuscript'] = {
  bodyFont: 'Times New Roman',
  bodySizeHalfPoints: 24,
  styles: [],
};
