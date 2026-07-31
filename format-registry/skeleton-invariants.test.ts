import { describe, expect, it } from 'vitest';
import { checkSkeletonInvariants } from './skeleton-invariants.js';

describe('checkSkeletonInvariants', () => {
  it('reports no violations for a doc where every marker is exactly one of locked/fillIn', () => {
    const doc = {
      content: [
        { type: 'heading', attrs: { locked: true }, content: [] },
        { type: 'paragraph', attrs: { fillIn: true }, content: [] },
        { type: 'paragraph', attrs: {}, content: [] },
      ],
    };
    expect(checkSkeletonInvariants(doc)).toEqual([]);
  });

  it('flags a node marked both locked and fillIn', () => {
    const doc = {
      content: [{ type: 'paragraph', attrs: { locked: true, fillIn: true }, content: [] }],
    };
    const violations = checkSkeletonInvariants(doc);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.message).toMatch(/both locked and fillIn/);
  });

  it('finds a violation nested arbitrarily deep in the tree', () => {
    const doc = {
      content: [
        {
          type: 'list',
          attrs: {},
          content: [
            {
              type: 'listItem',
              attrs: {},
              content: [{ type: 'paragraph', attrs: { locked: true, fillIn: true }, content: [] }],
            },
          ],
        },
      ],
    };
    expect(checkSkeletonInvariants(doc)).toHaveLength(1);
  });

  it('reports one violation per offending node, not just the first', () => {
    const doc = {
      content: [
        { type: 'paragraph', attrs: { locked: true, fillIn: true }, content: [] },
        { type: 'paragraph', attrs: { locked: true, fillIn: true }, content: [] },
      ],
    };
    expect(checkSkeletonInvariants(doc)).toHaveLength(2);
  });

  it('treats a doc with no content as having no violations', () => {
    expect(checkSkeletonInvariants({})).toEqual([]);
  });
});
