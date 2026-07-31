/**
 * Minimal XML helpers: an escaper for the writer side, and a small tolerant pull-parser for the
 * reader side (style-map lint, structural extraction).
 *
 * The parser is deliberately small and rule-based — it handles the subset of XML that OOXML parts
 * actually use (elements, attributes, text, CDATA, comments, processing instructions) and does no
 * validation, no namespace resolution beyond keeping prefixes verbatim, and no inference.
 */

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function escapeAttr(value: string): string {
  return escapeXml(value);
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

type Part = { kind: 'text'; value: string } | { kind: 'element'; el: XmlElement };

export interface XmlElement {
  /** Tag name including prefix, e.g. `w:style`. */
  name: string;
  /** Tag name with any prefix stripped, e.g. `style`. */
  local: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  /** Concatenated direct text content (not descendant text — see `textOf` for that). */
  text: string;
  parent?: XmlElement;
  /** Direct text and child elements interleaved in document order. Used by `textOf`. */
  parts: Part[];
}

/**
 * Parses an XML document into a tree. Throws only on structurally impossible input (unclosed tag
 * at EOF); everything else is handled leniently, because extraction must degrade gracefully on
 * third-party files rather than fail the whole job.
 */
export function parseXml(source: string): XmlElement {
  const root: XmlElement = { name: '#document', local: '#document', attrs: {}, children: [], text: '', parts: [] };
  const stack: XmlElement[] = [root];
  let i = 0;

  while (i < source.length) {
    const lt = source.indexOf('<', i);
    if (lt < 0) {
      appendText(stack[stack.length - 1]!, source.slice(i));
      break;
    }
    if (lt > i) appendText(stack[stack.length - 1]!, source.slice(i, lt));

    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt);
      i = end < 0 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', lt)) {
      const end = source.indexOf(']]>', lt);
      const raw = source.slice(lt + 9, end < 0 ? source.length : end);
      appendText(stack[stack.length - 1]!, raw, true);
      i = end < 0 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<?', lt) || source.startsWith('<!', lt)) {
      const end = source.indexOf('>', lt);
      i = end < 0 ? source.length : end + 1;
      continue;
    }

    const gt = findTagEnd(source, lt);
    if (gt < 0) break;
    const inner = source.slice(lt + 1, gt);

    if (inner.startsWith('/')) {
      const name = inner.slice(1).trim();
      for (let s = stack.length - 1; s > 0; s--) {
        if (stack[s]!.name === name) {
          stack.length = s;
          break;
        }
      }
      i = gt + 1;
      continue;
    }

    const selfClosing = inner.endsWith('/');
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const el = parseTag(body);
    const parent = stack[stack.length - 1]!;
    el.parent = parent;
    parent.children.push(el);
    parent.parts.push({ kind: 'element', el });
    if (!selfClosing) stack.push(el);
    i = gt + 1;
  }

  return root;
}

function appendText(el: XmlElement, chunk: string, raw = false): void {
  if (chunk.length === 0) return;
  const value = raw ? chunk : decodeEntities(chunk);
  el.text += value;
  const last = el.parts[el.parts.length - 1];
  if (last && last.kind === 'text') last.value += value;
  else el.parts.push({ kind: 'text', value });
}

/** Finds the `>` that closes a tag, skipping any `>` that sits inside a quoted attribute value. */
function findTagEnd(source: string, start: number): number {
  let quote: string | null = null;
  for (let i = start + 1; i < source.length; i++) {
    const ch = source[i]!;
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i;
    }
  }
  return -1;
}

const ATTR_RE = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

function parseTag(body: string): XmlElement {
  const nameMatch = /^([\w:.-]+)/.exec(body.trim());
  const name = nameMatch ? nameMatch[1]! : body.trim();
  const attrs: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(body)) !== null) {
    const raw = m[3] !== undefined ? m[3] : (m[4] ?? '');
    attrs[m[1]!] = decodeEntities(raw);
  }
  const colon = name.indexOf(':');
  return {
    name,
    local: colon >= 0 ? name.slice(colon + 1) : name,
    attrs,
    children: [],
    text: '',
    parts: [],
  };
}

/** Depth-first search for every element whose local name matches. */
export function findAll(el: XmlElement, localName: string): XmlElement[] {
  const out: XmlElement[] = [];
  const walk = (node: XmlElement): void => {
    for (const child of node.children) {
      if (child.local === localName) out.push(child);
      walk(child);
    }
  };
  walk(el);
  return out;
}

export function findFirst(el: XmlElement, localName: string): XmlElement | undefined {
  for (const child of el.children) {
    if (child.local === localName) return child;
    const nested = findFirst(child, localName);
    if (nested) return nested;
  }
  return undefined;
}

/** Reads an attribute ignoring its namespace prefix (`w:val` and `val` both match `val`). */
export function attr(el: XmlElement, localName: string): string | undefined {
  for (const [key, value] of Object.entries(el.attrs)) {
    const colon = key.indexOf(':');
    const local = colon >= 0 ? key.slice(colon + 1) : key;
    if (local === localName) return value;
  }
  return undefined;
}

/** All text content beneath an element, in document order (text and child elements interleaved). */
export function textOf(el: XmlElement): string {
  let out = '';
  for (const part of el.parts) out += part.kind === 'text' ? part.value : textOf(part.el);
  return out;
}
