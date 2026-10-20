import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportInputBytes } from './export-input-bytes';

const original = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
afterEach(() => vi.restoreAllMocks());

describe('export input byte accounting', () => {
  it('does not materialize image bodies in the UTF-8 encoding buffer', () => {
    const image = 'data:image/jpeg;base64,' + 'A'.repeat(1024 * 1024);
    const value = { image, repeated: [image, image], title: '试卷' };
    const expected = original(value);
    const encode = vi.spyOn(TextEncoder.prototype, 'encode');
    expect(exportInputBytes(value)).toBe(expected);
    expect(Math.max(...encode.mock.calls.map(([text]) => text?.length ?? 0))).toBeLessThan(4096);
    expect(value.image).toBe(image);
  });
  it('keeps exact counts across Unicode, escaping and image-size boundaries', () => {
    const tails = ['', 'A', '=', '==', '\n', '\r\n', '\\', '"', '\u0000', '\u007f', 'é', '中', '😀', '\ud800', '\udfff', '\u2028'];
    for (const length of [0, 1, 4095, 4096, 4097, 32768]) for (const tail of tails) {
      const text = 'A'.repeat(length) + tail;
      const value = { text, nested: [text, null, undefined, false, 2.5], [tail]: text };
      expect(exportInputBytes(value)).toBe(original(value));
    }
  });
  it('retains standard JSON omission and conversion behavior', () => {
    const values: unknown[] = [undefined, null, NaN, Infinity, -0, true, { omitted: undefined }, [undefined, NaN, Infinity], new Uint8Array([1, 2]), new Date('2026-10-16T00:00:00Z'), { toJSON: () => 'A'.repeat(8192) }, Object.assign(Object.create(null), { image: 'A'.repeat(8192) })];
    for (const value of values) expect(exportInputBytes(value)).toBe(original(value));
    const cyclic: { self?: unknown } = {}; cyclic.self = cyclic;
    expect(() => exportInputBytes(cyclic)).toThrow(TypeError);
    expect(() => exportInputBytes(1n)).toThrow(TypeError);
  });
  it('counts shared string references repeatedly without mutating the input', () => {
    const row = Object.freeze({ image: 'x'.repeat(8192) });
    const input = Object.freeze({ rows: Object.freeze([row, row]) });
    expect(exportInputBytes(input)).toBe(original(input));
  });
  it('preserves the exact existing capacity decision', () => {
    const limit = 128 * 1024;
    for (const difference of [-1, 0, 1]) {
      const value = { image: 'A'.repeat(limit - original({ image: '' }) + difference) };
      expect(exportInputBytes(value)).toBe(limit + difference);
      expect(exportInputBytes(value) > limit).toBe(original(value) > limit);
    }
  });
  it('reuses an ASCII proof only within one calculation and still charges every occurrence', () => {
    const image = 'data:image/jpeg;base64,' + 'R'.repeat(8192);
    const value = { image, nested: [image, image] };
    const expected = original(value);
    const scan = vi.spyOn(RegExp.prototype, 'test');
    const counts = [exportInputBytes(value), exportInputBytes(value)];
    const scans = scan.mock.calls.filter(([text]) => text === image).length;
    scan.mockRestore();
    expect(counts).toEqual([expected, expected]);
    expect(scans).toBe(2);
  });
  it('bounds proof reuse while retaining exact counts beyond the cache', () => {
    const images = Array.from({ length: 70 }, (_, index) => `image-${index}:` + 'A'.repeat(8192));
    const value = { first: images, repeated: images };
    const expected = original(value);
    const scan = vi.spyOn(RegExp.prototype, 'test');
    const count = exportInputBytes(value);
    const calls = scan.mock.calls.map(([text]) => text);
    scan.mockRestore();
    expect(count).toBe(expected);
    expect(calls.filter(text => images.includes(text))).toHaveLength(76);
    expect(calls.filter(text => text === images[0])).toHaveLength(1);
    expect(calls.filter(text => text === images[64])).toHaveLength(2);
  });
  it('never reuses an ASCII proof for a changed Unicode or escaping suffix', () => {
    const safe = 'A'.repeat(8192);
    for (const tail of ['中', '😀', '\\', '"', '\n', '\ud800']) {
      const changed = safe.slice(0, -tail.length) + tail;
      const value = { first: safe, repeated: safe, changed, repeatedChanged: changed };
      expect(exportInputBytes(value)).toBe(original(value));
    }
  });
});
