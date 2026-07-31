/**
 * Reads the real style list out of a `.dotx`/`.docx`.
 *
 * Everything here is verbatim reporting: the styles are whatever `word/styles.xml` actually
 * declares. Nothing is invented, renamed, or inferred — the style-map lint and the renderer both
 * depend on that being literally true.
 */

import { zipRead } from '../core/ooxml/zip.js';
import { attr, findAll, parseXml } from '../core/ooxml/xml.js';

export interface DotxStyle {
  /** The internal id used in `w:pStyle` / `w:rStyle`. */
  styleId: string;
  /** The display name authors see in Word — what a `styleMap` entry refers to. */
  name: string;
  /** `paragraph`, `character`, `table`, or `numbering`. */
  type: string;
}

export interface DotxStyleIndex {
  styles: DotxStyle[];
  /** Lookup by display name (case-insensitive) -> styleId. */
  byName: Map<string, DotxStyle>;
  byId: Map<string, DotxStyle>;
}

export function normalizeStyleName(name: string): string {
  return name.trim().toLowerCase();
}

/** Parses `word/styles.xml` out of a package's bytes. */
export function readStyles(packageBytes: Buffer): DotxStyleIndex {
  const { files } = zipRead(packageBytes);
  const stylesPart = files.get('word/styles.xml');
  if (!stylesPart) return { styles: [], byName: new Map(), byId: new Map() };
  return parseStylesXml(stylesPart.toString('utf8'));
}

export function parseStylesXml(xml: string): DotxStyleIndex {
  const root = parseXml(xml);
  const styles: DotxStyle[] = [];

  for (const el of findAll(root, 'style')) {
    const styleId = attr(el, 'styleId');
    if (!styleId) continue;
    const nameEl = el.children.find((child) => child.local === 'name');
    const name = (nameEl ? attr(nameEl, 'val') : undefined) ?? styleId;
    const type = attr(el, 'type') ?? 'paragraph';
    styles.push({ styleId, name, type });
  }

  const byName = new Map<string, DotxStyle>();
  const byId = new Map<string, DotxStyle>();
  for (const style of styles) {
    // First declaration wins, so the index is stable regardless of duplicate display names.
    if (!byName.has(normalizeStyleName(style.name))) byName.set(normalizeStyleName(style.name), style);
    if (!byId.has(style.styleId)) byId.set(style.styleId, style);
  }

  return { styles, byName, byId };
}

/** Resolves a `styleMap` value (a display name, or a styleId) to the id Word needs. */
export function resolveStyleId(index: DotxStyleIndex, styleNameOrId: string): string | undefined {
  const byName = index.byName.get(normalizeStyleName(styleNameOrId));
  if (byName) return byName.styleId;
  const byId = index.byId.get(styleNameOrId);
  if (byId) return byId.styleId;
  return undefined;
}
