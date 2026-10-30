import { expect, it } from 'vitest';
import { planBatchPrintCopies, questionsForBatchPrint } from '@solveflow/client/presentation';
import { nativePdfFixture } from '../../../../tests/native-pdf-fixture';
import { nativePdfItems } from './native-pdf-input';

const snapshot = nativePdfFixture('data:image/jpeg;base64,AQID');
const copies = planBatchPrintCopies(questionsForBatchPrint(snapshot), [{ correct: 5, incorrect: 1, remark: 'first' }, { correct: 4, incorrect: 2, remark: 'second' }], [], 2345);
const input = { schemaVersion: 1, snapshot, mode: 'answers', markIncorrect: true, copies, exportedAt: snapshot.exportedAt };
it('keeps supplements, original text, table positions, copy-specific errors and bookmark anchors', () => {
  const { items, count } = nativePdfItems(input);
  expect(count).toBe(6); expect(items).toHaveLength(2);
  items.forEach((item, index) => {
    const images = item.blocks.filter(block => block.kind === 'image');
    expect(images).toHaveLength(7); expect(images.some(block => block.kind === 'image' && block.key.endsWith('000000000200'))).toBe(true);
    expect(item.blocks.filter(block => block.kind === 'text' && block.anchor)).toHaveLength(6);
    expect(item.blocks.filter(block => block.kind === 'text' && block.heading && block.incorrect)).toHaveLength(index + 1);
    expect(item.blocks[2]).toMatchObject({ kind: 'answer-table', entries: copies[index]?.answers.map(answer => ({ answer: String('ABCD'.indexOf(answer.selectedOptions?.[0] ?? '') + 1), incorrect: answer.incorrect })) });
    expect(item.name).toMatch(index === 0 ? /^first_\d{8}-\d{6}\.pdf$/ : /^second_\d{8}-\d{6}\.pdf$/);
  });
  expect(JSON.stringify(items)).toContain('Long original paragraph for pagination.');
});
it('pure questions omit all answers, answer tables and markings without mutating the snapshot', () => {
  const before = JSON.stringify(snapshot);
  const { items } = nativePdfItems({ ...input, mode: 'questions', markIncorrect: false, copies: [] });
  expect(JSON.stringify(items)).not.toContain('ANSWER_CANARY');
  expect(items[0]?.blocks.some(block => block.kind === 'answer-table')).toBe(false);
  expect(JSON.stringify(snapshot)).toBe(before);
});
it('rejects foreign copy plans and malformed requests before rendering', () => {
  expect(() => nativePdfItems({ ...input, mode: 'questions' })).toThrow();
  expect(() => nativePdfItems({ ...input, copies: copies.map(copy => ({ ...copy, answers: copy.answers.map(answer => ({ ...answer, recordId: snapshot.records[1]!.session.id })) })) })).toThrow('本批');
});
