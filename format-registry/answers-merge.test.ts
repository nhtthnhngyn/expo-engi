import { describe, expect, it } from 'vitest';
import { mergeAnswersIntoSkeleton } from './answers-merge.js';
import type { DocumentAnswers, DocumentSkeleton } from '../core/types.js';

function skeleton(doc: DocumentSkeleton['doc']): DocumentSkeleton {
  return { formatId: 'demo-phase.demo-format', skeletonVersion: 'v1', doc };
}

describe('mergeAnswersIntoSkeleton', () => {
  it('fills an empty fillIn node with a plain-string answer as a single text run', () => {
    const s = skeleton({
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { fillIn: true, slotId: 'studentName' }, content: [] }],
    });
    const answers: DocumentAnswers = {
      formatId: 'demo-phase.demo-format',
      answers: { studentName: 'Nguyễn Văn A' },
    };
    const { doc, unfilledSlots, unmatchedAnswers } = mergeAnswersIntoSkeleton(s, answers);
    expect(doc.content![0]!.content).toEqual([{ type: 'text', text: 'Nguyễn Văn A' }]);
    expect(unfilledSlots).toEqual([]);
    expect(unmatchedAnswers).toEqual([]);
  });

  it('APPENDS answer content after existing fixed content rather than replacing it', () => {
    const s = skeleton({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { fillIn: true, slotId: 'abstractVn' },
          content: [{ type: 'text', text: 'Đặt vấn đề: ', marks: ['bold'] }],
        },
      ],
    });
    const answers: DocumentAnswers = {
      formatId: 'demo-phase.demo-format',
      answers: { abstractVn: 'Bệnh nhân X có tình trạng Y.' },
    };
    const { doc } = mergeAnswersIntoSkeleton(s, answers);
    expect(doc.content![0]!.content).toEqual([
      { type: 'text', text: 'Đặt vấn đề: ', marks: ['bold'] },
      { type: 'text', text: 'Bệnh nhân X có tình trạng Y.' },
    ]);
  });

  it('accepts a rich PMNode[] answer value alongside plain strings', () => {
    const s = skeleton({
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { fillIn: true, slotId: 'title' }, content: [] }],
    });
    const answers: DocumentAnswers = {
      formatId: 'demo-phase.demo-format',
      answers: { title: [{ type: 'text', text: 'Đề tài', marks: ['italic'] }] },
    };
    const { doc } = mergeAnswersIntoSkeleton(s, answers);
    expect(doc.content![0]!.content).toEqual([{ type: 'text', text: 'Đề tài', marks: ['italic'] }]);
  });

  it('leaves a slot with no matching answer unchanged and reports it as unfilled', () => {
    const s = skeleton({
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { fillIn: true, slotId: 'rationale' }, content: [] }],
    });
    const answers: DocumentAnswers = { formatId: 'demo-phase.demo-format', answers: {} };
    const { doc, unfilledSlots } = mergeAnswersIntoSkeleton(s, answers);
    expect(doc.content![0]!.content).toEqual([]);
    expect(unfilledSlots).toEqual(['rationale']);
  });

  it('reports an answer key with no matching slotId as unmatched, without throwing', () => {
    const s = skeleton({
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { fillIn: true, slotId: 'rationale' }, content: [] }],
    });
    const answers: DocumentAnswers = {
      formatId: 'demo-phase.demo-format',
      answers: { rationale: 'x', typoSlotId: 'y' },
    };
    const { unmatchedAnswers } = mergeAnswersIntoSkeleton(s, answers);
    expect(unmatchedAnswers).toEqual(['typoSlotId']);
  });

  it('finds slots nested arbitrarily deep and leaves locked nodes untouched', () => {
    const s = skeleton({
      type: 'doc',
      content: [
        {
          type: 'list',
          attrs: {},
          content: [
            {
              type: 'listItem',
              attrs: {},
              content: [
                { type: 'paragraph', attrs: { locked: true }, content: [{ type: 'text', text: 'Fixed label' }] },
                { type: 'paragraph', attrs: { fillIn: true, slotId: 'nested' }, content: [] },
              ],
            },
          ],
        },
      ],
    });
    const answers: DocumentAnswers = { formatId: 'demo-phase.demo-format', answers: { nested: 'deep value' } };
    const { doc } = mergeAnswersIntoSkeleton(s, answers);
    const listItem = doc.content![0]!.content![0]!;
    expect(listItem.content![0]!.content).toEqual([{ type: 'text', text: 'Fixed label' }]);
    expect(listItem.content![1]!.content).toEqual([{ type: 'text', text: 'deep value' }]);
  });

  it('throws when answers.formatId does not match the skeleton', () => {
    const s = skeleton({ type: 'doc', content: [] });
    const answers: DocumentAnswers = { formatId: 'other-phase.other-format', answers: {} };
    expect(() => mergeAnswersIntoSkeleton(s, answers)).toThrow(/formatId/);
  });

  it('does not mutate the original skeleton or answers objects', () => {
    const s = skeleton({
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { fillIn: true, slotId: 'x' }, content: [] }],
    });
    const answers: DocumentAnswers = { formatId: 'demo-phase.demo-format', answers: { x: 'value' } };
    const before = JSON.stringify(s);
    mergeAnswersIntoSkeleton(s, answers);
    expect(JSON.stringify(s)).toEqual(before);
  });

  it('leaves nodes with a slotId but no fillIn flag untouched, ignoring stray answers', () => {
    const s = skeleton({
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { slotId: 'notAFillIn' }, content: [{ type: 'text', text: 'kept' }] }],
    });
    const answers: DocumentAnswers = { formatId: 'demo-phase.demo-format', answers: { notAFillIn: 'ignored' } };
    const { doc, unmatchedAnswers } = mergeAnswersIntoSkeleton(s, answers);
    expect(doc.content![0]!.content).toEqual([{ type: 'text', text: 'kept' }]);
    expect(unmatchedAnswers).toEqual(['notAFillIn']);
  });
});
