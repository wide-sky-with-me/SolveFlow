import { describe, expect, it } from 'vitest';
import type { PrintImageAdjustment } from '@solveflow/contracts/local';
import { parsePrintNumberDrafts, printNumberText } from './print-number-drafts.js';

const base: PrintImageAdjustment = { rotation: 0, crop: { left: 0, top: 0, right: 1, bottom: 1 }, enhance: true };

describe('print adjustment number drafts', () => {
  it('parses signed and percent decimals without mutating the base', () => {
    const before = JSON.stringify(base), parsed = parsePrintNumberDrafts(base, { rotation: '-.75', left: '12.55' });
    expect(parsed.adjustment).toEqual({ ...base, rotation: -.75, crop: { ...base.crop, left: .1255 } });
    expect(parsed.error).toBe(''); expect(parsed.invalid).toEqual([]); expect(JSON.stringify(base)).toBe(before);
  });
  it.each(['', '-', '+', '.', '-.', '1e1', 'NaN', 'Infinity', 'abc'])('keeps incomplete or malformed input invalid: %j', text => {
    const parsed = parsePrintNumberDrafts(base, { rotation: text });
    expect(parsed.adjustment).toBeNull(); expect(parsed.invalid).toEqual(['rotation']); expect(parsed.error).toContain('-15°');
  });
  it.each([{ rotation: '16' }, { rotation: '-16' }, { left: '-1' }, { right: '101' }, { left: '97' }])('enforces shared numeric bounds: %j', drafts => {
    expect(parsePrintNumberDrafts(base, drafts).adjustment).toBeNull();
  });
  it('accepts complete numbers while preserving the untouched enhancement and perspective', () => {
    const value: PrintImageAdjustment = { ...base, enhance: false, perspective: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] };
    expect(parsePrintNumberDrafts(value, { rotation: '  -.75  ', left: '0.', right: '+100' }).adjustment).toEqual({ ...value, rotation: -.75 });
  });
  it('formats readable percentages without losing unedited stored precision', () => {
    const value = { ...base, crop: { left: .29, top: .012345678912, right: .923456789, bottom: 1 } };
    expect(printNumberText(value, 'left')).toBe('29'); expect(printNumberText(value, 'right')).toBe('92.345679');
    expect(parsePrintNumberDrafts(value, {}).adjustment).toEqual(value);
    expect(parsePrintNumberDrafts(value, { rotation: '-1' }).adjustment?.crop).toEqual(value.crop);
  });
});
