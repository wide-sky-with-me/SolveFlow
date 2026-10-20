import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import * as contracts from '@solveflow/contracts/local';
import type { PaperPreparationState } from './prepare-paper-batch.web';

function fixture(enhance = false) {
  const id = '10000000-0000-4000-8000-000000000001', jpeg = 'data:image/jpeg;base64,AQID', derived = 'data:image/jpeg;base64,BAUG';
  const key = `${id}/single`, assetKey = `${key}/${id}/chart`, originalKey = `${id}/${id}`;
  const snapshot = { records: [{ session: { id, upload: { id } }, image: jpeg }] };
  const questions = [{ key, recordId: id, ordinal: 1, problem: { text: 'Question', subject: 'math', uncertainties: [] } }];
  const state: PaperPreparationState = { layouts: { [key]: { problem: { text: 'Question', subject: 'math', uncertainties: [] }, warnings: [], assets: [{ key: assetKey, sourceId: id, role: 'question', alt: 'Chart' }] } }, images: { [assetKey]: derived, [originalKey]: jpeg }, sources: [{ key: originalKey, image: jpeg, label: 'Original' }, { key: assetKey, image: jpeg, label: 'Crop', region: true }], adjustments: { [assetKey]: { rotation: 0, crop: { left: 0, top: 0, right: 1, bottom: 1 }, enhance: true } } };
  const before = JSON.stringify(state); const detections: string[] = [], rendered: string[] = [], renderedAdjustments: contracts.PrintImageAdjustment[] = [], writes: contracts.PreparedPrintRecord[] = [], commits: PaperPreparationState[] = [], dirty = new Set<string>();
  let angle = 8, fault = false, unchanged = false; let gate: (() => Promise<void>) | undefined;
  const dependencies: Record<string, object> = {
    '@solveflow/contracts/local': contracts,
    '../dom/batch-print-document': { recordPrintImages: () => [{ id, image: jpeg }], printImageKey: (recordId: string, sourceId: string) => `${recordId}/${sourceId}` },
    './print-image': { detectPrintAdjustment: async (uri: string) => { detections.push(uri); await gate?.(); return { rotation: angle, crop: { left: 0, top: 0, right: 1, bottom: 1 }, enhance: true }; }, preparePrintImage: async (uri: string, adjustment: contracts.PrintImageAdjustment) => { rendered.push(uri); renderedAdjustments.push(structuredClone(adjustment)); await gate?.(); return unchanged ? derived : 'data:image/jpeg;base64,BwgJ'; } },
    './batch-print-cache.web': { preparedPrintCacheKey: async () => 'prepared', writePreparedPrintCache: async (_key: string, value: contracts.PreparedPrintRecord) => { if (fault) throw new Error('QUOTA'); writes.push(value); } },
  };
  const compiled = ts.transpileModule(readFileSync(new URL('./prepare-paper-batch.web.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module: unknown = new Function('require', 'exports', `${compiled}\nreturn exports;`)((name: string) => dependencies[name] ?? {}, {});
  const name = enhance ? 'enhancePaperBatch' : 'straightenPaperBatch';
  const run: unknown = module && typeof module === 'object' ? Reflect.get(module, name) : undefined;
  if (typeof run !== 'function') throw new Error('PAPER_UPGRADE_EXPORT');
  return { state, assetKey, originalKey, before, detections, rendered, renderedAdjustments, writes, commits, dirty, setUnchanged() { unchanged = true; }, setAngle(value: number) { angle = value; }, failSave() { fault = true; }, gate(value: () => Promise<void>) { gate = value; },
    run: (signal = new AbortController().signal) => run(snapshot, questions, state, signal, () => {}, (next: PaperPreparationState) => commits.push({ ...next, images: { ...next.images }, adjustments: { ...next.adjustments } }), (recordId: string, saved: boolean) => { if (saved) dirty.delete(recordId); else dirty.add(recordId); }),
  };
}
describe('explicit local-only straightening of prepared paper', () => {
  it('re-renders from the unrotated crop, commits before saving and leaves the original state untouched', async () => {
    const f = fixture(); expect(await f.run()).toBe(1); expect(f.detections).toEqual(['data:image/jpeg;base64,AQID']); expect(f.rendered).toEqual(f.detections);
    expect(f.commits[0]?.adjustments[f.assetKey]?.rotation).toBe(8); expect(f.writes[0]?.adjustments[f.assetKey]?.rotation).toBe(8); expect(f.dirty.size).toBe(0); expect(JSON.stringify(f.state)).toBe(f.before);
  });
  it.each(['rotation', 'crop', 'perspective', 'restored', 'retired'])('preserves an existing %s decision without decoding or rewriting it', async cause => {
    const f = fixture(), value = f.state.adjustments[f.assetKey]; if (!value) throw new Error('ADJUSTMENT');
    if (cause === 'rotation') value.rotation = 4;
    if (cause === 'crop') value.crop.left = .1;
    if (cause === 'perspective') value.perspective = [{ x: .1, y: .1 }, { x: .9, y: .15 }, { x: .85, y: .9 }, { x: .1, y: .85 }];
    if (cause === 'restored') value.enhance = false;
    if (cause === 'retired') { const layout = Object.values(f.state.layouts)[0]; if (layout) layout.assets = []; }
    expect(await f.run()).toBe(0); expect(f.detections).toHaveLength(0); expect(f.rendered).toHaveLength(0); expect(f.writes).toHaveLength(0);
  });
  it('leaves an unconfirmed angle unchanged rather than inventing a correction', async () => {
    const f = fixture(); f.setAngle(0); expect(await f.run()).toBe(0); expect(f.rendered).toHaveLength(0); expect(f.writes).toHaveLength(0); expect(JSON.stringify(f.state)).toBe(f.before);
  });
  it('keeps the corrected pixels and dirty marker when persistence fails', async () => {
    const f = fixture(); f.failSave(); await expect(f.run()).rejects.toThrow('摆正结果尚未保存'); expect(f.commits[0]?.adjustments[f.assetKey]?.rotation).toBe(8); expect(f.dirty.size).toBe(1); expect(f.rendered).toHaveLength(1); expect(f.writes).toHaveLength(0);
  });
  it('ignores late detection after cancellation and never commits or persists it', async () => {
    const f = fixture(); let release = () => {}; f.gate(() => new Promise<void>(resolve => { release = resolve; }));
    const controller = new AbortController(), pending = f.run(controller.signal); await Promise.resolve(); controller.abort(); release(); await expect(pending).rejects.toThrow(); expect(f.rendered).toHaveLength(0); expect(f.commits).toHaveLength(0); expect(f.writes).toHaveLength(0);
  });
});

describe('explicit local-only enhancement of saved paper', () => {
  it('uses the raw crop and retains manual rotation, crop, layouts and original state', async () => {
    const f = fixture(true); const adjustment = f.state.adjustments[f.assetKey]; if (!adjustment) throw new Error('ADJUSTMENT');
    adjustment.rotation = 9; adjustment.crop = { left: .1, top: .2, right: .9, bottom: .85 };
    adjustment.perspective = [{ x: .1, y: .1 }, { x: .9, y: .15 }, { x: .85, y: .9 }, { x: .1, y: .85 }]; const before = JSON.stringify(f.state);
    expect(await f.run()).toBe(1); expect(f.detections).toHaveLength(0); expect(f.rendered).toEqual(['data:image/jpeg;base64,AQID']); expect(f.renderedAdjustments).toEqual([adjustment]);
    expect(f.writes[0]?.adjustments[f.assetKey]).toEqual(adjustment); expect(f.writes[0]?.layouts).toEqual(f.state.layouts); expect(f.writes[0]?.sources[0]?.image).toBe('data:image/jpeg;base64,AQID');
    expect(f.commits[0]?.images[f.assetKey]).toBe('data:image/jpeg;base64,BwgJ'); expect(f.dirty.size).toBe(0); expect(JSON.stringify(f.state)).toBe(before);
  });
  it.each(['restored', 'retired', 'unprepared'])('leaves %s images untouched', async cause => {
    const f = fixture(true); const adjustment = f.state.adjustments[f.assetKey]; if (!adjustment) throw new Error('ADJUSTMENT');
    if (cause === 'restored') adjustment.enhance = false;
    if (cause === 'retired') { const layout = Object.values(f.state.layouts)[0]; if (layout) layout.assets = []; }
    if (cause === 'unprepared') delete f.state.images[f.assetKey];
    expect(await f.run()).toBe(0); expect(f.rendered).toHaveLength(0); expect(f.writes).toHaveLength(0);
  });
  it('retains completed pixels and the dirty record on persistence failure', async () => {
    const f = fixture(true); f.failSave(); await expect(f.run()).rejects.toThrow('清晰化结果尚未保存');
    expect(f.commits[0]?.images[f.assetKey]).toBe('data:image/jpeg;base64,BwgJ'); expect(f.dirty.size).toBe(1); expect(f.writes).toHaveLength(0); expect(JSON.stringify(f.state)).toBe(f.before);
  });
  it('does not commit or save a late renderer result after cancellation', async () => {
    const f = fixture(true); let release = () => {}; f.gate(() => new Promise<void>(resolve => { release = resolve; }));
    const controller = new AbortController(); const pending = f.run(controller.signal); await Promise.resolve(); controller.abort(); release();
    await expect(pending).rejects.toThrow(); expect(f.rendered).toHaveLength(1); expect(f.commits).toHaveLength(0); expect(f.writes).toHaveLength(0); expect(JSON.stringify(f.state)).toBe(f.before);
  });
  it('does not rewrite an identical repeated enhancement', async () => {
    const f = fixture(true); f.setUnchanged(); expect(await f.run()).toBe(0); expect(f.rendered).toHaveLength(1); expect(f.commits).toHaveLength(0); expect(f.writes).toHaveLength(0);
  });
});
