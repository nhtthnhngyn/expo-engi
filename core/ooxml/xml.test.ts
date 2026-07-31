import { describe, expect, it } from 'vitest';
import { attr, escapeXml, findAll, findFirst, parseXml, textOf } from './xml.js';

describe('escapeXml', () => {
  it('escapes the five XML special characters', () => {
    expect(escapeXml(`<a & b "c" 'd'>`)).toBe('&lt;a &amp; b &quot;c&quot; &apos;d&apos;&gt;');
  });
});

describe('parseXml', () => {
  it('parses nested elements, attributes and text', () => {
    const root = parseXml('<root a="1"><child b="2">text</child></root>');
    const rootEl = root.children[0]!;
    expect(rootEl.local).toBe('root');
    expect(attr(rootEl, 'a')).toBe('1');
    const child = rootEl.children[0]!;
    expect(attr(child, 'b')).toBe('2');
    expect(child.text).toBe('text');
  });

  it('handles namespace prefixes, matching by local name', () => {
    const root = parseXml('<w:document xmlns:w="ns"><w:body/></w:document>');
    const doc = root.children[0]!;
    expect(doc.local).toBe('document');
    expect(findAll(root, 'body').length).toBe(1);
  });

  it('handles self-closing tags', () => {
    const root = parseXml('<a><b/><c/></a>');
    expect(root.children[0]!.children.length).toBe(2);
  });

  it('handles CDATA and comments', () => {
    const root = parseXml('<a><!-- comment --><b><![CDATA[<raw & text>]]></b></a>');
    const b = findFirst(root, 'b')!;
    expect(b.text).toBe('<raw & text>');
  });

  it('decodes entities in text and attributes', () => {
    const root = parseXml('<a x="1 &amp; 2">less &lt; more</a>');
    const a = root.children[0]!;
    expect(attr(a, 'x')).toBe('1 & 2');
    expect(a.text).toBe('less < more');
  });

  it('findAll performs a full depth-first search', () => {
    const root = parseXml('<a><b><c/></b><c/></a>');
    expect(findAll(root, 'c').length).toBe(2);
  });

  it('textOf concatenates all descendant text in document order', () => {
    const root = parseXml('<a>1<b>2</b>3</a>');
    expect(textOf(root.children[0]!)).toBe('123');
  });
});
