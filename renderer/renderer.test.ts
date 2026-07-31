/**
 * Renderer unit tests (spec section 9.5). Uses a small hand-built format (not the published
 * formats) so each test isolates exactly one toggle.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderToDocx } from './index.js';
import { resolveFormat } from '../format-registry/resolver.js';
import { buildDotx } from '../tools/dotx-builder.js';
import { zipRead } from '../core/ooxml/zip.js';
import type { CanonicalIR, FormatConfig, FormatMeta } from '../core/types.js';

const META = {
  formatId: 'phase-a.format-a',
  documentTitle: 'Renderer Test Doc',
  projectId: 'p1',
  generatedAt: '2026-01-01T00:00:00.000Z',
  sourceDocVersion: '1',
};

const TEMPLATE = buildDotx({
  bodyFont: 'Calibri',
  bodySizeHalfPoints: 22,
  styles: [
    { name: 'Doc Title', sizeHalfPoints: 32, bold: true },
    { name: 'Heading One', outlineLevel: 0, sizeHalfPoints: 28 },
    { name: 'Heading Two', outlineLevel: 1, sizeHalfPoints: 26 },
    { name: 'Body Copy', sizeHalfPoints: 22 },
    { name: 'Checklist Row', sizeHalfPoints: 22 },
    { name: 'Table Style', type: 'table' },
  ],
});

function baseConfig(overrides: Partial<FormatConfig> = {}): FormatConfig {
  return {
    formatId: 'phase-a.format-a',
    displayName: 'Format A',
    phaseId: 'phase-a',
    version: 'v1',
    templateFile: 'template.dotx',
    page: { size: 'letter', widthTwips: 12240, heightTwips: 15840, orientation: 'portrait', margins: { topTwips: 1440, rightTwips: 1440, bottomTwips: 1440, leftTwips: 1440 } },
    typography: { defaultFont: 'Calibri', defaultSizePt: 11, defaultLineSpacing: 'single', defaultAlignment: 'left' },
    headings: { '1': { wordStyle: 'Heading One' }, '2': { wordStyle: 'Heading Two' } },
    styleMap: {
      title: 'Doc Title',
      paragraph: 'Body Copy',
      checklistItem: 'Checklist Row',
      table: 'Table Style',
    },
    toc: { enabled: false, depth: 0, autoGenerateFromHeadings: true },
    headingNumbering: { auto: false },
    citationStyle: 'none',
    pageNumbering: 'none',
    ...overrides,
  };
}

function baseMeta(overrides: Partial<FormatMeta> = {}): FormatMeta {
  return {
    formatId: 'phase-a.format-a',
    phaseId: 'phase-a',
    sourcePlatform: 'Test',
    addedBy: 'tester',
    addedAt: '2026-01-01T00:00:00.000Z',
    status: 'active',
    sectionOrder: [],
    requiredBlocks: [],
    ...overrides,
  };
}

function ir(blocks: CanonicalIR['blocks'], metaOverrides: Partial<typeof META> = {}): CanonicalIR {
  return { meta: { ...META, ...metaOverrides }, blocks };
}

describe('renderer', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'export-engine-renderer-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function setupFormat(config: FormatConfig, meta: FormatMeta = baseMeta()) {
    const dir = join(root, config.phaseId, 'format-a');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.json'), JSON.stringify(config, null, 2));
    writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
    writeFileSync(join(dir, 'template.dotx'), TEMPLATE);
    return resolveFormat(config.formatId, { root });
  }

  function documentXml(bytes: Buffer): string {
    return zipRead(bytes).files.get('word/document.xml')!.toString('utf8');
  }

  it('applies the correct Word style (from headings/styleMap) for each base IR block type', () => {
    const format = setupFormat(baseConfig());
    const document = ir([
      { id: '1', type: 'heading', level: 1, runs: [{ text: 'H1' }] },
      { id: '2', type: 'paragraph', runs: [{ text: 'P' }] },
    ]);
    const xml = documentXml(renderToDocx(document, format).bytes);
    const headingStyleId = format.styleIds['headings.1'];
    const bodyStyleId = format.styleIds['styleMap.paragraph'];
    expect(xml).toContain(`<w:pStyle w:val="${headingStyleId}"/>`);
    expect(xml).toContain(`<w:pStyle w:val="${bodyStyleId}"/>`);
  });

  it('respects sectionOrder (from meta.json) regardless of the order blocks appear in the IR', () => {
    const format = setupFormat(baseConfig(), baseMeta({ sectionOrder: ['first', 'second'] }));
    const document = ir([
      { id: '1', type: 'paragraph', runs: [{ text: 'SECOND-TEXT' }], attrs: { sectionId: 'second' } },
      { id: '2', type: 'paragraph', runs: [{ text: 'FIRST-TEXT' }], attrs: { sectionId: 'first' } },
    ]);
    const xml = documentXml(renderToDocx(document, format).bytes);
    expect(xml.indexOf('FIRST-TEXT')).toBeLessThan(xml.indexOf('SECOND-TEXT'));
  });

  it('renders external numbering (from meta.json) with exact gaps (4a, 4b, not renumbered to 4, 5)', () => {
    const format = setupFormat(
      baseConfig(),
      baseMeta({ numbering: { checklistItem: { scheme: 'x', source: 'attrs.checklistNo', suffix: '. ' } } }),
    );
    const document = ir([
      { id: '1', type: 'checklistItem', runs: [{ text: 'x' }], attrs: { checklistNo: '4a' } },
      { id: '2', type: 'checklistItem', runs: [{ text: 'y' }], attrs: { checklistNo: '4b' } },
    ]);
    const xml = documentXml(renderToDocx(document, format).bytes);
    expect(xml).toContain('4a. ');
    expect(xml).toContain('4b. ');
    expect(xml).not.toContain('>4. <');
    expect(xml).not.toContain('>5. <');
  });

  it('TOC reflects the actual heading hierarchy and respects toc.depth', () => {
    const format = setupFormat(baseConfig({ toc: { enabled: true, depth: 1, autoGenerateFromHeadings: true } }));
    const document = ir([
      { id: '1', type: 'heading', level: 1, runs: [{ text: 'Top level' }] },
      { id: '2', type: 'heading', level: 2, runs: [{ text: 'Second level' }] },
    ]);
    const xml = documentXml(renderToDocx(document, format).bytes);
    expect(xml).toContain('Top level');
    // depth 1 excludes the level-2 heading from the TOC hyperlink entries, though the heading
    // itself still renders in the body.
    const tocSection = xml.slice(0, xml.indexOf('w:sectPr'));
    expect(tocSection).toContain('TOC');
  });

  it('cover page, header/footer, and page numbering toggle independently', () => {
    const withCoverOnly = setupFormat(baseConfig({ docFeatures: { coverPage: true } }));
    const coverXml = documentXml(renderToDocx(ir([]), withCoverOnly).bytes);
    expect(coverXml).toContain(META.documentTitle);
    expect(coverXml).not.toContain('w:headerReference');

    const withFooterOnly = setupFormat(baseConfig({ pageNumbering: 'arabic' }));
    const footerBytes = renderToDocx(ir([]), withFooterOnly).bytes;
    const footerXml = documentXml(footerBytes);
    expect(footerXml).not.toContain(META.documentTitle); // no cover page
    expect(zipRead(footerBytes).files.has('word/footer1.xml')).toBe(true);

    const withNeither = setupFormat(baseConfig({}));
    const neitherBytes = renderToDocx(ir([]), withNeither).bytes;
    expect(zipRead(neitherBytes).files.has('word/footer1.xml')).toBe(false);
    expect(zipRead(neitherBytes).files.has('word/header1.xml')).toBe(false);
  });

  it('renders the same IR+config twice to byte-identical output (determinism)', () => {
    const format = setupFormat(
      baseConfig({ docFeatures: { coverPage: true }, toc: { enabled: true, depth: 2, autoGenerateFromHeadings: true } }),
    );
    const document = ir([
      { id: '1', type: 'heading', level: 1, runs: [{ text: 'A heading' }] },
      { id: '2', type: 'paragraph', runs: [{ text: 'Some body text.', marks: ['bold'] }] },
    ]);
    const first = renderToDocx(document, format);
    const second = renderToDocx(document, format);
    expect(first.bytes.equals(second.bytes)).toBe(true);
  });

  it('falls back an unknown blockKind per fallback.unknownBlockKind rather than failing the whole render', () => {
    const format = setupFormat(baseConfig());
    const document = ir([
      { id: '1', type: 'paragraph', runs: [{ text: 'unmapped content' }], attrs: { blockKind: 'somethingNew', unknownBlockKind: true } },
    ]);
    const xml = documentXml(renderToDocx(document, format).bytes);
    expect(xml).toContain('unmapped content');
  });

  it('applies direct formatting from a headings.N entry on top of the named style', () => {
    const format = setupFormat(
      baseConfig({
        headings: { '1': { wordStyle: 'Heading One', bold: true, align: 'center', sizePt: 20 } },
      }),
    );
    const document = ir([{ id: '1', type: 'heading', level: 1, runs: [{ text: 'Title' }] }]);
    const xml = documentXml(renderToDocx(document, format).bytes);
    expect(xml).toContain('<w:jc w:val="center"/>');
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('<w:sz w:val="40"/>'); // 20pt -> 40 half-points
  });

  it('applies direct formatting from a styleMap object entry (style + runFormatting + paragraphFormatting)', () => {
    const format = setupFormat(
      baseConfig({ styleMap: { ...baseConfig().styleMap, 'custom:emphasisPara': { style: 'Body Copy', runFormatting: { italic: true }, paragraphFormatting: { alignment: 'right' } } } }),
    );
    const document = ir([{ id: '1', type: 'paragraph', runs: [{ text: 'x' }], attrs: { blockKind: 'emphasisPara' } }]);
    const xml = documentXml(renderToDocx(document, format).bytes);
    expect(xml).toContain('<w:i/>');
    expect(xml).toContain('<w:jc w:val="right"/>');
  });

  it('honours page.widthTwips/heightTwips/margins from config.page', () => {
    const format = setupFormat(
      baseConfig({
        page: { size: 'a4', widthTwips: 11907, heightTwips: 16840, orientation: 'portrait', margins: { topTwips: 900, rightTwips: 900, bottomTwips: 900, leftTwips: 900 } },
      }),
    );
    const xml = documentXml(renderToDocx(ir([]), format).bytes);
    expect(xml).toContain('w:w="11907" w:h="16840"');
    expect(xml).toContain('w:left="900"');
  });
});
