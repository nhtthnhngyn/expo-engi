import { describe, expect, it } from 'vitest';
import { lintFormatStyle } from './style-map-lint.js';
import { readStyles } from './dotx-styles.js';
import { buildDotx } from '../tools/dotx-builder.js';
import type { FormatConfig, StyleMapEntry } from '../core/types.js';

const template = buildDotx({
  bodyFont: 'Calibri',
  bodySizeHalfPoints: 22,
  styles: [{ name: 'Body Text' }, { name: 'Heading 1', outlineLevel: 0 }],
});
const index = readStyles(template);

function cfg(styleMap: Record<string, StyleMapEntry>): FormatConfig {
  return {
    formatId: 'x.y',
    displayName: 'X',
    phaseId: 'x',
    version: 'v1',
    templateFile: 'template.dotx',
    page: { size: 'letter', widthTwips: 12240, heightTwips: 15840, orientation: 'portrait', margins: { topTwips: 0, rightTwips: 0, bottomTwips: 0, leftTwips: 0 } },
    typography: { defaultFont: 'Calibri', defaultSizePt: 11, defaultLineSpacing: 'single', defaultAlignment: 'left' },
    headings: {},
    styleMap,
    toc: { enabled: false, depth: 0, autoGenerateFromHeadings: false },
    headingNumbering: { auto: false },
    citationStyle: 'none',
    pageNumbering: 'none',
  };
}

describe('style-map lint', () => {
  it('flags every styleMap entry whose target style is absent from the .dotx', () => {
    const report = lintFormatStyle(cfg({ paragraph: 'Body Text', 'heading:1': 'Does Not Exist', table: 'Also Missing' }), index);
    expect(report.ok).toBe(false);
    expect(report.issues.map((i) => i.key).sort()).toEqual(['styleMap.heading:1', 'styleMap.table']);
  });

  it('passes cleanly on a config where every referenced style exists', () => {
    const report = lintFormatStyle(cfg({ paragraph: 'Body Text', 'heading:1': 'Heading 1' }), index);
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it('reports all mismatches in one pass, not just the first', () => {
    const report = lintFormatStyle(cfg({ a: 'x', b: 'y', c: 'z' }), index);
    expect(report.issues.length).toBe(3);
  });

  it('resolves case-insensitively and by styleId', () => {
    const report = lintFormatStyle(cfg({ paragraph: 'body text' }), index);
    expect(report.ok).toBe(true);
  });

  it('flags a direct-formatting styleMap entry (object with style) the same way', () => {
    const report = lintFormatStyle(cfg({ title: { style: 'Missing Style', runFormatting: { bold: true } } }), index);
    expect(report.ok).toBe(false);
    expect(report.issues[0]?.key).toBe('styleMap.title');
  });
});
