/**
 * Numbering.
 *
 * Two unrelated things share the word "numbering" in Word, and this module keeps them apart:
 *
 *  - **List numbering** is Word's own, defined in the template's `numbering.xml`. We *discover*
 *    which `numId` is the bullet list and which is the ordered list by reading the template — the
 *    ids are never hardcoded here.
 *  - **External numbering** is the research standard's own numbering (CONSORT item "4b"). It is
 *    read verbatim out of the IR at the path the config's `numbering` rule names, and rendered as
 *    literal text. It is never generated or re-sequenced, which is exactly why "4a, 4b" survives
 *    instead of becoming "4, 5".
 */

import type { FormatMeta, IRBlock, NumberingRule } from '../core/types.js';
import { zipRead } from '../core/ooxml/zip.js';
import { attr, findAll, parseXml } from '../core/ooxml/xml.js';

export interface ListNumbering {
  bulletNumId?: number;
  orderedNumId?: number;
}

/** Reads `word/numbering.xml` and works out which num to use for bullets and which for ordered. */
export function readListNumbering(packageBytes: Buffer): ListNumbering {
  const { files } = zipRead(packageBytes);
  const part = files.get('word/numbering.xml');
  if (!part) return {};
  return parseListNumbering(part.toString('utf8'));
}

export function parseListNumbering(xml: string): ListNumbering {
  const root = parseXml(xml);

  const formatByAbstractId = new Map<string, string>();
  for (const abstractNum of findAll(root, 'abstractNum')) {
    const abstractId = attr(abstractNum, 'abstractNumId');
    if (!abstractId) continue;
    const level0 = abstractNum.children.find(
      (child) => child.local === 'lvl' && (attr(child, 'ilvl') === '0' || attr(child, 'ilvl') === undefined),
    );
    if (!level0) continue;
    const numFmtEl = level0.children.find((child) => child.local === 'numFmt');
    const numFmt = numFmtEl ? attr(numFmtEl, 'val') : undefined;
    if (numFmt) formatByAbstractId.set(abstractId, numFmt);
  }

  const out: ListNumbering = {};
  for (const num of findAll(root, 'num')) {
    const numId = attr(num, 'numId');
    if (!numId) continue;
    const ref = num.children.find((child) => child.local === 'abstractNumId');
    const abstractId = ref ? attr(ref, 'val') : undefined;
    if (!abstractId) continue;
    const fmt = formatByAbstractId.get(abstractId);
    if (fmt === 'bullet' && out.bulletNumId === undefined) out.bulletNumId = Number(numId);
    if (fmt && fmt !== 'bullet' && out.orderedNumId === undefined) out.orderedNumId = Number(numId);
  }
  return out;
}

/** Reads a value out of a block at an `attrs.x.y` path. Only `attrs.*` paths are supported. */
export function readAttrPath(block: IRBlock, path: string): string | undefined {
  if (!path.startsWith('attrs.')) return undefined;
  let current: unknown = block.attrs;
  for (const segment of path.slice('attrs.'.length).split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  if (current === undefined || current === null) return undefined;
  return String(current);
}

/** The numbering rule that applies to a block, if the format's meta declares one. */
export function ruleFor(meta: FormatMeta, block: IRBlock): NumberingRule | undefined {
  const numbering = meta.numbering;
  if (!numbering) return undefined;
  const blockKind = block.attrs?.blockKind;
  if (typeof blockKind === 'string' && numbering[`custom:${blockKind}`]) return numbering[`custom:${blockKind}`];
  if (typeof blockKind === 'string' && numbering[blockKind]) return numbering[blockKind];
  return numbering[block.type];
}

/**
 * The literal text prefix a block's external number contributes, e.g. `"4b. "`.
 * Returns an empty string when no rule applies or the source attribute is absent.
 */
export function externalNumberPrefix(meta: FormatMeta, block: IRBlock): string {
  const rule = ruleFor(meta, block);
  if (!rule) return '';
  const value = readAttrPath(block, rule.source);
  if (value === undefined || value === '') return '';
  const prefix = rule.prefix ?? '';
  const suffix = rule.suffix ?? '. ';
  return `${prefix}${value}${suffix}`;
}
