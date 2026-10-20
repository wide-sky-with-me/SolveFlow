import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const questionKey = 'record/single';
function fixture(cache: unknown = null) {
  let calls = 0; let crops = 0; let sourceReads = 0; const cropFrom: string[] = [];
  const source = readFileSync(new URL('./prepare-batch-export.web.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const dependencies: Record<string, object> = {
    '@solveflow/contracts/local': { MAX_BATCH_PRINT_LAYOUT_SOURCES: 8, MAX_BATCH_PRINT_BYTES: 128 * 1024 * 1024, parseBatchPrintLayout: (value: unknown) => { if (value && typeof value === 'object' && 'badRelation' in value) throw new Error('遗漏题目或引用未知图片'); return value; } },
    '@solveflow/contracts/http': { isAuxiliaryContext: () => false },
    '@solveflow/client/learning': { questionConversations: (runs: unknown) => [{ key: 'single', runs }] },
    '../dom/batch-print-document': { recordPrintImages: () => { sourceReads++; return [{ id: 'primary', image: 'original' }, { id: 'supplement', image: 'extra' }]; }, printImageKey: (record: string, id: string) => `${record}/${id}` },
    './batch-print-presentation.web': { fallbackPrintLayout: () => ({ problem: { text: 'saved question' }, assets: [{ key: 'record/primary', sourceId: 'primary', role: 'source' }, { key: 'record/supplement', sourceId: 'supplement', role: 'source' }], warnings: [] }) },
    './batch-print-cache.web': { printLayoutCacheKey: async () => 'cache-key', readPrintLayoutCache: async () => cache },
    './print-image': { prepareOriginalPrintRegion: async (image: string) => { crops++; cropFrom.push(image); return { image: 'saved-crop' }; } },
  };
  const prepare: unknown = new Function('require', 'exports', `${compiled}\nreturn exports.prepareBatchExport;`)((name: string) => dependencies[name] ?? {}, {});
  if (typeof prepare !== 'function') throw new Error('PREPARE_MISSING');
  const runtime = { analyzePrintLayout: async () => { calls++; throw new Error('MODEL_NOT_ALLOWED'); } };
  const snapshot = { records: [{ session: { id: 'record', upload: { id: 'primary' }, runs: [{ outcome: { status: 'completed' }, imageIds: ['primary'] }] }, image: 'original' }] };
  const questions = [{ key: questionKey, ordinal: 1, recordId: 'record', problem: { text: 'saved question' } }];
  return { prepare, runtime, snapshot, questions, dependencies, cropFrom, calls: () => calls, crops: () => crops, sourceReads: () => sourceReads };
}
const illustration = { id: 'diagram', alt: 'diagram', x: .2, y: .2, width: .3, height: .3 };

describe('saved-content PDF preparation', () => {
  it('exports saved answers and original diagrams on a cache miss without any model request', async () => {
    const f = fixture();
    const prepared = await f.prepare(f.runtime, f.snapshot, f.questions, 'saved', new AbortController().signal, () => {});
    expect(f.calls()).toBe(0); expect(prepared.layouts[questionKey].assets).toHaveLength(2);
    expect(prepared.images).toEqual({ 'record/primary': 'original', 'record/supplement': 'extra' });
  });
  it('only the explicit clean policy can start a new model request', async () => {
    const f = fixture(); await expect(f.prepare(f.runtime, f.snapshot, f.questions, 'clean', new AbortController().signal, () => {})).rejects.toThrow('MODEL_NOT_ALLOWED'); expect(f.calls()).toBe(1);
  });
  it('reuses saved crop coordinates and preserves unassigned supplemental sources', async () => {
    const f = fixture();
    const questions = [{ ...f.questions[0], problem: { text: 'saved', illustrations: [illustration] } }];
    const prepared = await f.prepare(f.runtime, f.snapshot, questions, 'saved', new AbortController().signal, () => {});
    expect(f.crops()).toBe(1); expect(f.calls()).toBe(0);
    expect(prepared.layouts[questionKey].assets.map((asset: { role: string }) => asset.role)).toEqual(['question', 'source']);
  });
  it('checks cancellation before inspecting or changing any source', async () => {
    const f = fixture(); const controller = new AbortController(); controller.abort();
    await expect(f.prepare(f.runtime, f.snapshot, f.questions, 'saved', controller.signal, () => {})).rejects.toThrow(); expect(f.calls()).toBe(0); expect(f.crops()).toBe(0); expect(f.sourceReads()).toBe(0);
  });
  it.each(['saved', 'clean', 'paper'])('preserves pre-cancellation before reading the prepared seed in %s mode', async policy => {
    const f = fixture(); const controller = new AbortController(); const reason = new Error('CANCELLED_BEFORE_SOURCE'); controller.abort(reason);
    let seedReads = 0; let progressCalls = 0;
    const seed = { get images() { seedReads++; throw new Error('SEED_READ_AFTER_CANCEL'); } };
    await expect(f.prepare(f.runtime, f.snapshot, f.questions, policy, controller.signal, () => { progressCalls++; }, seed)).rejects.toBe(reason);
    expect(seedReads).toBe(0); expect(f.sourceReads()).toBe(0); expect(progressCalls).toBe(0); expect(f.calls()).toBe(0); expect(f.crops()).toBe(0);
  });
  it('crops the latest saved run source rather than the obsolete primary image after replacement', async () => {
    const f = fixture(); const run = f.snapshot.records[0]?.session.runs[0];
    if (!run) throw new Error('FIXTURE_RUN'); run.imageIds = ['supplement'];
    await f.prepare(f.runtime, f.snapshot, [{ key: questionKey, recordId: 'record', problem: { text: 'saved', illustrations: [illustration] } }], 'saved', new AbortController().signal, () => {});
    expect(f.cropFrom).toEqual(['extra']); expect(f.calls()).toBe(0);
  });
  it('discards a structurally valid but unrelated cache and keeps saved source images', async () => {
    const f = fixture({ proposal: { badRelation: true }, images: {} });
    const prepared = await f.prepare(f.runtime, f.snapshot, f.questions, 'saved', new AbortController().signal, () => {});
    expect(prepared.layouts[questionKey].assets).toHaveLength(2); expect(f.calls()).toBe(0);
  });
  it('treats a cache-key failure as an optional optimization, not a prerequisite', async () => {
    const f = fixture(); const dependency = f.dependencies['./batch-print-cache.web']; if (!dependency) throw new Error('FIXTURE_DEPENDENCY'); Object.assign(dependency, { printLayoutCacheKey: async () => { throw new Error('CACHE_KEY'); } });
    const prepared = await f.prepare(f.runtime, f.snapshot, f.questions, 'saved', new AbortController().signal, () => {});
    expect(prepared.layouts[questionKey].assets).toHaveLength(2); expect(f.calls()).toBe(0);
  });
});
