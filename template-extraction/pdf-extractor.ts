/**
 * Deterministic PDF structural extraction.
 *
 * A PDF has no style metadata, so there is nothing to report verbatim — only layout to measure.
 * The rules are fixed and stated up front, and every heading records the evidence it was assigned
 * from, so an author can see exactly how much to trust each line:
 *
 *   1. Measure every text run's font size and whether its base font name contains "Bold".
 *   2. The most frequently occurring size is body text.
 *   3. Sizes larger than body text are ranked descending: largest = level 1, next = level 2, and so
 *      on, capped at level 6.
 *   4. A run at body size that is bold and shorter than 80 characters is one level below the
 *      smallest size-derived heading.
 *
 * That is the whole heuristic. There is no model, no scoring, no "best guess" beyond these rules,
 * and nothing here proposes a `styleMap` — a PDF has no style names to map.
 */

import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { OUTLINE_NOTICE, TOOL_INFO, type ExtractedHeading, type ExtractionOutline } from './outline.js';

const MAX_HEADING_LEVEL = 6;
const BOLD_HEADING_MAX_CHARS = 80;

interface TextRun {
  text: string;
  size: number;
  bold: boolean;
}

export function extractFromPdf(bytes: Buffer, filename: string): ExtractionOutline {
  const warnings: string[] = [];
  const raw = bytes.toString('latin1');

  if (!raw.startsWith('%PDF-')) {
    warnings.push('File does not start with a %PDF- header; parsed on a best-effort basis.');
  }

  const fontNames = collectFontNames(raw);
  const runs = collectTextRuns(raw, fontNames, warnings);

  if (runs.length === 0) {
    warnings.push(
      'No text runs could be read. The PDF may use an unsupported stream filter or contain only scanned images; ' +
        'style and heading extraction returned empty rather than failing the job.',
    );
  }

  return {
    generator: TOOL_INFO,
    source: {
      filename,
      kind: 'pdf',
      byteLength: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
    // A PDF carries no named styles. Reporting an empty list is the honest answer; inventing style
    // names here would violate the guardrail in spec section 10.
    styles: [],
    numbering: [],
    headingOutline: assignHeadingLevels(runs),
    tables: [],
    headersFooters: [],
    warnings,
    notice: OUTLINE_NOTICE,
  };
}

/** Maps a font resource name (`/F1`) to its BaseFont, so "Bold" in the name is detectable. */
function collectFontNames(raw: string): Map<string, string> {
  const objects = new Map<string, string>();
  const objectRe = /(\d+)\s+0\s+obj([\s\S]*?)endobj/g;
  let match: RegExpExecArray | null;
  while ((match = objectRe.exec(raw)) !== null) {
    objects.set(match[1]!, match[2]!);
  }

  const baseFontByObject = new Map<string, string>();
  for (const [objNum, body] of objects) {
    const baseFont = /\/BaseFont\s*\/([^\s/>\]]+)/.exec(body);
    if (baseFont) baseFontByObject.set(objNum, baseFont[1]!);
  }

  const resourceToBaseFont = new Map<string, string>();
  const fontDictRe = /\/Font\s*<<([^>]*)>>/g;
  while ((match = fontDictRe.exec(raw)) !== null) {
    const entryRe = /\/([A-Za-z0-9.+-]+)\s+(?:(\d+)\s+0\s+R|\/([A-Za-z0-9.+-]+))/g;
    let entry: RegExpExecArray | null;
    while ((entry = entryRe.exec(match[1]!)) !== null) {
      const resourceName = entry[1]!;
      const objRef = entry[2];
      const inline = entry[3];
      const baseFont = objRef ? baseFontByObject.get(objRef) : inline;
      if (baseFont && !resourceToBaseFont.has(resourceName)) resourceToBaseFont.set(resourceName, baseFont);
    }
  }

  // Fonts declared inline in an object rather than through a page's resource dictionary.
  for (const [, body] of objects) {
    const nameMatch = /\/Name\s*\/([A-Za-z0-9.+-]+)/.exec(body);
    const baseMatch = /\/BaseFont\s*\/([^\s/>\]]+)/.exec(body);
    if (nameMatch && baseMatch && !resourceToBaseFont.has(nameMatch[1]!)) {
      resourceToBaseFont.set(nameMatch[1]!, baseMatch[1]!);
    }
  }

  return resourceToBaseFont;
}

function collectTextRuns(raw: string, fontNames: Map<string, string>, warnings: string[]): TextRun[] {
  const runs: TextRun[] = [];
  for (const stream of contentStreams(raw, warnings)) {
    runs.push(...parseContentStream(stream, fontNames));
  }
  return runs;
}

function contentStreams(raw: string, warnings: string[]): string[] {
  const streams: string[] = [];
  const streamRe = /stream\r?\n([\s\S]*?)endstream/g;
  let match: RegExpExecArray | null;
  let compressedSkipped = 0;

  while ((match = streamRe.exec(raw)) !== null) {
    const body = match[1]!;
    const header = raw.slice(Math.max(0, match.index - 400), match.index);
    const isFlate = /\/Filter\s*(\[\s*)?\/FlateDecode/.test(header);

    if (!isFlate) {
      streams.push(body);
      continue;
    }
    try {
      streams.push(inflateSync(Buffer.from(body, 'latin1')).toString('latin1'));
    } catch {
      compressedSkipped += 1;
    }
  }

  if (compressedSkipped > 0) {
    warnings.push(
      `${compressedSkipped} compressed stream(s) could not be inflated and were skipped; results are partial.`,
    );
  }
  return streams;
}

function parseContentStream(stream: string, fontNames: Map<string, string>): TextRun[] {
  const runs: TextRun[] = [];
  let currentSize = 0;
  let currentBold = false;

  const tokenRe = /\/([A-Za-z0-9.+-]+)\s+([\d.]+)\s+Tf|\(((?:\\.|[^\\)])*)\)\s*Tj|\[((?:\\.|[^\]])*)\]\s*TJ/g;
  let match: RegExpExecArray | null;

  while ((match = tokenRe.exec(stream)) !== null) {
    if (match[1] !== undefined && match[2] !== undefined) {
      currentSize = Number(match[2]);
      const baseFont = fontNames.get(match[1]) ?? match[1];
      currentBold = /bold/i.test(baseFont);
      continue;
    }
    if (match[3] !== undefined) {
      pushRun(runs, unescapePdfString(match[3]), currentSize, currentBold);
      continue;
    }
    if (match[4] !== undefined) {
      const parts = [...match[4].matchAll(/\(((?:\\.|[^\\)])*)\)/g)].map((m) => unescapePdfString(m[1]!));
      pushRun(runs, parts.join(''), currentSize, currentBold);
    }
  }

  return runs;
}

function pushRun(runs: TextRun[], text: string, size: number, bold: boolean): void {
  const trimmed = text.trim();
  if (trimmed.length === 0 || size <= 0) return;
  runs.push({ text: trimmed, size, bold });
}

function unescapePdfString(value: string): string {
  return value.replace(/\\([nrtbf()\\])/g, (_m, ch: string) => {
    const map: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
    return map[ch] ?? ch;
  });
}

/** Applies rules 2–4 from the module docblock. */
export function assignHeadingLevels(runs: TextRun[]): ExtractedHeading[] {
  if (runs.length === 0) return [];

  const frequency = new Map<number, number>();
  for (const run of runs) frequency.set(run.size, (frequency.get(run.size) ?? 0) + 1);

  let bodySize = runs[0]!.size;
  let bestCount = -1;
  for (const size of [...frequency.keys()].sort((a, b) => a - b)) {
    const count = frequency.get(size)!;
    if (count > bestCount) {
      bestCount = count;
      bodySize = size;
    }
  }

  const headingSizes = [...new Set(runs.filter((run) => run.size > bodySize).map((run) => run.size))].sort(
    (a, b) => b - a,
  );
  const levelBySize = new Map<number, number>();
  headingSizes.forEach((size, index) => {
    levelBySize.set(size, Math.min(index + 1, MAX_HEADING_LEVEL));
  });
  const boldBodyLevel = Math.min(headingSizes.length + 1, MAX_HEADING_LEVEL);

  const out: ExtractedHeading[] = [];
  for (const run of runs) {
    const sizeLevel = levelBySize.get(run.size);
    if (sizeLevel !== undefined) {
      out.push({
        level: sizeLevel,
        text: run.text,
        evidence: `font size ${run.size} > body size ${bodySize}`,
      });
      continue;
    }
    if (run.size === bodySize && run.bold && run.text.length <= BOLD_HEADING_MAX_CHARS) {
      out.push({
        level: boldBodyLevel,
        text: run.text,
        evidence: `bold at body size ${bodySize}, ${run.text.length} chars`,
      });
    }
  }
  return out;
}
