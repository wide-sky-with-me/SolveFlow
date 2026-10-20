import { readFileSync } from 'node:fs';
import { JsxEmit, ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { afterEach, expect, it, vi } from 'vitest';
import { LocalExportTasks, type ExportArtifact, type LocalExportTaskStore } from '@solveflow/client/local';
import { BatchPrintCopySchema, LocalRecordSchema, MAX_EXPORT_TASK_TIMEOUT_MS, type ExportTask } from '@solveflow/contracts/local';
import { planBatchPrintCopies, questionsForBatchPrint, questionsForBatchQuestionPrint, questionsForCapturedBatchQuestionPrint, questionsForCollectedBatchQuestionPrint, projectCapturedBatchPrintSnapshot } from '@solveflow/client/presentation';
import { waitForExportInitialization } from './export-admission.web';
import { exportInputBytes } from './export-input-bytes';

const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
function fixture(mode = 'answers', realQueue = false, accounting: { maximumBytes?: number; countBytes?: (value: unknown) => number } = {}) {
  const records = new Map<string, ExportTask>(); const files = new Map<string, ExportArtifact>();
  const store: LocalExportTaskStore = {
    list: async () => [...records.values()], save: async task => { records.set(task.id, structuredClone(task)); },
    remove: async key => { records.delete(key); files.delete(key); }, writeFile: async (key, value) => { files.set(key, value); },
    readFile: async key => files.get(key) ?? null, removeFile: async key => { files.delete(key); },
  };
  const gates: Array<() => void> = [];
  const sequence: string[] = [];
  const turn = vi.fn((signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
    sequence.push('turn'); gates.push(() => signal?.aborted ? reject(signal.reason) : resolve());
  }));
  const initialize = vi.fn(async () => {});
  const enqueue = vi.fn(async (metadata: unknown, runner: unknown, _signal?: AbortSignal) => ({ id: 'accepted', metadata, runner }));
  const unsubscribe = vi.fn();
  const subscribe = vi.fn(() => unsubscribe);
  const questions = vi.fn((snapshot: { pages: number; invalid?: boolean }) => {
    if (snapshot.invalid) throw new Error('INVALID_SNAPSHOT');
    return Array.from({ length: snapshot.pages }, () => ({}));
  });
  const capturedQuestions = vi.fn(async (snapshot: { pages: number; invalid?: boolean }, _beforeRecord: () => Promise<void>) => questions(snapshot));
  const collectedQuestions = vi.fn(async (snapshot: { pages: number; invalid?: boolean }, _beforeRecord: () => Promise<void>) => questions(snapshot));
  const pageCount = vi.fn((count: number) => { if (count > 300) throw new Error('PAGE_LIMIT'); });
  const bytes = vi.fn((input: { bytes: number }) => { sequence.push('bytes'); return accounting.countBytes ? accounting.countBytes(input) : input.bytes; });
  const run = vi.fn(async (_runtime: unknown, _input: typeof input, _signal: AbortSignal, _progress: (value: string) => void, _checkpoint: () => Promise<void>) => ({ name: 'export.pdf', mimeType: 'application/pdf', data: new Uint8Array([1, 2, 3]) }));
  const dependencies: Record<string, unknown> = {
    '@solveflow/client/local': { ExportTaskFailure: Error, LocalExportTasks: realQueue ? LocalExportTasks : class { initialize = initialize; enqueue = enqueue; subscribe = subscribe; getSnapshot = () => []; } },
    '@solveflow/contracts/local': { MAX_BATCH_PRINT_BYTES: accounting.maximumBytes ?? 100 },
    '@solveflow/client/presentation': { questionsForBatchQuestionPrint: questions, questionsForCapturedBatchQuestionPrint: capturedQuestions, questionsForCollectedBatchQuestionPrint: collectedQuestions },
    './export-task-store.web': { createExportTaskStore: () => store },
    './run-batch-export.web': { runCapturedBatchExport: run, runBatchExport: () => { throw new Error('GENERIC_RENDERER_USED_FOR_CAPTURE'); } },
    './download-batch-pdfs.web': { requireBatchPdfPageCount: pageCount },
    './export-input-bytes': { exportInputBytes: bytes },
    './export-admission.web': { yieldExportAdmission: turn, waitForExportInitialization },
  };
  const source = readFileSync(new URL('./web-export-tasks.ts', import.meta.url), 'utf8');
  const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText;
  const exported: Record<string, unknown> = {};
  new Function('require', 'exports', compiled)((name: string) => dependencies[name] ?? {}, exported);
  const factory = exported.webExportTasks; if (typeof factory !== 'function') throw new Error('FACTORY_MISSING');
  const manager = factory({});
  const input = {
    snapshot: { batch: { id: realQueue ? '00000000-0000-4000-8000-000000000001' : 'batch', title: 'title' }, records: [{ image: 'SOURCE' }], pages: 2 },
    mode, layout: 'saved', copies: [{ index: 1, answers: [{ answer: 'ORIGINAL', selectedOptions: ['A'] }] }],
    prepared: {
      images: { original: 'SOURCE' },
      layouts: { question: { problem: { statement: 'ORIGINAL', options: [{ label: 'A', text: 'ORIGINAL' }] }, assets: [{ key: 'original' }], warnings: ['ORIGINAL'] } },
    },
    bytes: 10,
  };
  const start = (signal?: AbortSignal) => manager.submit(input, undefined, signal);
  const startCollected = (signal?: AbortSignal) => manager.submitCollected(input, undefined, signal);
  const advance = async () => { const gate = gates.shift(); if (!gate) throw new Error('TURN_MISSING'); gate(); await flush(); };
  const finish = async () => { for (let index = 0; index < 4; index++) await advance(); };
  return { manager, input, start, startCollected, advance, finish, gates, turn, sequence, initialize, enqueue, unsubscribe, subscribe, questions, capturedQuestions, collectedQuestions, pageCount, bytes, run, store, records, files };
}

it.each(['synchronous', 'microtask'].flatMap(phase => [false, true].map(storageFault => ({ phase, storageFault }))))('real queue skips Web preparation on $phase pre-dispatch cancellation (storage fault: $storageFault)', async ({ phase, storageFault }) => {
  const f = fixture('answers', true); const prepare = vi.fn(async () => ({})); const cancellations: Promise<void>[] = []; let requested = false;
  const save = f.store.save; if (storageFault) f.store.save = async task => { if (task.status === 'cancelled') throw new Error('CANCEL_SAVE_FAILURE'); await save(task); };
  f.manager.tasks.subscribe(() => { const running = f.manager.tasks.getSnapshot().find((task: ExportTask) => task.status === 'running'); if (running && !requested) { requested = true; const cancel = () => { cancellations.push(f.manager.tasks.cancel(running.id)); }; if (phase === 'synchronous') cancel(); else queueMicrotask(cancel); } });
  const pending = f.manager.submit(f.input, prepare); await flush(); await f.finish(); const accepted = await pending;
  await f.manager.tasks.waitForIdle(); await Promise.all(cancellations);
  expect(requested).toBe(true); expect(prepare).not.toHaveBeenCalled(); expect(f.run).not.toHaveBeenCalled(); expect(f.files.size).toBe(0);
  expect(f.manager.tasks.getSnapshot().find((task: ExportTask) => task.id === accepted.id)?.status).toBe('cancelled');
  if (storageFault) { expect(f.manager.tasks.pendingSaveIds).toEqual([accepted.id]); f.store.save = save; await f.manager.tasks.retrySave(accepted.id); }
  expect(f.records.get(accepted.id)?.status).toBe('cancelled'); expect(f.manager.tasks.storageBlocked).toBe(false);
  f.input.bytes = 100; const next = f.manager.submit(f.input, prepare); await flush(); await f.finish(); const another = await next; await f.manager.tasks.waitForIdle();
  expect(f.records.get(another.id)?.status).toBe('succeeded'); expect(prepare).toHaveBeenCalledTimes(1); expect(f.run).toHaveBeenCalledTimes(1); expect(f.files.size).toBe(1);
});

it.each([1, 2, 3])('cancels during captured validation chunk %i and releases capacity for retry', async stop => {
  const f = fixture(); const controller = new AbortController(); const reason = new Error('USER_CANCELLED');
  f.capturedQuestions.mockImplementation(async (snapshot, beforeRecord) => {
    for (let index = 0; index < 3; index++) await beforeRecord();
    return f.questions(snapshot);
  });
  const outcome = f.start(controller.signal).then(() => null, (error: unknown) => error);
  await flush(); await f.advance(); await f.advance(); await f.advance();
  expect(f.capturedQuestions).toHaveBeenCalledTimes(1); expect(f.questions).toHaveBeenCalledTimes(1);
  for (let index = 1; index < stop; index++) await f.advance();
  await expect(f.start()).rejects.toThrow('正在加入导出队列');
  controller.abort(reason); await f.advance(); expect(await outcome).toBe(reason);
  expect(f.enqueue).not.toHaveBeenCalled(); expect(f.run).not.toHaveBeenCalled(); expect(f.unsubscribe).toHaveBeenCalledTimes(1);
  f.capturedQuestions.mockImplementation(async snapshot => f.questions(snapshot));
  f.input.bytes = 100; const next = f.start(); await flush(); await f.finish();
  await expect(next).resolves.toHaveProperty('id', 'accepted');
});

it.each([false, true])('releases captured validation failures with cancellation priority: %s', async cancel => {
  const f = fixture(); const controller = new AbortController();
  const failure = new Error('INVALID_CAPTURED_SNAPSHOT'); const reason = new Error('USER_CANCELLED');
  let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; });
  f.capturedQuestions.mockImplementation(async () => { await gate; throw failure; });
  const outcome = f.start(controller.signal).then(() => null, (error: unknown) => error);
  await flush(); await f.advance(); await f.advance(); await f.advance();
  await expect(f.start()).rejects.toThrow('正在加入导出队列');
  if (cancel) controller.abort(reason); release();
  expect(await outcome).toBe(cancel ? reason : failure);
  expect(f.enqueue).not.toHaveBeenCalled(); expect(f.run).not.toHaveBeenCalled(); expect(f.unsubscribe).toHaveBeenCalledTimes(1);
  f.capturedQuestions.mockImplementation(async snapshot => f.questions(snapshot));
  f.input.bytes = 100; const next = f.start(); await flush(); await f.finish(); await expect(next).resolves.toHaveProperty('id', 'accepted');
});

it('cancels the real captured parser between records and permits a full-capacity admission retry', async () => {
  const f = fixture(); const at = '2026-10-19T00:00:00.000Z'; const batch = { id: '00000000-0000-4000-8000-000000000001', title: 'Real admission', exam: 'general', createdAt: at };
  const snapshot = { schemaVersion: 1, exportedAt: at, batch, records: [1, 2].map(position => {
    const id = `00000000-0000-4000-8000-00000000000${position + 1}`;
    return { schemaVersion: 1, image: 'data:image/jpeg;base64,AQID', batch: { ...batch, position }, session: { schemaVersion: 1, id, subject: 'math', createdAt: at, runs: [], upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: 3, width: 30, height: 20, expiresAt: at, previewUrl: `/api/v1/uploads/${id}/image` } } };
  }) };
  Object.assign(f.input, { snapshot });
  f.questions.mockImplementation(questionsForBatchQuestionPrint);
  f.capturedQuestions.mockImplementation(questionsForCapturedBatchQuestionPrint);
  const parse = vi.spyOn(LocalRecordSchema, 'safeParse'); const controller = new AbortController(); const reason = new Error('USER_CANCELLED');
  const outcome = f.start(controller.signal).then(() => null, (error: unknown) => error);
  await flush(); for (let index = 0; index < 4; index++) await f.advance();
  expect(parse).toHaveBeenCalledTimes(1); controller.abort(reason); await f.advance(); expect(await outcome).toBe(reason);
  expect(parse).toHaveBeenCalledTimes(1); expect(f.enqueue).not.toHaveBeenCalled(); expect(f.unsubscribe).toHaveBeenCalledTimes(1);
  f.input.bytes = 100; const next = f.start(); await flush(); for (let index = 0; index < 6; index++) await f.advance();
  await expect(next).resolves.toHaveProperty('id', 'accepted'); expect(f.enqueue.mock.calls[0]?.[0]).toMatchObject({ questionCount: 2 });
});

it.each([1, 2, 3])('cancels collected preflight chunk %i before initialization or native capture', async stop => {
  const f = fixture(); const controller = new AbortController(); const reason = new Error('PREFLIGHT_CANCELLED');
  const native = vi.spyOn(globalThis, 'structuredClone');
  f.collectedQuestions.mockImplementation(async (snapshot, turn) => { for (let index = 0; index < 3; index++) await turn(); return f.questions(snapshot); });
  const outcome = f.startCollected(controller.signal).then(() => null, (error: unknown) => error); await flush(); await f.advance();
  for (let index = 1; index < stop; index++) await f.advance();
  await expect(f.start()).rejects.toThrow('正在加入导出队列'); controller.abort(reason); await f.advance(); expect(await outcome).toBe(reason);
  expect(f.initialize).not.toHaveBeenCalled(); expect(f.bytes).not.toHaveBeenCalled(); expect(native).not.toHaveBeenCalled();
  expect(f.subscribe).not.toHaveBeenCalled(); expect(f.enqueue).not.toHaveBeenCalled(); expect(f.run).not.toHaveBeenCalled();
  f.input.bytes = 100; const retry = f.start(); await flush(); await f.finish(); await expect(retry).resolves.toHaveProperty('id', 'accepted');
});
it.each([false, true])('preserves preflight error and observed cancellation priority: %s', async cancel => {
  const f = fixture(); const controller = new AbortController(); const reason = new Error('PREFLIGHT_CANCELLED'); const failure = new Error('INVALID_PREFLIGHT');
  let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; });
  f.collectedQuestions.mockImplementation(async () => { await gate; throw failure; });
  const outcome = f.startCollected(controller.signal).then(() => null, (error: unknown) => error); await flush(); await f.advance();
  if (cancel) controller.abort(reason); release(); expect(await outcome).toBe(cancel ? reason : failure);
  expect(f.initialize).not.toHaveBeenCalled(); expect(f.bytes).not.toHaveBeenCalled(); expect(f.subscribe).not.toHaveBeenCalled(); expect(f.enqueue).not.toHaveBeenCalled();
  f.input.bytes = 100; const retry = f.start(); await flush(); await f.finish(); await expect(retry).resolves.toHaveProperty('id', 'accepted');
});
it('uses the real collected preflight before initialization and retries through both real validators', async () => {
  const f = fixture(); const at = '2026-10-19T00:00:00.000Z'; const batch = { id: '00000000-0000-4000-8000-000000000001', title: '  Collected admission  ', exam: 'general', createdAt: at };
  const snapshot = { schemaVersion: 1, exportedAt: at, batch, records: [1, 2].map(position => {
    const id = `00000000-0000-4000-8000-00000000000${position + 1}`;
    return { schemaVersion: 1, image: 'data:image/jpeg;base64,AQID', batch: { ...batch, position }, session: { schemaVersion: 1, id, subject: 'math', createdAt: at, runs: [], upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: 3, width: 30, height: 20, expiresAt: at, previewUrl: `/api/v1/uploads/${id}/image` } } };
  }) };
  Object.assign(f.input, { snapshot }); f.collectedQuestions.mockImplementation(questionsForCollectedBatchQuestionPrint); f.capturedQuestions.mockImplementation(questionsForCapturedBatchQuestionPrint);
  const parse = vi.spyOn(LocalRecordSchema, 'safeParse'); const native = vi.spyOn(globalThis, 'structuredClone'); const controller = new AbortController(); const reason = new Error('PREFLIGHT_CANCELLED');
  const outcome = f.startCollected(controller.signal).then(() => null, (error: unknown) => error); await flush(); await f.advance(); await f.advance();
  expect(parse).toHaveBeenCalledTimes(1); expect(f.initialize).not.toHaveBeenCalled(); expect(native).not.toHaveBeenCalled();
  controller.abort(reason); await f.advance(); expect(await outcome).toBe(reason); expect(parse).toHaveBeenCalledTimes(1); expect(f.enqueue).not.toHaveBeenCalled();
  f.input.bytes = 100; const retry = f.startCollected(); await flush(); for (let index = 0; index < 8; index++) await f.advance();
  await expect(retry).resolves.toHaveProperty('id', 'accepted'); expect(native).toHaveBeenCalledTimes(1); expect(f.enqueue.mock.calls[0]?.[0]).toMatchObject({ questionCount: 2, title: '  Collected admission  ' });
});
it('keeps the initial snapshot observation after the original first scheduling turn', async () => {
  const f = fixture(); const pending = f.startCollected().then(() => null, (error: unknown) => error); await flush();
  f.input.snapshot.pages = 301; await f.advance(); expect(await pending).toMatchObject({ message: 'PAGE_LIMIT' });
  expect(f.initialize).not.toHaveBeenCalled(); expect(f.bytes).not.toHaveBeenCalled(); expect(f.enqueue).not.toHaveBeenCalled();
});
it.each([false, true])('cancels collected initialization waits and tolerates late storage completion: %s', async storageFault => {
  const f = fixture(); let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; });
  f.initialize.mockImplementationOnce(async () => { await gate; if (storageFault) throw new Error('LATE_INIT_FAILURE'); });
  const controller = new AbortController(); const reason = new Error('COLLECTED_INIT_CANCELLED');
  const pending = f.startCollected(controller.signal).then(() => null, (error: unknown) => error); await flush(); await f.advance();
  expect(f.initialize).toHaveBeenCalledTimes(1); controller.abort(reason); expect(await pending).toBe(reason);
  expect(f.bytes).not.toHaveBeenCalled(); expect(f.subscribe).not.toHaveBeenCalled(); expect(f.enqueue).not.toHaveBeenCalled();
  release(); await flush(); f.input.bytes = 100; const retry = f.startCollected(); await flush(); await f.finish();
  await expect(retry).resolves.toHaveProperty('id', 'accepted'); expect(f.run).not.toHaveBeenCalled();
});
it('keeps collected reading independent of both question preflight paths', async () => {
  const f = fixture('reading'); const pending = f.startCollected(); await flush(); await f.finish(); await pending;
  expect(f.questions).not.toHaveBeenCalled(); expect(f.collectedQuestions).not.toHaveBeenCalled(); expect(f.capturedQuestions).not.toHaveBeenCalled();
});

it('yields before each heavy phase while keeping byte accounting and cloning atomic', async () => {
  const f = fixture(); const clone = globalThis.structuredClone;
  vi.spyOn(globalThis, 'structuredClone').mockImplementation(<T>(value: T) => { f.sequence.push('clone'); return clone(value); });
  const pending = f.start(); await flush();
  expect(f.turn).toHaveBeenCalledTimes(1); expect(f.questions).not.toHaveBeenCalled(); expect(f.initialize).not.toHaveBeenCalled();
  await f.advance(); expect(f.questions).toHaveBeenCalledTimes(1); expect(f.initialize).toHaveBeenCalledTimes(1); expect(f.bytes).not.toHaveBeenCalled();
  await f.advance(); expect(f.sequence.slice(-3)).toEqual(['bytes', 'clone', 'turn']); expect(f.questions).toHaveBeenCalledTimes(1);
  await f.advance(); expect(f.questions).toHaveBeenCalledTimes(2); expect(f.enqueue).not.toHaveBeenCalled();
  await f.advance(); await expect(pending).resolves.toHaveProperty('id', 'accepted'); expect(f.run).not.toHaveBeenCalled();
});

it.each([1, 2, 3, 4])('cancels admission at turn %i without creating or running a task', async phase => {
  const f = fixture(); const controller = new AbortController(); const reason = new Error('USER_CANCELLED');
  const outcome = f.start(controller.signal).then(() => null, (error: unknown) => error); await flush();
  for (let index = 1; index < phase; index++) await f.advance();
  controller.abort(reason); await f.advance(); expect(await outcome).toBe(reason);
  expect(f.enqueue).not.toHaveBeenCalled(); expect(f.run).not.toHaveBeenCalled();
  expect(f.turn.mock.calls.every(([signal]) => signal === controller.signal)).toBe(true);
  expect(f.unsubscribe).toHaveBeenCalledTimes(phase >= 3 ? 1 : 0);
  f.input.bytes = 100; const next = f.start(); await flush(); await f.finish(); await expect(next).resolves.toHaveProperty('id', 'accepted');
});

it('revalidates the accepted clone and ignores later edits to the caller input', async () => {
  const f = fixture(); const pending = f.start(); await flush(); await f.advance();
  f.input.snapshot.pages = 3; await f.advance();
  f.input.snapshot.pages = 301;
  const firstRecord = f.input.snapshot.records[0]; if (!firstRecord) throw new Error('RECORD_MISSING'); firstRecord.image = 'CHANGED';
  await f.advance(); await f.advance(); await pending;
  const captured = f.questions.mock.calls[1]?.[0];
  expect(captured).toMatchObject({ pages: 3, records: [{ image: 'SOURCE' }] });
  expect(captured).not.toBe(f.input.snapshot); expect(f.enqueue.mock.calls[0]?.[0]).toMatchObject({ questionCount: 3 });
});

it('checks the accepted page count again after asynchronous admission', async () => {
  const f = fixture(); const outcome = f.start().then(() => null, (error: unknown) => error); await flush(); await f.advance();
  f.input.snapshot.pages = 301; await f.advance(); await f.advance();
  expect(await outcome).toMatchObject({ message: 'PAGE_LIMIT' }); expect(f.enqueue).not.toHaveBeenCalled(); expect(f.unsubscribe).toHaveBeenCalledTimes(1);
});

it('keeps initial page limits ahead of initialization, byte counting and queueing', async () => {
  const f = fixture(); f.input.snapshot.pages = 301;
  const outcome = f.start().then(() => null, (error: unknown) => error); await flush(); await f.advance();
  expect(await outcome).toMatchObject({ message: 'PAGE_LIMIT' }); expect(f.initialize).not.toHaveBeenCalled(); expect(f.bytes).not.toHaveBeenCalled(); expect(f.enqueue).not.toHaveBeenCalled();
});

it('keeps reading mode independent from question-page projection', async () => {
  const f = fixture('reading'); f.input.snapshot.pages = 301;
  const pending = f.start(); await flush(); await f.finish(); await pending;
  expect(f.questions).not.toHaveBeenCalled(); expect(f.pageCount).not.toHaveBeenCalled();
  expect(f.enqueue.mock.calls[0]?.[0]).toMatchObject({ mode: 'reading', copies: 1, questionCount: 1 });
});

it('cancels a pending initialization waiter without cancelling shared readiness', async () => {
  const f = fixture(); let resolveReady = () => {};
  const ready = new Promise<void>(resolve => { resolveReady = resolve; }); f.initialize.mockReturnValue(ready);
  const controller = new AbortController(); const reason = new Error('USER_CANCELLED');
  const outcome = f.start(controller.signal).then(() => null, (error: unknown) => error);
  await flush(); await f.advance(); controller.abort(reason); expect(await outcome).toBe(reason);
  expect(f.bytes).not.toHaveBeenCalled(); expect(f.enqueue).not.toHaveBeenCalled(); expect(f.gates).toHaveLength(0);
  const next = f.start(); await flush(); await f.advance(); expect(f.initialize).toHaveBeenCalledTimes(1);
  resolveReady(); await flush(); for (let index = 0; index < 3; index++) await f.advance();
  await expect(next).resolves.toHaveProperty('id', 'accepted');
});

it('passes admission cancellation to the queue and retains ownership until its write settles', async () => {
  const f = fixture(); const controller = new AbortController(); const reason = new Error('USER_CANCELLED');
  let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; });
  f.enqueue.mockImplementation(async (_metadata, _runner, signal) => { await gate; signal?.throwIfAborted(); throw new Error('EXPECTED_CANCEL'); });
  const outcome = f.start(controller.signal).then(() => null, (error: unknown) => error); await flush(); await f.finish();
  expect(f.enqueue.mock.calls[0]?.[2]).toBe(controller.signal); controller.abort(reason); await flush();
  expect(f.unsubscribe).not.toHaveBeenCalled(); expect(f.run).not.toHaveBeenCalled();
  await expect(f.start()).rejects.toThrow('正在加入导出队列');
  release(); expect(await outcome).toBe(reason); expect(f.unsubscribe).toHaveBeenCalledTimes(1);
  expect(f.manager.getSnapshot().notice).toBe('');
  f.enqueue.mockImplementation(async (metadata, runner) => ({ id: 'accepted', metadata, runner }));
  f.input.bytes = 100; const next = f.start(); await flush(); await f.finish(); await expect(next).resolves.toHaveProperty('id', 'accepted');
});

it('holds the submission lock across scheduling turns', async () => {
  const f = fixture(); const pending = f.start(); await flush();
  await expect(f.start()).rejects.toThrow('正在加入导出队列');
  await f.finish(); await pending; expect(f.enqueue).toHaveBeenCalledTimes(1);
});

async function queuedInput(f: ReturnType<typeof fixture>) {
  const runner = f.enqueue.mock.calls[0]?.[1];
  if (typeof runner !== 'function') throw new Error('RUNNER_MISSING');
  await runner(new AbortController().signal, () => {});
  const input = f.run.mock.calls[0]?.[1];
  if (!input) throw new Error('CAPTURE_MISSING');
  return input;
}

it('isolates nested plans and prepared content in both directions at the accepted capture', async () => {
  const f = fixture(); const pending = f.start(); await flush(); await f.advance();
  f.input.prepared.images.original = 'BEFORE_CAPTURE';
  f.input.prepared.layouts.question.problem.statement = 'BEFORE_CAPTURE';
  const expected = structuredClone(f.input);
  await f.advance();
  const copy = f.input.copies[0]; const answer = copy?.answers[0];
  const option = f.input.prepared.layouts.question.problem.options[0]; const asset = f.input.prepared.layouts.question.assets[0];
  if (!copy || !answer || !option || !asset) throw new Error('FIXTURE_MISSING');
  answer.selectedOptions.push('B'); answer.answer = 'CALLER_ANSWER';
  f.input.copies.push({ index: 2, answers: [] });
  f.input.prepared.images.original = 'CALLER_IMAGE';
  f.input.prepared.layouts.question.problem.statement = 'CALLER_STATEMENT';
  option.text = 'CALLER_OPTION'; asset.key = 'CALLER_ASSET'; f.input.prepared.layouts.question.warnings.push('CALLER_WARNING');
  await f.advance(); await f.advance(); await pending;
  const captured = await queuedInput(f);
  expect(captured).toStrictEqual(expected);
  expect(f.enqueue.mock.calls[0]?.[0]).toMatchObject({ copies: 1 });
  const capturedAnswer = captured.copies[0]?.answers[0];
  const capturedOption = captured.prepared.layouts.question.problem.options[0]; const capturedAsset = captured.prepared.layouts.question.assets[0];
  if (!capturedAnswer || !capturedOption || !capturedAsset) throw new Error('CAPTURE_MISSING');
  capturedAnswer.selectedOptions.push('C'); capturedAnswer.answer = 'RENDERER_ANSWER';
  captured.prepared.images.original = 'RENDERER_IMAGE';
  captured.prepared.layouts.question.problem.statement = 'RENDERER_STATEMENT';
  capturedOption.text = 'RENDERER_OPTION'; capturedAsset.key = 'RENDERER_ASSET'; captured.prepared.layouts.question.warnings.push('RENDERER_WARNING');
  expect(answer).toEqual({ answer: 'CALLER_ANSWER', selectedOptions: ['A', 'B'] });
  expect(f.input.prepared).toEqual({ images: { original: 'CALLER_IMAGE' }, layouts: { question: { problem: { statement: 'CALLER_STATEMENT', options: [{ label: 'A', text: 'CALLER_OPTION' }] }, assets: [{ key: 'CALLER_ASSET' }], warnings: ['ORIGINAL', 'CALLER_WARNING'] } } });
});

it('preserves native cloning of shared references, sparse arrays and non-JSON values', async () => {
  const f = fixture(); const assets = f.input.prepared.layouts.question.assets; const asset = assets[0]; const answer = f.input.copies[0]?.answers[0];
  if (!asset || !answer) throw new Error('FIXTURE_MISSING');
  assets.push(asset); answer.selectedOptions.length = 4; answer.selectedOptions[3] = 'D'; delete answer.selectedOptions[0];
  f.input.copies[0]?.answers.push({ answer: 'SHARED', selectedOptions: answer.selectedOptions });
  const date = new Date('2026-10-17T00:00:00Z'); const data = new Uint8Array([1, 2, 3]);
  const input = Object.assign(f.input, { native: { date, data, buffer: data.buffer, missing: undefined, nan: NaN, infinity: Infinity, negativeZero: -0 } });
  const expected = structuredClone(input); const pending = f.start(); await flush(); await f.advance(); await f.advance();
  date.setUTCFullYear(2030); data.fill(9); asset.key = 'CALLER'; answer.selectedOptions[1] = 'B';
  await f.advance(); await f.advance(); await pending;
  const captured = await queuedInput(f); expect(captured).toStrictEqual(expected);
  expect(captured.prepared.layouts.question.assets[0]).toBe(captured.prepared.layouts.question.assets[1]);
  expect(captured.prepared.layouts.question.assets[0]).not.toBe(asset);
  const first = captured.copies[0]?.answers[0]?.selectedOptions; const second = captured.copies[0]?.answers[1]?.selectedOptions;
  expect(first).toBe(second); expect(first).not.toBe(answer.selectedOptions);
  expect(first).toHaveLength(4); if (!first) throw new Error('CAPTURE_MISSING');
  expect(0 in first).toBe(false); expect(1 in first).toBe(false); expect(first[3]).toBe('D'); expect(data.byteLength).toBe(3);
});

it.each(['answers', 'reading'])('retains raw task metadata without moving schema normalization in %s mode', async mode => {
  const f = fixture(mode); f.input.snapshot.batch.title = '  RAW TITLE  ';
  const pending = f.start(); await flush(); await f.finish(); await pending;
  expect(f.enqueue.mock.calls[0]?.[0]).toMatchObject({ title: '  RAW TITLE  ' });
  const captured = await queuedInput(f); expect(captured.snapshot.batch.title).toBe('  RAW TITLE  ');
});

it('keeps a native clone failure before ownership and allows a full-capacity retry', async () => {
  const f = fixture(); Object.assign(f.input, { uncloneable: () => {} });
  const outcome = f.start().then(() => null, (error: unknown) => error); await flush(); await f.advance(); await f.advance();
  expect(await outcome).toMatchObject({ name: 'DataCloneError' });
  expect(f.questions).toHaveBeenCalledTimes(1); expect(f.subscribe).not.toHaveBeenCalled(); expect(f.enqueue).not.toHaveBeenCalled(); expect(f.run).not.toHaveBeenCalled();
  expect(Reflect.deleteProperty(f.input, 'uncloneable')).toBe(true); f.input.bytes = 100;
  const next = f.start(); await flush(); await f.finish(); await expect(next).resolves.toHaveProperty('id', 'accepted');
});

it('keeps byte-count errors ahead of cloning and releases the submission lock for retry', async () => {
  const f = fixture(); const failure = new TypeError('BYTE_COUNT_FAILURE');
  const clone = vi.spyOn(globalThis, 'structuredClone'); f.bytes.mockImplementationOnce(() => { throw failure; });
  const outcome = f.start().then(() => null, (error: unknown) => error); await flush(); await f.advance(); await f.advance();
  expect(await outcome).toBe(failure); expect(clone).not.toHaveBeenCalled(); expect(f.subscribe).not.toHaveBeenCalled(); expect(f.enqueue).not.toHaveBeenCalled();
  f.input.bytes = 100; const next = f.start(); await flush(); await f.finish(); await expect(next).resolves.toHaveProperty('id', 'accepted');
});

// Decision: .agents/notes/implemented/storage/2026-10-19-pdf-native-capture-boundary.md
it.each([false, true])('preserves native Proxy failure outside the collected snapshot and retries at capacity (collected: %s)', async collected => {
  const f = fixture(); const start = collected ? f.startCollected : f.start;
  Object.assign(f.input.prepared, { opaque: new Proxy({ image: 'A'.repeat(5000) }, {}) });
  const native = vi.spyOn(globalThis, 'structuredClone');
  const outcome = start().then(() => null, (error: unknown) => error);
  await flush(); await f.advance(); await f.advance();
  expect(await outcome).toMatchObject({ name: 'DataCloneError' });
  expect(native).toHaveBeenCalledTimes(1); expect(native.mock.calls[0]?.[0]).toBe(f.input);
  expect(f.bytes).toHaveBeenCalledTimes(1); expect(f.capturedQuestions).not.toHaveBeenCalled();
  expect(f.subscribe).not.toHaveBeenCalled(); expect(f.enqueue).not.toHaveBeenCalled(); expect(f.run).not.toHaveBeenCalled();
  expect(Reflect.deleteProperty(f.input.prepared, 'opaque')).toBe(true); f.input.bytes = 100;
  const retry = start(); await flush(); await f.finish(); await expect(retry).resolves.toHaveProperty('id', 'accepted');
});

it.each([false, true].flatMap(collected => ['date', 'view'].map(brand => ({ collected, brand }))))('retains native internal brands despite ordinary prototypes ($brand, collected: $collected)', async ({ collected, brand }) => {
  const f = fixture(); const value = brand === 'date' ? new Date('2026-10-19T00:00:00Z') : new Uint8Array([1, 2, 3]);
  Object.setPrototypeOf(value, Object.prototype);
  Object.assign(f.input.prepared, { native: value });
  const expected = structuredClone(f.input); const start = collected ? f.startCollected : f.start;
  const pending = start(); await flush(); await f.advance(); await f.advance();
  if (brand === 'date') Date.prototype.setTime.call(value, 0);
  else Uint8Array.prototype.fill.call(value, 9);
  await f.advance(); await f.advance(); await pending;
  const captured = await queuedInput(f); expect(captured).toStrictEqual(expected);
  expect(captured.prepared).not.toBe(f.input.prepared);
});

// Real accountant/native clone; only the capacity, storage and rendering fixtures are reduced.
const serializedBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const accountingLimit = 32 * 1024;
const realAccountingFixture = (mode = 'answers') => fixture(mode, false, { maximumBytes: accountingLimit, countBytes: exportInputBytes });
function sizeAccountingInput(f: ReturnType<typeof fixture>, total: number) {
  f.input.prepared.layouts.question.problem.statement = '';
  const padding = total - serializedBytes(f.input);
  if (padding < 0) throw new Error('ACCOUNTING_FIXTURE_TOO_LARGE');
  f.input.prepared.layouts.question.problem.statement = 'A'.repeat(padding);
  expect(serializedBytes(f.input)).toBe(total);
}

it.each(['answers', 'reading'].flatMap(mode => [false, true].flatMap(collected => [-1, 0, 1].map(delta => ({ mode, collected, delta })))))('uses real UTF-8 accounting at the exact capacity boundary ($mode, collected: $collected, delta: $delta)', async ({ mode, collected, delta }) => {
  const f = realAccountingFixture(mode); const image = 'A'.repeat(8192);
  f.input.snapshot.records.splice(0, 1, { image });
  f.input.snapshot.batch.title = '试卷😀\\\"\n';
  Object.assign(f.input.prepared.images, { original: image, repeated: image });
  sizeAccountingInput(f, accountingLimit + delta);
  const expected = structuredClone(f.input); const native = vi.spyOn(globalThis, 'structuredClone');
  const start = collected ? f.startCollected : f.start;
  const outcome = start().then(() => null, (error: unknown) => error);
  await flush(); await f.advance(); await f.advance();
  expect(f.bytes).toHaveBeenCalledTimes(1); expect(f.bytes.mock.results[0]?.value).toBe(accountingLimit + delta);
  if (delta > 0) {
    expect(await outcome).toMatchObject({ message: '等待导出的内容超过128MiB，请先完成当前任务。' });
    expect(native).not.toHaveBeenCalled(); expect(f.subscribe).not.toHaveBeenCalled(); expect(f.enqueue).not.toHaveBeenCalled();
  } else {
    expect(native).toHaveBeenCalledTimes(1); expect(native.mock.calls[0]?.[0]).toBe(f.input);
    await f.advance(); await f.advance(); expect(await outcome).toBeNull();
    expect(await queuedInput(f)).toStrictEqual(expected);
  }
});

it.each([false, true])('retains real byte reservations until execution releases them (collected: %s)', async collected => {
  const f = realAccountingFixture(); const start = collected ? f.startCollected : f.start;
  sizeAccountingInput(f, accountingLimit / 2); const expected = structuredClone(f.input);
  const first = start(); await flush(); await f.finish(); await first;
  sizeAccountingInput(f, accountingLimit / 2 + 1);
  const overflow = start().then(() => null, (error: unknown) => error);
  await flush(); await f.advance(); await f.advance();
  expect(await overflow).toMatchObject({ message: '等待导出的内容超过128MiB，请先完成当前任务。' });
  expect(f.enqueue).toHaveBeenCalledTimes(1); expect(f.subscribe).toHaveBeenCalledTimes(1);
  expect(await queuedInput(f)).toStrictEqual(expected); expect(f.unsubscribe).toHaveBeenCalledTimes(1);
  const retry = start(); await flush(); await f.finish(); await retry; expect(f.enqueue).toHaveBeenCalledTimes(2);
});

it.each([false, true])('releases a real-accounted native Proxy failure for an exact-capacity retry (collected: %s)', async collected => {
  const f = realAccountingFixture(); const start = collected ? f.startCollected : f.start;
  Object.assign(f.input.prepared, { opaque: new Proxy({ image: 'P'.repeat(8192) }, {}) });
  sizeAccountingInput(f, accountingLimit);
  const native = vi.spyOn(globalThis, 'structuredClone');
  const failure = start().then(() => null, (error: unknown) => error);
  await flush(); await f.advance(); await f.advance();
  expect(await failure).toMatchObject({ name: 'DataCloneError' }); expect(native).toHaveBeenCalledTimes(1);
  expect(f.bytes.mock.results[0]?.value).toBe(accountingLimit); expect(f.subscribe).not.toHaveBeenCalled(); expect(f.enqueue).not.toHaveBeenCalled();
  expect(Reflect.deleteProperty(f.input.prepared, 'opaque')).toBe(true); sizeAccountingInput(f, accountingLimit);
  const retry = start(); await flush(); await f.finish(); await expect(retry).resolves.toHaveProperty('id', 'accepted');
});

it.each([false, true].flatMap(collected => ['bigint', 'cycle', 'function'].map(fault => ({ collected, fault }))))('retains accounting, capacity, clone error ordering with real bytes ($fault, collected: $collected)', async ({ collected, fault }) => {
  const f = realAccountingFixture(); const start = collected ? f.startCollected : f.start;
  f.input.prepared.images.original = 'A'.repeat(accountingLimit);
  const value = fault === 'bigint' ? 1n : fault === 'cycle' ? f.input.prepared : () => undefined;
  Object.assign(f.input.prepared, { fault: value }); const native = vi.spyOn(globalThis, 'structuredClone');
  const failure = start().then(() => null, (error: unknown) => error);
  await flush(); await f.advance(); await f.advance();
  if (fault === 'function') expect(await failure).toMatchObject({ message: '等待导出的内容超过128MiB，请先完成当前任务。' });
  else expect(await failure).toBeInstanceOf(TypeError);
  expect(native).not.toHaveBeenCalled(); expect(f.subscribe).not.toHaveBeenCalled(); expect(f.enqueue).not.toHaveBeenCalled();
  expect(Reflect.deleteProperty(f.input.prepared, 'fault')).toBe(true); f.input.prepared.images.original = 'SOURCE'; sizeAccountingInput(f, accountingLimit);
  const retry = start(); await flush(); await f.finish(); await expect(retry).resolves.toHaveProperty('id', 'accepted');
});

it.each([false, true])('keeps real getter/toJSON effects and captures before their microtask (collected: %s)', async collected => {
  const f = realAccountingFixture(); const start = collected ? f.startCollected : f.start; const events: string[] = []; let reads = 0;
  const before = 'B'.repeat(8192); const later = 'C'.repeat(8192);
  Object.defineProperty(f.input.prepared, 'toJSON', { value: () => { events.push('toJSON'); f.input.prepared.images.original = before; return f.input.prepared; } });
  Object.defineProperty(f.input.prepared, 'observed', { enumerable: true, get() {
    events.push('getter'); reads++;
    if (reads === 1) queueMicrotask(() => { events.push('microtask'); f.input.prepared.images.original = later; });
    return 'ACCESSOR';
  } });
  f.bytes.mockImplementation(input => { events.push('count:start'); const count = exportInputBytes(input); events.push('count:end'); return count; });
  const native = globalThis.structuredClone;
  vi.spyOn(globalThis, 'structuredClone').mockImplementation(value => { events.push('clone:start'); const copy = native(value); events.push('clone:end'); return copy; });
  const pending = start(); await flush(); await f.finish(); await pending;
  expect(events).toEqual(['count:start', 'toJSON', 'getter', 'count:end', 'clone:start', 'getter', 'clone:end', 'microtask']);
  const captured = await queuedInput(f);
  expect(captured.prepared.images.original).toBe(before); expect(f.input.prepared.images.original).toBe(later);
  expect(Object.getOwnPropertyDescriptor(captured.prepared, 'observed')).toMatchObject({ value: 'ACCESSOR', enumerable: true, writable: true });
  expect(Object.hasOwn(captured.prepared, 'toJSON')).toBe(false);
  expect(f.bytes.mock.results[0]?.value).toBe(serializedBytes(captured));
});

it.each([false, true].flatMap(collected => [3, 4].map(stop => ({ collected, stop }))))('releases real-accounted capacity on post-capture cancellation (turn: $stop, collected: $collected)', async ({ collected, stop }) => {
  const f = realAccountingFixture(); const start = collected ? f.startCollected : f.start;
  sizeAccountingInput(f, accountingLimit); const controller = new AbortController(); const reason = new Error('USER_CANCELLED');
  const outcome = start(controller.signal).then(() => null, (error: unknown) => error);
  await flush(); for (let turn = 1; turn < stop; turn++) await f.advance();
  controller.abort(reason); await f.advance(); expect(await outcome).toBe(reason);
  expect(f.bytes.mock.results[0]?.value).toBe(accountingLimit); expect(f.enqueue).not.toHaveBeenCalled(); expect(f.unsubscribe).toHaveBeenCalledTimes(1);
  const retry = start(); await flush(); await f.finish(); await expect(retry).resolves.toHaveProperty('id', 'accepted');
});

it.each([false, true])('releases real-accounted capacity on captured validation failure (collected: %s)', async collected => {
  const f = realAccountingFixture(); const start = collected ? f.startCollected : f.start; const reason = new Error('CAPTURED_INVALID');
  sizeAccountingInput(f, accountingLimit); f.capturedQuestions.mockRejectedValueOnce(reason);
  const outcome = start().then(() => null, (error: unknown) => error);
  await flush(); await f.advance(); await f.advance(); await f.advance(); expect(await outcome).toBe(reason);
  expect(f.bytes.mock.results[0]?.value).toBe(accountingLimit); expect(f.enqueue).not.toHaveBeenCalled(); expect(f.unsubscribe).toHaveBeenCalledTimes(1);
  const retry = start(); await flush(); await f.finish(); await expect(retry).resolves.toHaveProperty('id', 'accepted');
});

function realCapturedRunnerFixture(mode = 'questions') {
  const f = fixture(mode, true); const at = '2026-10-19T00:00:00.000Z';
  const batch = { id: '00000000-0000-4000-8000-000000000001', title: 'Real runner projection', exam: 'general', createdAt: at };
  const snapshot = { schemaVersion: 1, exportedAt: at, batch, records: [1, 2].map(position => {
    const id = `00000000-0000-4000-8000-00000000000${position + 1}`;
    const run = { schemaVersion: 1, id: `00000000-0000-4000-8000-00000000010${position}`, sessionId: id, status: 'completed', message: '', seq: 1, createdAt: at,
      outcome: { schemaVersion: 1, status: 'completed', verified: false, verification: null, warning: null, verificationStatus: 'not_requested',
        candidate: { schemaVersion: 1, kind: 'answer', problem: { text: 'Synthetic problem', subject: 'math', uncertainties: [] }, answer: 'SYNTHETIC_ANSWER', steps: [], knowledgePoints: [], clarificationQuestions: [], citationIds: [] } } };
    return { schemaVersion: 1, image: 'data:image/jpeg;base64,AQID', batch: { ...batch, position }, session: { schemaVersion: 1, id, subject: 'math', createdAt: at, runs: mode === 'answers' ? [run] : [], upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: 3, width: 30, height: 20, expiresAt: at, previewUrl: `/api/v1/uploads/${id}/image` } } };
  }) };
  const pristine = structuredClone(snapshot); Object.assign(f.input, { snapshot });
  if (mode === 'answers') Object.assign(f.input, { copies: planBatchPrintCopies(questionsForBatchPrint(snapshot), [{ correct: 2, incorrect: 0 }]) });
  f.questions.mockImplementation(questionsForBatchQuestionPrint); f.capturedQuestions.mockImplementation(questionsForCapturedBatchQuestionPrint);
  const parseCopy = vi.fn((value: unknown) => BatchPrintCopySchema.parse(value)); const prepare = vi.fn(async () => ({ layouts: {}, images: {} }));
  const render = vi.fn(async (_node: unknown) => ({ main: {} })); const dispose = vi.fn();
  const mount = vi.fn((signal: AbortSignal) => ({ signal, render, dispose }));
  // The real runner reaches rendering; this synthetic artifact proves queue recovery, not PDF bytes.
  const artifact = { name: 'renderer-fixture.pdf', mimeType: 'application/pdf', data: new Uint8Array([1, 2, 3]) };
  const build = vi.fn(async (items: ReadonlyArray<{ element: () => Promise<unknown> }>) => { for (const item of items) await item.element(); return artifact; });
  const dependencies: Record<string, unknown> = {
    'react/jsx-runtime': { jsx: (type: unknown, props: unknown) => ({ type, props }) },
    '@solveflow/client/presentation': { projectCapturedBatchPrintSnapshot, batchQuestionFilename: () => 'questions.pdf', batchPrintFilename: () => 'answers.pdf', batchPrintArchiveFilename: () => 'batch.zip' },
    '@solveflow/contracts/local': { BatchPrintCopySchema: { parse: parseCopy } },
    './export-admission.web': { yieldExportAdmission: f.turn },
    './download-batch-pdfs.web': { requireBatchPdfPageCount: f.pageCount, buildBatchPdfs: build, formatBatchPdfProgress: () => '' },
    './prepare-batch-export.web': { prepareBatchExport: prepare },
    './batch-export-root.web': { createBatchExportRoot: mount },
    './batch-print-presentation.web': { requireCleanPrintLayouts: () => {}, requireSavedPrintLayouts: () => {}, requirePaperPrintLayouts: () => {}, requirePrintableCopies: () => {} },
    '../dom/batch-copy-document': { BatchCopyDocument: 'COPY' },
  };
  const text = readFileSync(new URL('./run-batch-export.web.tsx', import.meta.url), 'utf8');
  const compiled = transpileModule(text, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022, jsx: JsxEmit.ReactJSX } }).outputText;
  const exported: Record<string, unknown> = {}; new Function('require', 'exports', compiled)((name: string) => dependencies[name] ?? {}, exported);
  const runner = exported.runCapturedBatchExport; if (typeof runner !== 'function') throw new Error('CAPTURED_RUNNER_MISSING');
  const failures: unknown[] = [];
  f.run.mockImplementation(async (...args) => { try { return await runner(...args); } catch (cause) { failures.push(cause); throw cause; } });
  return { ...f, mode, snapshot, pristine, parseCopy, prepare, mount, render, dispose, build, artifact, failures };
}
async function recoverRealCapturedRunner(f: ReturnType<typeof realCapturedRunnerFixture>) {
  Object.assign(f.input, { snapshot: f.pristine, mode: f.mode, bytes: 100 });
  const retry = f.start(); await flush(); for (let index = 0; index < 8; index++) await f.advance();
  const next = await retry; await f.manager.tasks.waitForIdle();
  expect(f.records.get(next.id)?.status).toBe('succeeded'); expect(f.files.get(next.id)).toEqual(f.artifact);
  expect(f.run).toHaveBeenCalledTimes(2); expect(f.prepare).toHaveBeenCalledTimes(1); expect(f.mount).toHaveBeenCalledTimes(1);
  expect(f.render).toHaveBeenCalledTimes(1); expect(f.build).toHaveBeenCalledTimes(1); expect(f.dispose).toHaveBeenCalledTimes(1);
  expect(f.parseCopy).toHaveBeenCalledTimes(f.mode === 'answers' ? 1 : 0);
  expect(f.bytes.mock.results.at(-1)?.value).toBe(100); expect(f.files.size).toBe(1);
  return next;
}
it.each([1, 2])('cancels the real captured runner at projection record %i without leaking its reservation or caller data', async stop => {
  const f = realCapturedRunnerFixture(); const { pristine, parseCopy, prepare, mount } = f;
  const parse = vi.spyOn(LocalRecordSchema, 'safeParse'); const pending = f.start(); await flush();
  for (let index = 0; index < 6; index++) await f.advance(); const accepted = await pending;
  expect(f.run).toHaveBeenCalledTimes(1); expect(parse).toHaveBeenCalledTimes(2);
  const owned = f.run.mock.calls[0]?.[1]; expect(owned).toBeDefined(); expect(owned?.snapshot).not.toBe(f.input.snapshot);
  f.input.snapshot.records[1]!.image = 'INVALID'; f.input.snapshot.batch.title = 'EDITED'; f.input.mode = 'reading';
  f.input.copies[0]!.answers[0]!.answer = 'EDITED'; f.input.prepared.images.original = 'EDITED';
  expect(owned?.snapshot).toStrictEqual(pristine); expect(owned?.mode).toBe('questions');
  expect(owned?.copies[0]?.answers[0]?.answer).toBe('ORIGINAL'); expect(owned?.prepared.images.original).toBe('SOURCE');
  for (let index = 1; index < stop; index++) await f.advance();
  const cancellation = f.manager.tasks.cancel(accepted.id); await f.advance(); await cancellation; await f.manager.tasks.waitForIdle();
  expect(parse).toHaveBeenCalledTimes(2 + stop - 1); expect(f.records.get(accepted.id)?.status).toBe('cancelled'); expect(f.files.size).toBe(0);
  expect(parseCopy).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled(); expect(mount).not.toHaveBeenCalled();
  await recoverRealCapturedRunner(f);
});

it.each([1, 2].flatMap(stop => [
  'reject', 'cancel-late-resolve', 'cancel-late-reject', 'reject-cancel-race', 'timeout-late-reject', 'cancel-before-timeout',
].map(settlement => ({ stop, settlement }))))('settles a real runner checkpoint at record $stop ($settlement) and recovers at capacity', async ({ stop, settlement }) => {
  if (settlement.includes('timeout')) vi.useFakeTimers();
  const f = realCapturedRunnerFixture('answers'); const failure = new Error('CHECKPOINT_REJECTED');
  const parse = vi.spyOn(LocalRecordSchema, 'safeParse'); const write = vi.spyOn(f.store, 'writeFile');
  let resolve = () => {}; let reject: (reason: unknown) => void = () => {};
  const gate = new Promise<void>((done, fail) => { resolve = done; reject = fail; }); const checkpoint = vi.fn(() => gate);
  const schedule = f.turn.getMockImplementation(); if (!schedule) throw new Error('SCHEDULER_MISSING'); let runnerTurns = 0;
  f.turn.mockImplementation(signal => {
    if (signal && signal === f.run.mock.calls[0]?.[2] && ++runnerTurns === stop) return checkpoint();
    return schedule(signal);
  });
  const submitted = f.start(); await flush(); for (let index = 0; index < 6; index++) await f.advance(); const accepted = await submitted;
  for (let index = 1; index < stop; index++) await f.advance();
  const signal = f.run.mock.calls[0]?.[2]; if (!signal) throw new Error('RUNNER_SIGNAL_MISSING');
  expect(checkpoint).toHaveBeenCalledTimes(1); expect(signal.aborted).toBe(false);
  expect(parse).toHaveBeenCalledTimes(2 + stop - 1); expect(f.records.get(accepted.id)?.status).toBe('running');
  // A suspended runner still owns its reservation, even if it will later fail or cancel.
  f.input.bytes = 100; const blocked = f.start().then(() => null, (cause: unknown) => cause);
  await flush(); await f.advance(); await f.advance();
  expect(await blocked).toMatchObject({ message: '等待导出的内容超过128MiB，请先完成当前任务。' }); expect(f.run).toHaveBeenCalledTimes(1);
  let terminalBeforeLateResult: ExportTask | undefined;
  if (settlement === 'reject-cancel-race') {
    reject(failure); const cancellation = f.manager.tasks.cancel(accepted.id);
    expect(signal.aborted).toBe(true); await cancellation;
  } else if (settlement.startsWith('cancel-')) {
    await f.manager.tasks.cancel(accepted.id); expect(signal.aborted).toBe(true);
    expect(f.records.get(accepted.id)?.status).toBe('cancelled'); terminalBeforeLateResult = f.records.get(accepted.id);
    if (settlement === 'cancel-before-timeout') await vi.advanceTimersByTimeAsync(MAX_EXPORT_TASK_TIMEOUT_MS);
    if (settlement === 'cancel-late-resolve') resolve(); else reject(failure);
  } else {
    if (settlement === 'timeout-late-reject') {
      await vi.advanceTimersByTimeAsync(MAX_EXPORT_TASK_TIMEOUT_MS); expect(signal.aborted).toBe(true);
      expect(f.records.get(accepted.id)?.status).toBe('failed'); terminalBeforeLateResult = f.records.get(accepted.id);
    }
    reject(failure);
  }
  await f.manager.tasks.waitForIdle();
  const cancelled = settlement.startsWith('cancel-') || settlement === 'reject-cancel-race';
  const expectedError = cancelled ? null : settlement === 'timeout-late-reject' ? '导出超过执行期限，请检查题量后明确重新提交。' : '导出失败，请检查内容后重新提交。';
  expect(f.records.get(accepted.id)).toMatchObject({ status: cancelled ? 'cancelled' : 'failed', error: expectedError, file: null });
  expect(f.manager.tasks.getSnapshot().find((task: ExportTask) => task.id === accepted.id)).toStrictEqual(f.records.get(accepted.id));
  if (terminalBeforeLateResult) expect(f.records.get(accepted.id)).toStrictEqual(terminalBeforeLateResult);
  expect(f.failures).toHaveLength(1); expect(f.failures[0]).toBe(signal.aborted ? signal.reason : failure); expect(parse).toHaveBeenCalledTimes(2 + stop - 1);
  expect(f.parseCopy).not.toHaveBeenCalled(); expect(f.prepare).not.toHaveBeenCalled(); expect(f.mount).not.toHaveBeenCalled();
  expect(f.render).not.toHaveBeenCalled(); expect(f.build).not.toHaveBeenCalled(); expect(f.dispose).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled(); expect(f.files.size).toBe(0); expect(f.manager.tasks.pendingSaveIds).toEqual([]); expect(f.manager.tasks.storageBlocked).toBe(false);
  await recoverRealCapturedRunner(f); expect(write).toHaveBeenCalledTimes(1); expect(parse).toHaveBeenCalledTimes(2 + stop - 1 + 4);
});
