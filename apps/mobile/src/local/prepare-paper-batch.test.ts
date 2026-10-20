import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import * as contracts from '@solveflow/contracts/local';

function fixture() {
  const ids = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002']; const jpeg = 'data:image/jpeg;base64,AQID';
  const snapshot = { records: ids.map(id => ({ session: { id, upload: { id } }, image: jpeg })) };
  const questions = ids.map((id, index) => ({ key: `${id}/single`, recordId: id, ordinal: index + 1, problem: { text: `Question ${index + 1}`, subject: 'math', uncertainties: [] } }));
  let state = { layouts: Object.fromEntries(questions.map(question => [question.key, { problem: question.problem, assets: [{ key: `${question.recordId}/${question.recordId}`, sourceId: question.recordId, role: 'source', alt: 'Source' }], warnings: [] }])), images: Object.fromEntries(ids.map(id => [`${id}/${id}`, jpeg])), sources: ids.map(id => ({ key: `${id}/${id}`, image: jpeg, label: 'Source' })), adjustments: {} };
  let calls = 0; let processing = 0; let fault = false; let gate: (() => Promise<void>) | undefined; const cache = new Map<string, unknown>(); const dirty = new Set<string>();
  const dependencies: Record<string, object> = {
    '@solveflow/contracts/local': { ...contracts, MAX_BATCH_PRINT_BYTES: 300 },
    '../dom/batch-print-document': { recordPrintImages: (record: { session: { id: string }; image: string }) => [{ id: record.session.id, image: record.image }] },
    './batch-print-cache.web': { preparedPrintCacheKey: async (input: unknown) => JSON.stringify(input), readPreparedPrintCache: async (key: string) => cache.get(key) ?? null, writePreparedPrintCache: async (key: string, value: unknown, signal: AbortSignal) => { signal.throwIfAborted(); if (fault) throw new Error('QUOTA'); cache.set(key, value); }, printLayoutCacheKey: async () => 'legacy', readPrintLayoutCache: async () => null },
    './batch-print-presentation.web': { preparePrintLayout: async (proposed: contracts.PrintLayoutQuestion, question: { recordId: string }, _record: unknown, images: Record<string, string>, signal: AbortSignal) => { signal.throwIfAborted(); processing++; const key = `${question.recordId}/chart`; const hasFigure = proposed.problem.text.includes('2'); return { layout: { problem: proposed.problem, assets: hasFigure ? [{ key, sourceId: question.recordId, role: 'question', alt: 'Chart' }] : [], warnings: [] }, images: { ...images, ...(hasFigure ? { [key]: jpeg } : {}) }, sources: hasFigure ? [{ key, image: jpeg, label: 'Original crop', region: true }] : [], adjustments: {} }; } },
  };
  const compiled = ts.transpileModule(readFileSync(new URL('./prepare-paper-batch.web.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const moduleValue: unknown = new Function('require', 'exports', `${compiled}\nreturn exports;`)((name: string) => dependencies[name] ?? {}, {});
  if (!moduleValue || typeof moduleValue !== 'object' || !('preparePaperBatch' in moduleValue) || typeof moduleValue.preparePaperBatch !== 'function' || !('restorePaperBatch' in moduleValue) || typeof moduleValue.restorePaperBatch !== 'function' || !('savePaperRecord' in moduleValue) || typeof moduleValue.savePaperRecord !== 'function') throw new Error('PREPARE_EXPORTS');
  const runtime = { analyzePrintLayout: async (input: contracts.BatchPrintLayoutInput, signal: AbortSignal) => { calls++; await gate?.(); signal.throwIfAborted(); return { schemaVersion: 1, questions: input.questions.map(question => ({ ...question, confidence: 1, warnings: [], sources: input.sources.map(source => ({ id: source.id, kind: question.problem?.text.includes('2') ? 'illustrations' : 'text-only', rotation: 0, regions: question.problem?.text.includes('2') ? [{ id: 'chart', alt: 'Chart', role: 'question', x: .2, y: .2, width: .4, height: .4 }] : [] })) })) }; } };
  const prepare = moduleValue.preparePaperBatch; const restore = moduleValue.restorePaperBatch; const save = moduleValue.savePaperRecord;
  return { snapshot, questions, cache, dirty, dependencies, state: () => state, calls: () => calls, processing: () => processing, failSave(value: boolean) { fault = value; }, gate(value: () => Promise<void>) { gate = value; },
    async run(signal = new AbortController().signal, force = false) { await prepare(runtime, snapshot, questions, state, force, signal, () => {}, (value: typeof state) => { state = value; }, (id: string, saved: boolean) => { if (saved) dirty.delete(id); else dirty.add(id); }); },
    restore: async () => restore(snapshot, questions, new AbortController().signal, state), save: async () => save(snapshot.records[0], questions, state, new AbortController().signal),
  };
}
describe('one-time paper preparation and reuse', () => {
  it('persists text-only decisions, figures and editable source crops once; repeated preparation does no work', async () => {
    const f = fixture(); await f.run(); expect(f.calls()).toBe(2); expect(f.processing()).toBe(2); expect(f.cache.size).toBe(2); expect(f.dirty.size).toBe(0);
    await f.run(); await f.restore(); expect(f.calls()).toBe(2); expect(f.processing()).toBe(2);
    expect(f.state().layouts[f.questions[0]?.key ?? '']?.assets).toHaveLength(0); expect(f.state().sources).toHaveLength(3);
  });
  it('reclaims superseded crops without dropping active figures or original sources', async () => {
    const f = fixture(); await f.run(); const staleKey = `${f.questions[1]!.key}/old-chart`;
    f.state().images[staleKey] = 'data:image/jpeg;base64,BAUG';
    f.state().sources.push(Object.assign({ key: staleKey, image: 'data:image/jpeg;base64,BAUG', label: 'Old crop' }, { region: true }));
    Object.assign(f.state().adjustments, { [staleKey]: { crop: { x: 0, y: 0, width: 1, height: 1 }, rotation: 0, enhance: true } });
    await f.run(new AbortController().signal, true);
    expect(f.state().images[staleKey]).toBeUndefined(); expect(f.state().sources.some(source => source.key === staleKey)).toBe(false);
    expect(Object.keys(f.state().adjustments)).not.toContain(staleKey);
    expect(f.state().sources).toHaveLength(3); expect(f.state().layouts[f.questions[1]!.key]?.assets).toHaveLength(1);
    for (const question of f.questions) expect(f.state().images[`${question.recordId}/${question.recordId}`]).toBeDefined();
    expect(f.calls()).toBe(4); expect(f.cache.size).toBe(2);
  });
  it('retries a storage fault without replaying extraction or image processing', async () => {
    const f = fixture(); f.failSave(true); await expect(f.run()).rejects.toThrow('尚未保存'); expect(f.calls()).toBe(1); expect(f.dirty.size).toBe(1); expect(f.cache.size).toBe(0);
    f.failSave(false); await f.save(); expect(f.calls()).toBe(1); expect(f.processing()).toBe(1); expect(f.cache.size).toBe(1);
    await f.run(); expect(f.calls()).toBe(2); expect(f.processing()).toBe(2);
  });
  it('cancellation prevents late responses from being processed or persisted', async () => {
    const f = fixture(); const controller = new AbortController(); let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; }); f.gate(() => gate);
    const pending = f.run(controller.signal); await Promise.resolve(); await Promise.resolve(); controller.abort(); release(); await expect(pending).rejects.toThrow(); expect(f.processing()).toBe(0); expect(f.cache.size).toBe(0);
  });
  it('cache read failure stops explicit processing rather than charging again blindly', async () => {
    const f = fixture(); Object.assign(f.dependencies['./batch-print-cache.web'] ?? {}, { readPreparedPrintCache: async () => { throw new Error('READ_FAILURE'); } });
    await expect(f.run()).rejects.toThrow('READ_FAILURE'); expect(f.calls()).toBe(0); expect(f.processing()).toBe(0);
  });
  it('rejects a cached foreign record without dropping original source images', async () => {
    const f = fixture(); Object.assign(f.dependencies['./batch-print-cache.web'] ?? {}, { readPreparedPrintCache: async () => ({ schemaVersion: 1, layouts: {}, images: {}, sources: [], adjustments: {} }) });
    await expect(f.restore()).rejects.toThrow(); expect(f.state().sources).toHaveLength(2); expect(f.calls()).toBe(0);
  });
});
