import { describe, expect, it } from 'vitest';
import { normalize } from './index.js';
import { ExportEngineError } from '../core/errors.js';
import type { PMDoc } from '../core/types.js';

const META = {
  formatId: 'report-writing.consort',
  documentTitle: 'Test doc',
  projectId: 'p1',
  generatedAt: '2026-01-01T00:00:00.000Z',
  sourceDocVersion: '1',
};

function doc(content: PMDoc['content']): PMDoc {
  return { type: 'doc', content };
}

describe('normalizer: base node types', () => {
  it('converts a paragraph', () => {
    const ir = normalize(doc([{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }]), { meta: META });
    expect(ir.blocks).toEqual([{ id: 'b_0001', type: 'paragraph', runs: [{ text: 'hello' }] }]);
  });

  it('converts headings 1 through 6', () => {
    const nodes = [1, 2, 3, 4, 5, 6].map((level) => ({
      type: 'heading',
      attrs: { level },
      content: [{ type: 'text', text: `h${level}` }],
    }));
    const ir = normalize(doc(nodes as PMDoc['content']), { meta: META });
    expect(ir.blocks.map((b) => b.level)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(ir.blocks.every((b) => b.type === 'heading')).toBe(true);
  });

  it('converts bullet and ordered lists, and preserves list items as blocks', () => {
    const ir = normalize(
      doc([
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] }],
        },
        {
          type: 'orderedList',
          content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }] }],
        },
      ]),
      { meta: META },
    );
    expect(ir.blocks[0]?.type).toBe('list');
    expect(ir.blocks[0]?.attrs?.listKind).toBe('bullet');
    expect(ir.blocks[1]?.attrs?.listKind).toBe('ordered');
  });

  it('converts tables with rows and cells', () => {
    const ir = normalize(
      doc([
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] }],
            },
          ],
        },
      ]),
      { meta: META },
    );
    expect(ir.blocks[0]?.type).toBe('table');
    expect(ir.blocks[0]?.children?.[0]?.type).toBe('tableRow');
    expect(ir.blocks[0]?.children?.[0]?.children?.[0]?.type).toBe('tableCell');
  });

  it('converts an image to a figure block', () => {
    const ir = normalize(doc([{ type: 'image', attrs: { src: 'data:image/png;base64,AA==', caption: 'cap' } }]), {
      meta: META,
    });
    expect(ir.blocks[0]).toMatchObject({ type: 'figure', runs: [{ text: 'cap' }] });
  });

  it('converts blockquote, codeBlock, horizontalRule, hardBreak', () => {
    const ir = normalize(
      doc([
        { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'q' }] }] },
        { type: 'codeBlock', content: [{ type: 'text', text: 'code' }] },
        { type: 'horizontalRule' },
        { type: 'hardBreak' },
      ]),
      { meta: META },
    );
    expect(ir.blocks.map((b) => b.type)).toEqual(['blockquote', 'codeBlock', 'horizontalRule', 'paragraph']);
  });
});

describe('normalizer: marks', () => {
  it('converts every base mark onto runs, including overlapping marks on one run', () => {
    const ir = normalize(
      doc([
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'x',
              marks: [
                { type: 'bold' },
                { type: 'italic' },
                { type: 'underline' },
                { type: 'strike' },
                { type: 'link', attrs: { href: 'https://example.org' } },
                { type: 'superscript' },
              ],
            },
          ],
        },
      ]),
      { meta: META },
    );
    expect(ir.blocks[0]?.runs?.[0]?.marks).toEqual([
      'bold',
      'italic',
      'underline',
      'strike',
      'link:https://example.org',
      'superscript',
    ]);
  });

  it('converts subscript separately from superscript', () => {
    const ir = normalize(
      doc([{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'subscript' }] }] }]),
      { meta: META },
    );
    expect(ir.blocks[0]?.runs?.[0]?.marks).toEqual(['subscript']);
  });
});

describe('normalizer: ids', () => {
  it('assigns a stable id to a node missing one, and preserves an existing id untouched', () => {
    const ir = normalize(
      doc([
        { type: 'paragraph', attrs: { id: 'custom-id' }, content: [{ type: 'text', text: 'a' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'b' }] },
      ]),
      { meta: META },
    );
    expect(ir.blocks[0]?.id).toBe('custom-id');
    expect(ir.blocks[1]?.id).toBe('b_0001');
  });
});

describe('normalizer: researchBlock routing', () => {
  it('routes a recognized blockKind to its registered plugin', () => {
    const ir = normalize(
      doc([
        {
          type: 'researchBlock',
          attrs: { blockKind: 'consortChecklistItem', checklistNo: '4a' },
          content: [{ type: 'text', text: 'item text' }],
        },
      ]),
      { meta: META },
    );
    expect(ir.blocks[0]?.type).toBe('checklistItem');
    expect(ir.blocks[0]?.attrs?.checklistNo).toBe('4a');
  });

  it('routes an unrecognized blockKind to the fallback rule instead of throwing', () => {
    const ir = normalize(
      doc([{ type: 'researchBlock', attrs: { blockKind: 'notAThing', text: 'fallback text' } }]),
      { meta: META, fallback: 'renderAsPlainParagraph' },
    );
    expect(ir.blocks[0]).toMatchObject({ type: 'paragraph', runs: [{ text: 'fallback text' }] });
  });

  it('honours fallback: error for an unrecognized blockKind', () => {
    expect(() =>
      normalize(doc([{ type: 'researchBlock', attrs: { blockKind: 'notAThing' } }]), {
        meta: META,
        fallback: 'error',
      }),
    ).toThrow(ExportEngineError);
  });

  it('honours fallback: skip for an unrecognized blockKind', () => {
    const ir = normalize(doc([{ type: 'researchBlock', attrs: { blockKind: 'notAThing' } }]), {
      meta: META,
      fallback: 'skip',
    });
    expect(ir.blocks).toEqual([]);
  });
});

describe('normalizer: nesting', () => {
  it('normalizes a list inside a table cell without data loss', () => {
    const ir = normalize(
      doc([
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [
                    {
                      type: 'bulletList',
                      content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'nested' }] }] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]),
      { meta: META },
    );
    const cell = ir.blocks[0]?.children?.[0]?.children?.[0];
    expect(cell?.children?.[0]?.type).toBe('list');
  });

  it('normalizes a table inside a list item without data loss', () => {
    const ir = normalize(
      doc([
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'table',
                  content: [
                    { type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] }] },
                  ],
                },
              ],
            },
          ],
        },
      ]),
      { meta: META },
    );
    expect(ir.blocks[0]?.children?.[0]?.children?.[0]?.type).toBe('table');
  });
});

describe('normalizer: edge cases', () => {
  it('normalizes an empty document to an empty blocks array, not an error', () => {
    const ir = normalize(doc([]), { meta: META });
    expect(ir.blocks).toEqual([]);
  });

  it('normalizes a doc with no content field at all', () => {
    const ir = normalize({ type: 'doc' }, { meta: META });
    expect(ir.blocks).toEqual([]);
  });

  it('raises a structured, specific error for malformed input (missing type)', () => {
    expect(() => normalize(doc([{} as never]), { meta: META })).toThrow(ExportEngineError);
    try {
      normalize(doc([{} as never]), { meta: META });
    } catch (err) {
      expect(ExportEngineError.is(err)).toBe(true);
      expect((err as ExportEngineError).code).toBe('MALFORMED_PROSEMIRROR');
    }
  });

  it('raises a structured error for wrong nesting (heading missing level)', () => {
    expect(() => normalize(doc([{ type: 'heading', content: [] } as never]), { meta: META })).toThrow(
      ExportEngineError,
    );
  });

  it('raises UNKNOWN_NODE_TYPE for a bespoke node type instead of a generic exception', () => {
    // Schema validation (on by default) already rejects an unrecognised node type as malformed
    // input; skipInputValidation exercises the normalizer's own defense-in-depth check for the
    // same case, which reports the more specific UNKNOWN_NODE_TYPE code.
    try {
      normalize(doc([{ type: 'consortFlowDiagramNode' } as never]), { meta: META, skipInputValidation: true });
      throw new Error('expected a throw');
    } catch (err) {
      expect(ExportEngineError.is(err)).toBe(true);
      expect((err as ExportEngineError).code).toBe('UNKNOWN_NODE_TYPE');
    }
  });

  it('schema validation rejects an unrecognised node type as malformed input by default', () => {
    try {
      normalize(doc([{ type: 'consortFlowDiagramNode' } as never]), { meta: META });
      throw new Error('expected a throw');
    } catch (err) {
      expect(ExportEngineError.is(err)).toBe(true);
      expect((err as ExportEngineError).code).toBe('MALFORMED_PROSEMIRROR');
    }
  });
});
