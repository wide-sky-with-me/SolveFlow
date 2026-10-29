import { describe, expect, it } from 'vitest';
import { BatchPrintCopyRequestsSchema } from '@solveflow/contracts/local';
import { editPrintCopyDraft, editPrintCopyRemark, parsePrintCopyDrafts, printCopyInteger, type PrintCopyState } from './print-copy-drafts';

const initial = (): PrintCopyState => ({ requests: [{ correct: 25, incorrect: 2 }], drafts: {} });
const edit = (state: PrintCopyState, field: 'count' | number, text: string | null) => editPrintCopyDraft(state, field, text, 27, 2);

describe('bounded copy integer text', () => {
  it.each(['', '-', '+2', '.5', '1.5', '1e1', 'Infinity', 'NaN', '２', '999999999999999999999'])('retains invalid text instead of coercing %j', text => {
    expect(printCopyInteger(text, 1, 20)).toBeNull();
    const state = edit(initial(), 'count', text);
    expect(parsePrintCopyDrafts(state, 27, 2).invalidCount).toBe(true);
    expect(state.requests).toEqual(initial().requests);
  });
  it('accepts complete integers, whitespace and explicit zero only in the proper range', () => {
    expect(printCopyInteger(' 02 ', 1, 20)).toBe(2);
    expect(printCopyInteger('0', 0, 27)).toBe(0);
    for (const text of ['0', '21', '-1']) expect(printCopyInteger(text, 1, 20)).toBeNull();
  });
});

describe('copy quantity draft projection', () => {
  it('keeps an empty count while retaining the last valid plan', () => {
    const before = initial(); const state = edit(before, 'count', '');
    expect(state.drafts.count?.text).toBe(''); expect(state.requests).toEqual(before.requests);
    expect(parsePrintCopyDrafts(state, 27, 2).error).toContain('1 至 20');
    expect(edit(state, 'count', '5').requests).toHaveLength(5);
    expect(before).toEqual(initial());
  });
  it('keeps an empty or invalid wrong count without turning it into zero', () => {
    for (const text of ['', '28', '-1', '2.5']) {
      const state = edit(initial(), 0, text); const result = parsePrintCopyDrafts(state, 27, 2);
      expect(result.invalidIncorrect).toEqual([0]); expect(result.requests).toEqual(initial().requests);
      expect(result.error).toContain('第 1 份');
    }
    expect(edit(initial(), 0, '0').requests).toEqual([{ correct: 27, incorrect: 0 }]);
  });
  it('restores per-copy values through a smaller intermediate count and repeated edits', () => {
    let state = edit(initial(), 'count', '20'); state = edit(state, 9, '13'); state = edit(state, 19, '7');
    for (const text of ['', '1', '10', '2', '20']) state = edit(state, 'count', text);
    expect(state.requests[9]).toEqual({ correct: 14, incorrect: 13 });
    expect(state.requests[19]).toEqual({ correct: 20, incorrect: 7 });
    expect(BatchPrintCopyRequestsSchema.safeParse(state.requests).success).toBe(true);
  });
  it('retains a hidden invalid field and its last valid value until fixed or discarded', () => {
    let state = edit(initial(), 'count', '10'); state = edit(state, 9, '13'); state = edit(state, 9, '');
    state = edit(state, 'count', '1'); expect(parsePrintCopyDrafts(state, 27, 2).error).toBe('');
    state = edit(state, 'count', '10'); expect(parsePrintCopyDrafts(state, 27, 2).invalidIncorrect).toEqual([9]);
    expect(state.requests[9]?.incorrect).toBe(13);
    state = edit(state, 9, null); expect(state.requests[9]?.incorrect).toBe(13);
    expect(parsePrintCopyDrafts(state, 27, 2).error).toBe('');
  });
  it('discards a single field without altering another draft or its source state', () => {
    const state = edit(edit(initial(), 0, ''), 'count', '21'); const before = structuredClone(state);
    const next = edit(state, 'count', null); expect(next.drafts.count).toBeUndefined();
    expect(next.drafts.incorrect?.[0]?.text).toBe(''); expect(state).toEqual(before);
  });
  it('keeps every correct count derived from the total and uses the baseline for new rows', () => {
    let state = edit(initial(), 'count', '20');
    for (let index = 0; index < 20; index++) state = edit(state, index, String(index));
    expect(state.requests.map(value => value.correct + value.incorrect)).toEqual(Array(20).fill(27));
    expect(state.requests.map(value => value.incorrect)).toEqual(Array.from({ length: 20 }, (_, index) => index));
  });
  it('bounds text, rows and field keys without mutating the previous state', () => {
    const before = initial(); const state = edit(before, 'count', '9999999999');
    expect(state.drafts.count?.text).toHaveLength(8); expect(state.requests).toHaveLength(1);
    for (const field of [-1, .5, 20, 1000]) expect(edit(state, field, '1')).toBe(state);
    expect(before).toEqual(initial());
  });
});


it('preserves independent remarks through count edits and never changes error quantities', () => {
  let state = edit(initial(), 'count', '3');
  state = editPrintCopyRemark(state, 0, '甲组', 27, 2);
  state = editPrintCopyRemark(state, 2, '乙组', 27, 2);
  state = edit(state, 'count', '1'); state = edit(state, 0, '5'); state = edit(state, 'count', '3');
  expect(state.requests.map(row => row.remark)).toEqual(['甲组', undefined, '乙组']);
  expect(state.requests[0]).toEqual({ correct: 22, incorrect: 5, remark: '甲组' });
  const before = structuredClone(state);
  expect(editPrintCopyRemark(state, 0, 'x'.repeat(81), 27, 2).requests[0]?.remark).toHaveLength(80);
  expect(state).toEqual(before);
});
