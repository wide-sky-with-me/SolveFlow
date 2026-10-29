import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it } from 'vitest';

const source = readFileSync(new URL('./print-image.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const crop: unknown = new Function('require', 'exports', `${compiled}\nreturn screenCrop;`)(() => ({}), {});
if (typeof crop !== 'function') throw new Error('CROP_MISSING');
const full = { left: 0, top: 0, right: 1, bottom: 1 };
function sample() {
  const width = 200, height = 160, data = new Uint8ClampedArray(width * height * 4);
  function fill(left: number, top: number, right: number, bottom: number, color: number) {
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) { const at = (y * width + x) * 4; data[at] = color; data[at + 1] = color; data[at + 2] = color; data[at + 3] = 255; }
  }
  fill(0, 0, width, height, 10); return { image: { width, height, data }, fill };
}
it('never crops to a larger neutral wall instead of the paper below the confirmed screen edge', () => {
  const f = sample(); f.fill(0, 0, 110, 160, 180); f.fill(118, 0, 200, 160, 245);
  expect(crop(f.image, 200, 160, 0, { x: 160, y: 10 })).toEqual(full);
});
it('trims a confirmed paper field with a generous margin and keeps labels at its edge', () => {
  const f = sample(); f.fill(20, 20, 180, 140, 245); f.fill(22, 22, 25, 25, 30);
  const result = crop(f.image, 200, 160, 0, { x: 100, y: 10 });
  expect(result.left).toBeGreaterThan(0); expect(result.top).toBeGreaterThan(0);
  expect(result.left * 200).toBeLessThan(20); expect(result.top * 160).toBeLessThan(20);
  expect(result.right * 200).toBeGreaterThan(180); expect(result.bottom * 160).toBeGreaterThan(140);
});
it('retains the complete photograph when the detected edge is not attached to the paper', () => {
  const f = sample(); f.fill(20, 20, 180, 140, 245);
  expect(crop(f.image, 200, 160, 0, { x: 5, y: 10 })).toEqual(full);
});
