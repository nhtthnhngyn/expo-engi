/**
 * Word renderer: Canonical IR + format config -> `.docx` bytes.
 *
 * Stage 3 of 3, and the last place a format-specific conditional could hide. It does not contain
 * one. The renderer's inputs are the IR (pure content) and the resolved format (config + template);
 * every style name, section order, numbering scheme and document toggle is read from the config at
 * render time.
 *
 * Determinism (spec section 3) is a hard requirement here, so: relationship ids, media names,
 * footnote ids and bookmark ids are all allocated in document order from per-render state; the ZIP
 * is written with fixed timestamps and a pinned compression level; and nothing consults the clock.
 * The only time value in the output is `meta.generatedAt`, which is part of the input.
 */

import type { CanonicalIR, IRBlock } from '../core/types.js';
import { ExportEngineError } from '../core/errors.js';
import { zipRead, zipWrite, type ZipEntry } from '../core/ooxml/zip.js';
import type { ResolvedFormatWithStyles } from '../format-registry/resolver.js';
import { blocksXml, collectHeadings, type BodyContext } from './document-xml.js';
import { parseListNumbering } from './numbering.js';
import {
  DEFAULT_PAGE,
  DOC_NAMESPACES,
  XML_DECL,
  contentTypesXml,
  corePropsXml,
  coverPageXml,
  documentRelsXml,
  footerXml,
  footnotesXml,
  headerXml,
  packageRelsXml,
  sectPrXml,
  settingsXml,
  substituteTokens,
  tocXml,
} from './parts.js';
import { RenderState, REL_TYPES } from './render-state.js';
import { orderBlocks } from './sections.js';
import { StyleResolver } from './style-resolver.js';

export interface RenderOptions {
  /** Base directory for resolving relative image paths in figures. Defaults to the format folder. */
  assetBaseDir?: string;
}

export interface RenderResult {
  bytes: Buffer;
  /** Non-fatal problems (e.g. a figure whose image could not be embedded). */
  warnings: string[];
}

/** Template parts carried through to the output verbatim. */
const CARRIED_PARTS = ['word/styles.xml', 'word/numbering.xml', 'word/fontTable.xml', 'word/theme/theme1.xml'];

export function renderToDocx(ir: CanonicalIR, format: ResolvedFormatWithStyles, options: RenderOptions = {}): RenderResult {
  try {
    return renderInner(ir, format, options);
  } catch (err) {
    throw ExportEngineError.wrap(err, 'RENDER_FAILED', `Rendering "${format.config.formatId}" failed`);
  }
}

/** Convenience wrapper for callers that only want the bytes. */
export function render(ir: CanonicalIR, format: ResolvedFormatWithStyles, options: RenderOptions = {}): Buffer {
  return renderToDocx(ir, format, options).bytes;
}

function renderInner(ir: CanonicalIR, format: ResolvedFormatWithStyles, options: RenderOptions): RenderResult {
  const { config, meta } = format;
  const docFeatures = config.docFeatures ?? {};
  const page = config.page ?? DEFAULT_PAGE;
  const template = zipRead(format.templateBytes);

  const state = new RenderState();
  const styles = new StyleResolver(config, format.styleIds);
  const numberingPart = template.files.get('word/numbering.xml');
  const listNumbering = numberingPart ? parseListNumbering(numberingPart.toString('utf8')) : {};

  // Relationship order is fixed so two renders always allocate the same ids.
  const stylesRelId = state.addRelationship(REL_TYPES.styles, 'styles.xml');
  void stylesRelId;
  if (template.files.has('word/numbering.xml')) state.addRelationship(REL_TYPES.numbering, 'numbering.xml');
  state.addRelationship(REL_TYPES.settings, 'settings.xml');
  if (template.files.has('word/fontTable.xml')) state.addRelationship(REL_TYPES.fontTable, 'fontTable.xml');
  if (template.files.has('word/theme/theme1.xml')) state.addRelationship(REL_TYPES.theme, 'theme/theme1.xml');
  const footnotesRelId = state.addRelationship(REL_TYPES.footnotes, 'footnotes.xml');
  void footnotesRelId;

  const headerText = docFeatures.header ? substituteTokens(docFeatures.header, ir) : '';
  const footerText = docFeatures.footer ? substituteTokens(docFeatures.footer, ir) : '';
  const wantsHeader = headerText.length > 0;
  const wantsFooter = footerText.length > 0 || (config.pageNumbering !== undefined && config.pageNumbering !== 'none');

  const headerRelId = wantsHeader ? state.addRelationship(REL_TYPES.header, 'header1.xml') : undefined;
  const footerRelId = wantsFooter ? state.addRelationship(REL_TYPES.footer, 'footer1.xml') : undefined;

  const ctx: BodyContext = {
    config,
    meta,
    styles,
    state,
    listNumbering,
    assetBaseDir: options.assetBaseDir ?? format.dir,
  };

  const ordered: IRBlock[] = orderBlocks(ir.blocks ?? [], meta.sectionOrder ?? []);

  const cover = docFeatures.coverPage === true ? coverPageXml(ir, styles) : '';
  const tocDepth = config.toc?.enabled ? (config.toc.depth ?? 0) : 0;
  const toc = tocDepth > 0 ? tocXml(collectHeadings(ordered, tocDepth), tocDepth, styles) : '';
  const body = blocksXml(ordered, ctx);
  const sectPr = sectPrXml({ page, headerRelId, footerRelId, pageNumbering: config.pageNumbering });

  const documentXml =
    `${XML_DECL}<w:document ${DOC_NAMESPACES}><w:body>${cover}${toc}${body}${sectPr}</w:body></w:document>`;

  // --- assemble the package -------------------------------------------------
  const entries: ZipEntry[] = [];
  const partNames: string[] = [];

  const addPart = (name: string, data: Buffer): void => {
    entries.push({ name, data });
    partNames.push(name);
  };

  const carried: Array<[string, Buffer]> = [];
  for (const name of CARRIED_PARTS) {
    const part = template.files.get(name);
    if (part) carried.push([name, part]);
  }

  const media = [...state.media.entries()].map(([name, bytes]) => [`word/media/${name}`, bytes] as const);

  // Part names are collected first so [Content_Types].xml can be built from the real part list.
  const plannedNames = [
    'word/document.xml',
    ...carried.map(([name]) => name),
    'word/settings.xml',
    'word/footnotes.xml',
    ...(wantsHeader ? ['word/header1.xml'] : []),
    ...(wantsFooter ? ['word/footer1.xml'] : []),
    'docProps/core.xml',
    ...media.map(([name]) => name),
  ];

  addPart('[Content_Types].xml', Buffer.from(contentTypesXml(plannedNames), 'utf8'));
  addPart('_rels/.rels', Buffer.from(packageRelsXml(), 'utf8'));
  addPart('word/document.xml', Buffer.from(documentXml, 'utf8'));
  addPart('word/_rels/document.xml.rels', Buffer.from(documentRelsXml(state.relationships), 'utf8'));
  for (const [name, part] of carried) addPart(name, part);
  addPart(
    'word/settings.xml',
    Buffer.from(settingsXml({ updateFields: tocDepth > 0, hasFootnotes: state.footnotes.length > 0 }), 'utf8'),
  );
  addPart('word/footnotes.xml', Buffer.from(footnotesXml(state, styles), 'utf8'));
  if (wantsHeader) addPart('word/header1.xml', Buffer.from(headerXml(headerText), 'utf8'));
  if (wantsFooter) addPart('word/footer1.xml', Buffer.from(footerXml(footerText, config.pageNumbering), 'utf8'));
  addPart('docProps/core.xml', Buffer.from(corePropsXml(ir), 'utf8'));
  for (const [name, bytes] of media) addPart(name, bytes);

  return { bytes: zipWrite(entries), warnings: [...state.warnings] };
}

export { StyleResolver } from './style-resolver.js';
export { orderBlocks, orderSections, groupBySection } from './sections.js';
export { externalNumberPrefix, parseListNumbering, readListNumbering } from './numbering.js';
export { RenderState } from './render-state.js';
export { CITATION_STYLES } from './runs.js';
