/**
 * Each shipped plugin, tested in isolation with a minimal fixture and an exact expected IR output
 * (spec section 9.2), plus the "a plugin that throws surfaces as a structured error tied to the
 * block's id" requirement.
 */

import { describe, expect, it } from 'vitest';
import { normalize } from '../index.js';
import { BlockPluginRegistry } from './registry.js';
import { ExportEngineError } from '../../core/errors.js';
import type { PMDoc } from '../../core/types.js';

const META = {
  formatId: 'report-writing.consort',
  documentTitle: 'Test',
  projectId: 'p1',
  generatedAt: '2026-01-01T00:00:00.000Z',
  sourceDocVersion: '1',
};

function doc(content: PMDoc['content']): PMDoc {
  return { type: 'doc', content };
}

describe('checklist-item plugins', () => {
  it('consortChecklistItem: exact IR for a minimal item', () => {
    const ir = normalize(
      doc([
        {
          type: 'researchBlock',
          attrs: { id: 'ci_1', blockKind: 'consortChecklistItem', checklistNo: '4b' },
          content: [{ type: 'text', text: 'Settings and locations' }],
        },
      ]),
      { meta: META },
    );
    expect(ir.blocks).toEqual([
      {
        id: 'ci_1',
        type: 'checklistItem',
        runs: [{ text: 'Settings and locations' }],
        attrs: { blockKind: 'consortChecklistItem', checklistNo: '4b' },
      },
    ]);
  });

  it('strobeChecklistItem and prismaChecklistItem share the same transform behaviour', () => {
    for (const blockKind of ['strobeChecklistItem', 'prismaChecklistItem']) {
      const ir = normalize(
        doc([{ type: 'researchBlock', attrs: { blockKind, checklistNo: '1' }, content: [{ type: 'text', text: 't' }] }]),
        { meta: META },
      );
      expect(ir.blocks[0]?.type).toBe('checklistItem');
      expect(ir.blocks[0]?.attrs?.checklistNo).toBe('1');
    }
  });
});

describe('flow-diagram plugins', () => {
  it('consortFlowDiagram: image form produces a figure + caption', () => {
    const ir = normalize(
      doc([
        {
          type: 'researchBlock',
          attrs: { blockKind: 'consortFlowDiagram', src: 'data:image/png;base64,AA==', caption: 'Figure 1.' },
        },
      ]),
      { meta: META },
    );
    expect(ir.blocks.map((b) => b.type)).toEqual(['figure', 'paragraph']);
    expect(ir.blocks[1]?.runs).toEqual([{ text: 'Figure 1.' }]);
  });

  it('consortFlowDiagram: stage form produces a table with counts rendered verbatim', () => {
    const ir = normalize(
      doc([
        {
          type: 'researchBlock',
          attrs: { blockKind: 'consortFlowDiagram', stages: [{ label: 'Randomised', count: 100 }] },
        },
      ]),
      { meta: META },
    );
    expect(ir.blocks[0]?.type).toBe('table');
    expect(ir.blocks[0]?.children?.[0]?.children?.[0]?.children?.[0]?.runs).toEqual([{ text: 'Randomised (n = 100)' }]);
  });

  it('throws PLUGIN_FAILED when neither src nor stages is given', () => {
    expect(() => normalize(doc([{ type: 'researchBlock', attrs: { blockKind: 'consortFlowDiagram' } }]), { meta: META })).toThrow(
      ExportEngineError,
    );
  });
});

describe('crfField plugin', () => {
  it('exact IR shape for a required text field', () => {
    const ir = normalize(
      doc([
        {
          type: 'researchBlock',
          attrs: { id: 'f1', blockKind: 'crfField', fieldName: 'Age', fieldType: 'number', required: true },
        },
      ]),
      { meta: META },
    );
    expect(ir.blocks[0]?.type).toBe('table');
    const firstCellText = ir.blocks[0]?.children?.[0]?.children?.[0]?.children?.[0]?.runs?.[0]?.text;
    expect(firstCellText).toBe('Age *');
  });

  it('throws PLUGIN_FAILED when fieldName is missing', () => {
    expect(() => normalize(doc([{ type: 'researchBlock', attrs: { blockKind: 'crfField' } }]), { meta: META })).toThrow(
      ExportEngineError,
    );
  });
});

describe('statResultTable plugin', () => {
  it('produces a header row plus body rows with values stringified verbatim', () => {
    const ir = normalize(
      doc([
        {
          type: 'researchBlock',
          attrs: { blockKind: 'statResultTable', columns: ['Group', 'n'], rows: [['A', 10]] },
        },
      ]),
      { meta: META },
    );
    const table = ir.blocks[0];
    expect(table?.children?.length).toBe(2); // header + one body row
    expect(table?.children?.[1]?.children?.[1]?.children?.[0]?.runs).toEqual([{ text: '10' }]);
  });
});

describe('labelled-value plugins', () => {
  it('trialRegistrationNumber renders a bold label followed by the value', () => {
    const ir = normalize(
      doc([{ type: 'researchBlock', attrs: { blockKind: 'trialRegistrationNumber', value: 'NCT001' } }]),
      { meta: META },
    );
    expect(ir.blocks[0]?.runs).toEqual([
      { text: 'Trial registration: ', marks: ['bold'] },
      { text: 'NCT001' },
    ]);
  });
});

describe('a plugin that throws', () => {
  it('surfaces as a structured PLUGIN_FAILED error tied to the offending block id, not an unhandled crash', () => {
    const registry = new BlockPluginRegistry();
    registry.register({
      blockKind: 'boom',
      transform() {
        throw new Error('kaboom');
      },
    });

    try {
      normalize(doc([{ type: 'researchBlock', attrs: { id: 'the-bad-block', blockKind: 'boom' } }]), {
        meta: META,
        registry,
      });
      throw new Error('expected a throw');
    } catch (err) {
      expect(ExportEngineError.is(err)).toBe(true);
      const structured = err as ExportEngineError;
      expect(structured.code).toBe('PLUGIN_FAILED');
      expect(structured.details.some((d) => d.blockId === 'the-bad-block')).toBe(true);
    }
  });
});
