import { describe, expect, it } from 'vitest';
import { checkFormatFamilyConsistency } from './format-family.js';
import type { FormatConfig } from '../core/types.js';

function baseConfig(overrides: Partial<FormatConfig> = {}): FormatConfig {
  return {
    formatId: 'phase.base',
    displayName: 'Base',
    phaseId: 'phase',
    version: 'v1',
    templateFile: 'template.dotx',
    page: { size: 'a4', widthTwips: 11907, heightTwips: 16840, orientation: 'portrait', margins: { topTwips: 1440, rightTwips: 1440, bottomTwips: 1440, leftTwips: 1440 } },
    typography: { defaultFont: 'Times New Roman', defaultSizePt: 13, defaultLineSpacing: '1.5', defaultAlignment: 'justify' },
    headings: { '1': { wordStyle: 'Heading1' } },
    styleMap: { paragraph: 'Normal', reference: 'Bibliography' },
    toc: { enabled: true, depth: 3, autoGenerateFromHeadings: true },
    headingNumbering: { auto: false },
    citationStyle: 'none',
    pageNumbering: 'arabic',
    ...overrides,
  };
}

describe('checkFormatFamilyConsistency', () => {
  it('reports no problems when a format has no sharedFormattingWith claim', () => {
    const configs = new Map([['phase.solo', baseConfig({ formatId: 'phase.solo' })]]);
    expect(checkFormatFamilyConsistency(configs)).toEqual([]);
  });

  it('reports no problems when two configs sharing formatting actually match on page/typography', () => {
    const base = baseConfig({ formatId: 'phase.base' });
    const variant = baseConfig({ formatId: 'phase.variant', sharedFormattingWith: 'phase.base' });
    const configs = new Map([
      ['phase.base', base],
      ['phase.variant', variant],
    ]);
    expect(checkFormatFamilyConsistency(configs)).toEqual([]);
  });

  it('flags a claimed sibling that does not exist', () => {
    const configs = new Map([
      ['phase.variant', baseConfig({ formatId: 'phase.variant', sharedFormattingWith: 'phase.missing' })],
    ]);
    const problems = checkFormatFamilyConsistency(configs);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toMatch(/no such format is registered/);
  });

  it('flags a typography mismatch between two formats claiming shared formatting', () => {
    const base = baseConfig({ formatId: 'phase.base' });
    const drifted = baseConfig({
      formatId: 'phase.variant',
      sharedFormattingWith: 'phase.base',
      typography: { ...base.typography, defaultFont: 'Arial' },
    });
    const configs = new Map([
      ['phase.base', base],
      ['phase.variant', drifted],
    ]);
    const problems = checkFormatFamilyConsistency(configs);
    expect(problems.some((p) => p.message.includes('"typography" differ'))).toBe(true);
  });

  it('flags a page geometry mismatch', () => {
    const base = baseConfig({ formatId: 'phase.base' });
    const drifted = baseConfig({
      formatId: 'phase.variant',
      sharedFormattingWith: 'phase.base',
      page: { ...base.page, widthTwips: 12240 },
    });
    const configs = new Map([
      ['phase.base', base],
      ['phase.variant', drifted],
    ]);
    const problems = checkFormatFamilyConsistency(configs);
    expect(problems.some((p) => p.message.includes('"page" differ'))).toBe(true);
  });

  it('flags a styleMap value mismatch on a key both configs define', () => {
    const base = baseConfig({ formatId: 'phase.base' });
    const drifted = baseConfig({
      formatId: 'phase.variant',
      sharedFormattingWith: 'phase.base',
      styleMap: { ...base.styleMap, reference: 'DifferentBibliographyStyle' },
    });
    const configs = new Map([
      ['phase.base', base],
      ['phase.variant', drifted],
    ]);
    const problems = checkFormatFamilyConsistency(configs);
    expect(problems.some((p) => p.message.includes('styleMap["reference"]'))).toBe(true);
  });

  it('does not flag a styleMap key only one of the two configs defines', () => {
    const base = baseConfig({ formatId: 'phase.base' });
    const variant = baseConfig({
      formatId: 'phase.variant',
      sharedFormattingWith: 'phase.base',
      styleMap: { ...base.styleMap, tableOfContentsField: 'TOCHeading' },
    });
    const configs = new Map([
      ['phase.base', base],
      ['phase.variant', variant],
    ]);
    expect(checkFormatFamilyConsistency(configs)).toEqual([]);
  });
});
