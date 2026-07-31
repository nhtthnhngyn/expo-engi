import { describe, expect, it } from 'vitest';
import { checkIr, validateIr } from './index.js';
import { ExportEngineError } from '../core/errors.js';
import type { CanonicalIR } from '../core/types.js';

const META = {
  formatId: 'x.y',
  documentTitle: 't',
  projectId: 'p',
  generatedAt: '2026-01-01T00:00:00.000Z',
  sourceDocVersion: '1',
};

function ir(blocks: CanonicalIR['blocks']): CanonicalIR {
  return { meta: META, blocks };
}

describe('validator', () => {
  it('passes when all requiredBlocks are present', () => {
    const result = checkIr(ir([{ id: '1', type: 'customBlock', attrs: { blockKind: 'consortFlowDiagram' } }]), {
      requiredBlocks: ['consortFlowDiagram'],
    });
    expect(result.ok).toBe(true);
    expect(result.missingBlocks).toEqual([]);
  });

  it('fails with a structured error naming the exact missing block(s)', () => {
    expect(() =>
      validateIr(ir([{ id: '1', type: 'paragraph' }]), {
        formatId: 'x.y',
        requiredBlocks: ['consort-flow-diagram', 'trial-registration-number'],
      }),
    ).toThrow(ExportEngineError);

    try {
      validateIr(ir([{ id: '1', type: 'paragraph' }]), {
        formatId: 'x.y',
        requiredBlocks: ['consort-flow-diagram', 'trial-registration-number'],
      });
    } catch (err) {
      const structured = err as ExportEngineError;
      expect(structured.code).toBe('MISSING_REQUIRED_BLOCKS');
      const named = structured.details.map((d) => d.requiredBlock);
      expect(named).toEqual(['consort-flow-diagram', 'trial-registration-number']);
    }
  });

  it('fails on an IR that does not match the canonical IR schema shape', () => {
    const badIr = { meta: META, blocks: [{ id: '1' }] } as unknown as CanonicalIR; // missing `type`
    expect(() => validateIr(badIr, { formatId: 'x.y', requiredBlocks: [] })).toThrow(ExportEngineError);
    try {
      validateIr(badIr, { formatId: 'x.y', requiredBlocks: [] });
    } catch (err) {
      expect((err as ExportEngineError).code).toBe('IR_SCHEMA_INVALID');
    }
  });

  it('is additive-tolerant: passes an IR with extra, non-required blocks', () => {
    const result = checkIr(
      ir([
        { id: '1', type: 'paragraph', attrs: { blockKind: 'somethingExtra' } },
        { id: '2', type: 'paragraph', attrs: { blockKind: 'required-thing' } },
      ]),
      { requiredBlocks: ['required-thing'] },
    );
    expect(result.ok).toBe(true);
  });

  it('matches identifiers across camelCase blockKind and kebab-case requiredBlocks entries', () => {
    const result = checkIr(ir([{ id: '1', type: 'paragraph', attrs: { blockKind: 'consortFlowDiagram' } }]), {
      requiredBlocks: ['consort-flow-diagram'],
    });
    expect(result.ok).toBe(true);
  });

  it('finds required identifiers nested inside children', () => {
    const result = checkIr(
      ir([{ id: '1', type: 'list', children: [{ id: '2', type: 'listItem', attrs: { sectionId: 'deep-section' } }] }]),
      { requiredBlocks: ['deep-section'] },
    );
    expect(result.ok).toBe(true);
  });
});
