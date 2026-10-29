import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { PrintImageAdjustmentSchema, type PrintImageAdjustment } from '@solveflow/contracts/local';

const automatic: PrintImageAdjustment = { rotation: 22, crop: { left: .1, top: .1, right: .9, bottom: .9 }, enhance: true };
function fixture() {
  const calls: Array<{ source: string; adjustment: PrintImageAdjustment }> = []; let detections = 0;
  let gate: (() => void) | undefined;
  const dependencies: Record<string, object> = {
    '@solveflow/contracts/local': { MAX_BATCH_PRINT_BYTES: 10000, PrintImageAdjustmentSchema },
    '../dom/batch-print-document': { recordPrintImages: () => [{ id: 'photo', image: 'raw-photo' }], printImageKey: () => 'record/photo' },
    './print-image': { detectPrintAdjustment: async () => { detections++; return automatic; }, preparePrintImage: async (source: string, adjustment: PrintImageAdjustment) => { calls.push({ source, adjustment }); gate?.(); return `processed-${source}`; } },
  };
  const compiled = ts.transpileModule(readFileSync(new URL('./prepare-export-images.web.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const run: unknown = new Function('require', 'exports', `${compiled}\nreturn exports.prepareExportImages;`)((key: string) => dependencies[key] ?? {}, {});
  if (typeof run !== 'function') throw new Error('PROCESSOR');
  const content = { layouts: { q: { assets: [{ key: 'record/photo' }, { key: 'record/crop' }] } }, images: { 'record/photo': 'old-photo', 'record/crop': 'old-crop' }, sources: [{ key: 'record/crop', image: 'raw-crop', region: true }], adjustments: {} };
  return { calls, content, detected: () => detections, gate(value: () => void) { gate = value; }, run: (value: unknown = content, signal = new AbortController().signal, reset = false) => run({ records: [{ session: { id: 'record' } }] }, value, signal, () => {}, reset) };
}
it('processes each distinct active original once and shares immutable results between every copy', async () => {
  const f = fixture(), before = JSON.stringify(f.content); const result = await f.run();
  expect(f.calls.map(call => call.source)).toEqual(['raw-photo', 'raw-crop']);
  expect(result.images).toEqual({ 'record/photo': 'processed-raw-photo', 'record/crop': 'processed-raw-crop' });
  expect(JSON.stringify(f.content)).toBe(before);
  await f.run(result); expect(f.calls).toHaveLength(2);
  await f.run({ ...result, images: { ...result.images, 'record/photo': 'changed-pixels' } });
  expect(f.calls).toHaveLength(3); expect(f.calls[2]?.source).toBe('raw-photo');
});
it('retains explicit geometry and restored originals while refreshing enhancement from raw crops', async () => {
  const f = fixture(); const manual = { ...automatic, rotation: -12, perspective: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] };
  const result = await f.run({ ...f.content, adjustments: { 'record/photo': { ...automatic, enhance: false }, 'record/crop': manual } });
  expect(f.detected()).toBe(0); expect(f.calls).toEqual([{ source: 'raw-crop', adjustment: manual }]);
  expect(result.images['record/photo']).toBe('old-photo');
});
it('reuses identical source pixels and parameters across different question keys', async () => {
  const f = fixture();
  await f.run({ ...f.content, sources: [{ key: 'record/crop', image: 'raw-photo', region: true }] });
  expect(f.detected()).toBe(1); expect(f.calls).toHaveLength(1);
});
it('re-estimates geometry only on an explicit batch reset and retains applied perspective', async () => {
  const f = fixture(); const existing = { ...automatic, rotation: 15 };
  await f.run({ ...f.content, adjustments: { 'record/photo': existing } }, new AbortController().signal, true);
  expect(f.detected()).toBe(2); expect(f.calls[0]?.adjustment.rotation).toBe(22);
  const protectedFixture = fixture(); const perspective = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  await protectedFixture.run({ ...protectedFixture.content, adjustments: { 'record/photo': { ...existing, perspective } } }, new AbortController().signal, true);
  expect(protectedFixture.calls[0]?.adjustment.perspective).toEqual(perspective);
  expect(protectedFixture.calls[0]?.adjustment.rotation).toBe(15);
  expect(protectedFixture.detected()).toBe(1);
});
it('does not decode unused sources or discard an already prepared crop whose raw source is unavailable', async () => {
  const f = fixture(); const result = await f.run({ ...f.content, layouts: { q: { assets: [{ key: 'unknown' }] } }, images: { unknown: 'prepared' } });
  expect(f.calls).toEqual([]); expect(result.images.unknown).toBe('prepared');
});
it('honors cancellation before reading input and after pixel processing without committing late results', async () => {
  const f = fixture(), controller = new AbortController(); controller.abort();
  await expect(f.run({ get images() { throw new Error('READ_AFTER_CANCEL'); } }, controller.signal)).rejects.toThrow(); expect(f.calls).toEqual([]);
  const active = new AbortController(); f.gate(() => active.abort()); const before = JSON.stringify(f.content);
  await expect(f.run(f.content, active.signal)).rejects.toThrow(); expect(JSON.stringify(f.content)).toBe(before);
});
