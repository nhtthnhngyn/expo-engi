/**
 * Style-source collection — the single place that walks a `config.json` and enumerates every
 * (path, requested Word style name, direct-formatting overrides) triple it contains.
 *
 * Both the style-map lint and the renderer's style resolution are built on this one traversal, so
 * "every style name the config references" and "every style the renderer will actually apply" can
 * never drift apart.
 *
 * A `config.json` can name a style in four places: `styleMap.<key>`, `headings.<levelOrRole>`,
 * `caption`, `reference`, `table`. Each becomes one `StyleSourceRef` keyed by a stable `path`
 * string (`styleMap.paragraph`, `headings.1`, `headings.titleVn`, `caption`, `reference`, `table`).
 */

import type { DirectFormatSpec, FormatConfig, StyleMapDirectEntry } from '../core/types.js';

export interface DirectFormatting {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  alignment?: 'left' | 'right' | 'center' | 'justify';
  font?: string;
  sizePt?: number;
}

export interface StyleSourceRef {
  /** Stable path, e.g. `styleMap.paragraph`, `headings.1`, `headings.titleVn`, `caption`. */
  path: string;
  /** The style name the config asked for — undefined for a direct-formatting-only entry with no base style. */
  requestedName?: string;
  direct: DirectFormatting;
}

function isDirectEntry(value: unknown): value is StyleMapDirectEntry {
  return typeof value === 'object' && value !== null && typeof (value as StyleMapDirectEntry).style === 'string';
}

function fromStyleMapEntry(path: string, value: string | StyleMapDirectEntry): StyleSourceRef {
  if (typeof value === 'string') return { path, requestedName: value, direct: {} };
  return {
    path,
    requestedName: value.style,
    direct: {
      bold: value.runFormatting?.bold,
      italic: value.runFormatting?.italic,
      underline: value.runFormatting?.underline,
      alignment: value.paragraphFormatting?.alignment,
    },
  };
}

function fromDirectFormatSpec(path: string, value: DirectFormatSpec): StyleSourceRef {
  return {
    path,
    requestedName: value.wordStyle,
    direct: { bold: value.bold, italic: value.italic, alignment: value.align, font: value.font, sizePt: value.sizePt },
  };
}

const HEADINGS_METADATA_KEYS = new Set(['method', 'note']);

export function collectStyleSources(config: FormatConfig): StyleSourceRef[] {
  const out: StyleSourceRef[] = [];

  for (const [key, value] of Object.entries(config.styleMap ?? {})) {
    out.push(fromStyleMapEntry(`styleMap.${key}`, value));
  }

  for (const [key, value] of Object.entries(config.headings ?? {})) {
    if (HEADINGS_METADATA_KEYS.has(key)) continue;
    if (typeof value !== 'object' || value === null) continue;
    out.push(fromDirectFormatSpec(`headings.${key}`, value as DirectFormatSpec));
  }

  if (config.caption) out.push(fromDirectFormatSpec('caption', config.caption));
  if (config.reference) out.push(fromDirectFormatSpec('reference', config.reference));
  if (config.table) out.push(fromDirectFormatSpec('table', config.table));

  return out;
}

/** A path -> ref lookup, for resolution against a concrete IR block. */
export function indexStyleSources(config: FormatConfig): Map<string, StyleSourceRef> {
  return new Map(collectStyleSources(config).map((ref) => [ref.path, ref]));
}
