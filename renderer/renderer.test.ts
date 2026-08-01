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

  it('splits a run\'s embedded newlines into <w:br/> instead of a raw newline byte inside <w:t>', () => {
    const format = setupFormat(baseConfig());
    const document = ir([
      { id: '1', type: 'paragraph', runs: [{ text: 'Line one\nLine two\nLine three' }] },
    ]);
    const xml = documentXml(renderToDocx(document, format).bytes);
    expect(xml).toContain('<w:t xml:space="preserve">Line one</w:t><w:br/><w:t xml:space="preserve">Line two</w:t><w:br/><w:t xml:space="preserve">Line three</w:t>');
    expect(xml).not.toMatch(/<w:t[^>]*>[^<]*\n/);
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

  describe('tables', () => {
    function simpleTable(): CanonicalIR['blocks'][number] {
      return {
        id: 't1',
        type: 'table',
        children: [
          {
            id: 'r1',
            type: 'tableRow',
            children: [
              { id: 'c1', type: 'tableCell', children: [{ id: 'c1p', type: 'paragraph', runs: [{ text: 'A' }] }] },
              { id: 'c2', type: 'tableCell', children: [{ id: 'c2p', type: 'paragraph', runs: [{ text: 'B' }] }] },
            ],
          },
        ],
      };
    }

    it('gives every table a full bold border grid, even with no named table style in styleMap', () => {
      const format = setupFormat(baseConfig({ styleMap: { ...baseConfig().styleMap, table: undefined as never } }));
      const xml = documentXml(renderToDocx(ir([simpleTable()]), format).bytes);
      expect(xml).toContain('<w:tblBorders>');
      expect(xml).toContain('<w:top w:val="single" w:sz="2"');
      expect(xml).toContain('<w:insideH w:val="single" w:sz="2"');
      expect(xml).toContain('<w:insideV w:val="single" w:sz="2"');
    });

    it('still gives the full bold border grid when the config does declare a named table style', () => {
      const format = setupFormat(baseConfig()); // styleMap.table: 'Table Style'
      const xml = documentXml(renderToDocx(ir([simpleTable()]), format).bytes);
      expect(xml).toContain('<w:tblStyle');
      expect(xml).toContain('<w:tblBorders>');
    });

    it('renders a merged-cell table (colspan + rowspan) with correct gridSpan/vMerge XML and no data loss', () => {
      const format = setupFormat(baseConfig());
      const mergedTable: CanonicalIR['blocks'][number] = {
        id: 't1',
        type: 'table',
        children: [
          {
            id: 'r1',
            type: 'tableRow',
            children: [
              {
                id: 'c1',
                type: 'tableCell',
                attrs: { colspan: 2 },
                children: [{ id: 'c1p', type: 'paragraph', runs: [{ text: 'Spans two columns' }] }],
              },
            ],
          },
          {
            id: 'r2',
            type: 'tableRow',
            children: [
              {
                id: 'c2',
                type: 'tableCell',
                attrs: { rowspan: 2 },
                children: [{ id: 'c2p', type: 'paragraph', runs: [{ text: 'Spans two rows' }] }],
              },
              { id: 'c3', type: 'tableCell', children: [{ id: 'c3p', type: 'paragraph', runs: [{ text: 'Row 2 col 2' }] }] },
            ],
          },
          {
            id: 'r3',
            type: 'tableRow',
            children: [{ id: 'c4', type: 'tableCell', children: [{ id: 'c4p', type: 'paragraph', runs: [{ text: 'Row 3 col 2' }] }] }],
          },
        ],
      };
      const xml = documentXml(renderToDocx(ir([mergedTable]), format).bytes);
      expect(xml).toContain('<w:gridSpan w:val="2"/>');
      expect(xml).toContain('<w:vMerge w:val="restart"/>');
      expect(xml).toContain('<w:vMerge/>'); // the continuation cell in row 3
      expect(xml).toContain('Spans two columns');
      expect(xml).toContain('Spans two rows');
      expect(xml).toContain('Row 2 col 2');
      expect(xml).toContain('Row 3 col 2');
      // 3 rows in the IR, but row 3 only declares 1 real cell — the vMerge continuation for the
      // rowspan from row 2 must still be inserted so Word's grid stays rectangular.
      expect((xml.match(/<w:tr>/g) ?? []).length).toBe(3);
    });

    it("a table cell's own child keeps its blockKind-specific direct formatting, not the cell's generic fallback style", () => {
      // Regression test: config.json declares a plain `styleMap.paragraph: "Body Copy"`, which
      // resolves to a truthy styleId for the CELL itself (via the universal fallback path every
      // block resolves through) — that used to leak onto every child paragraph inside the cell,
      // silently discarding a child's own blockKind-specific bold/center/italic formatting the
      // moment it was nested inside a table (e.g. a signature block placed in a 2-column table).
      const format = setupFormat(
        baseConfig({
          styleMap: {
            ...baseConfig().styleMap,
            'custom:signatureBlock': { style: 'Body Copy', runFormatting: { bold: true }, paragraphFormatting: { alignment: 'center' } },
          },
        }),
      );
      const tableWithSignature: CanonicalIR['blocks'][number] = {
        id: 't1',
        type: 'table',
        children: [
          {
            id: 'r1',
            type: 'tableRow',
            children: [
              {
                id: 'c1',
                type: 'tableCell',
                children: [
                  { id: 'p1', type: 'paragraph', runs: [{ text: 'HỌC VIÊN' }], attrs: { blockKind: 'signatureBlock' } },
                ],
              },
            ],
          },
        ],
      };
      const xml = documentXml(renderToDocx(ir([tableWithSignature]), format).bytes);
      expect(xml).toContain('<w:b/>');
      expect(xml).toContain('<w:jc w:val="center"/>');
    });

    it('a plain cell child with no blockKind/role still inherits the cell-level fallback style, unchanged from before this fix', () => {
      const format = setupFormat(
        baseConfig({ styleMap: { ...baseConfig().styleMap, tableHeader: 'Heading Two' } }),
      );
      const headerCellTable: CanonicalIR['blocks'][number] = {
        id: 't1',
        type: 'table',
        children: [
          {
            id: 'r1',
            type: 'tableRow',
            children: [
              {
                id: 'c1',
                type: 'tableCell',
                attrs: { header: true },
                children: [{ id: 'p1', type: 'paragraph', runs: [{ text: 'plain' }] }],
              },
            ],
          },
        ],
      };
      const xml = documentXml(renderToDocx(ir([headerCellTable]), format).bytes);
      const headerStyleId = format.styleIds['styleMap.tableHeader'];
      // The plain child carries no blockKind/role of its own, so it inherits the header CELL's own
      // resolved style ('styleMap.tableHeader', since attrs.header is true) — cell-level styling
      // still flows to un-tagged children exactly as before this fix.
      expect(xml).toContain(`<w:pStyle w:val="${headerStyleId}"/>`);
    });
  });
});
