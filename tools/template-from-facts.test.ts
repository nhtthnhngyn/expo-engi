import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { zipRead } from '../core/ooxml/zip.js';
import { buildTemplatesFromFacts, readTemplateFacts, templateDefinitionFromFacts } from './template-from-facts.js';
import type { TemplateFacts } from '../core/types.js';

const VALID_FACTS: TemplateFacts = {
  formatId: 'demo-phase.demo-format',
  bodyFont: 'Times New Roman',
  bodySizeHalfPoints: 24,
  styles: [
    { name: 'Heading1', type: 'paragraph', sizeHalfPoints: 32, bold: true, outlineLevel: 0 },
    { name: 'Bibliography', type: 'paragraph', indentHanging: 360 },
  ],
};

let dirs: string[] = [];
function makeTmpFormatsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'template-facts-test-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe('templateDefinitionFromFacts', () => {
  it('carries bodyFont/bodySizeHalfPoints/styles straight through, dropping only formatId', () => {
    const def = templateDefinitionFromFacts(VALID_FACTS);
    expect(def).toEqual({
      bodyFont: 'Times New Roman',
      bodySizeHalfPoints: 24,
      styles: VALID_FACTS.styles,
    });
  });
});

describe('readTemplateFacts', () => {
  it('throws a structured error for facts that violate the schema', () => {
    const dir = makeTmpFormatsDir();
    const path = join(dir, 'bad-facts.json');
    writeFileSync(path, JSON.stringify({ formatId: 'demo-phase.demo-format', bodyFont: 'Arial' }));
    expect(() => readTemplateFacts(path)).toThrow(/template-facts\.schema\.json/);
  });

  it('parses facts that satisfy the schema', () => {
    const dir = makeTmpFormatsDir();
    const path = join(dir, 'facts.json');
    writeFileSync(path, JSON.stringify(VALID_FACTS));
    expect(readTemplateFacts(path)).toEqual(VALID_FACTS);
  });
});

describe('buildTemplatesFromFacts', () => {
  it('builds a template.dotx from a discovered template-facts.json, containing the real style facts', () => {
    const formatsDir = makeTmpFormatsDir();
    const fmtDir = join(formatsDir, 'demo-phase', 'demo-format');
    mkdirSync(fmtDir, { recursive: true });
    writeFileSync(join(fmtDir, 'template-facts.json'), JSON.stringify(VALID_FACTS));

    const result = buildTemplatesFromFacts(formatsDir);
    expect(result.written).toEqual([join(fmtDir, 'template.dotx')]);
    expect(result.unchanged).toEqual([]);

    const bytes = readFileSync(join(fmtDir, 'template.dotx'));
    const { files } = zipRead(bytes);
    const stylesXml = files.get('word/styles.xml')!.toString('utf8');
    expect(stylesXml).toContain('w:name w:val="Heading1"');
    expect(stylesXml).toContain('w:name w:val="Bibliography"');
    expect(stylesXml).toContain('Times New Roman');
  });

  it('is a no-op on a second run with unchanged facts (byte-deterministic)', () => {
    const formatsDir = makeTmpFormatsDir();
    const fmtDir = join(formatsDir, 'demo-phase', 'demo-format');
    mkdirSync(fmtDir, { recursive: true });
    writeFileSync(join(fmtDir, 'template-facts.json'), JSON.stringify(VALID_FACTS));

    buildTemplatesFromFacts(formatsDir);
    const second = buildTemplatesFromFacts(formatsDir);
    expect(second.written).toEqual([]);
    expect(second.unchanged).toEqual([join(fmtDir, 'template.dotx')]);
  });

  it('rebuilds when the facts file changes', () => {
    const formatsDir = makeTmpFormatsDir();
    const fmtDir = join(formatsDir, 'demo-phase', 'demo-format');
    mkdirSync(fmtDir, { recursive: true });
    writeFileSync(join(fmtDir, 'template-facts.json'), JSON.stringify(VALID_FACTS));
    buildTemplatesFromFacts(formatsDir);

    writeFileSync(join(fmtDir, 'template-facts.json'), JSON.stringify({ ...VALID_FACTS, bodyFont: 'Georgia' }));
    const result = buildTemplatesFromFacts(formatsDir);
    expect(result.written).toEqual([join(fmtDir, 'template.dotx')]);
  });

  it('throws a structured error when a discovered facts file is invalid', () => {
    const formatsDir = makeTmpFormatsDir();
    const fmtDir = join(formatsDir, 'demo-phase', 'demo-format');
    mkdirSync(fmtDir, { recursive: true });
    writeFileSync(join(fmtDir, 'template-facts.json'), JSON.stringify({ formatId: 'demo-phase.demo-format' }));

    expect(() => buildTemplatesFromFacts(formatsDir)).toThrow(/template-facts\.schema\.json/);
  });

  it('returns empty results when no format has a template-facts.json', () => {
    const formatsDir = makeTmpFormatsDir();
    const fmtDir = join(formatsDir, 'demo-phase', 'demo-format');
    mkdirSync(fmtDir, { recursive: true });
    writeFileSync(join(fmtDir, 'config.json'), '{}');

    const result = buildTemplatesFromFacts(formatsDir);
    expect(result).toEqual({ written: [], unchanged: [] });
  });
});
