import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { LocalEngine } from './local-engine.js';
import { LocalBatchQueue } from './local-batch.js';
import { LocalRepository, type LocalDocumentChange } from './local-repository.js';
import type { SolveOutcome, SolverInput } from '@solveflow/contracts/agent';
import { questionConversations } from './question-conversations.js';

const jpeg = 'data:image/jpeg;base64,/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKpAB//Z';
const outcome: SolveOutcome = { schemaVersion: 1, status: 'completed', verified: false, verificationStatus: 'not_requested', warning: null, verification: null, candidate: { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } };
async function setup() {
  const values = new Map<string, string>(); let fail = false; let held: (() => Promise<void>) | undefined;
  const documents = { async get(key: string) { return values.get(key) ?? null; }, async keys() { return [...values.keys()]; }, async put(key: string, value: string) { values.set(key, value); }, async remove(key: string) { values.delete(key); }, async batch(changes: LocalDocumentChange[]) {
    await held?.(); if (fail) throw new Error('DISK_FULL');
    for (const { key, value } of changes) if (value === null) values.delete(key); else values.set(key, value);
  } };
  const repository = new LocalRepository(documents); const engine = new LocalEngine(repository, randomUUID); engine.configureConcurrency({ solver: 1, verifier: 1 }); const queue = new LocalBatchQueue(engine);
  const batch = { id: randomUUID(), title: 'Synthetic materials', createdAt: new Date().toISOString(), exam: 'act' as const };
  const records = [];
  for (let position = 1; position <= 3; position++) {
    const record = await engine.create(jpeg, 2, 2, 'act', { ...batch, position });
    await engine.start(record.session.id, '', undefined, async () => outcome); await engine.waitForIdle(); records.push(await repository.read(record.session.id));
  }
  const ids = records.map(record => record.session.id);
  const plan = { batchId: batch.id, images: [{ image: jpeg, width: 2, height: 2, sessionIds: ids.slice(0, 2) }] };
  return { values, documents, repository, engine, queue, records, ids, plan, fail: () => { fail = true; }, hold: (value: () => Promise<void>) => { held = value; } };
}

it('saves a reusable supplement atomically, then answers only its recipients with separate evidence IDs', async () => {
  const f = await setup(); const untouched = await f.repository.read(f.ids[2]!); const beforeImages = f.ids.map(id => f.values.get(`image.${id}`));
  const execute = vi.fn(async (input: SolverInput) => { expect(f.ids.slice(0, 2).every(id => JSON.parse(f.values.get(`record.${id}`) ?? '{}').materials.length === 1)).toBe(true); expect(input.materials).toHaveLength(1); return outcome; });
  const result = await f.queue.addMaterials(f.plan, execute); await f.queue.waitForIdle(); expect(result.queuedIds).toEqual(f.ids.slice(0, 2)); expect(execute).toHaveBeenCalledTimes(2);
  const first = await f.repository.read(f.ids[0]!); const second = await f.repository.read(f.ids[1]!);
  expect(first.materials?.[0]?.image).toBe(jpeg); expect(second.materials?.[0]?.image).toBe(jpeg); expect(first.materials?.[0]?.id).not.toBe(second.materials?.[0]?.id);
  expect(first.session.runs[0]).toEqual(f.records[0]?.session.runs[0]); expect(first.session.runs).toHaveLength(2); expect(second.session.runs).toHaveLength(2);
  expect(first.session.runs[1]?.imageIds).toEqual(first.activeImageIds); expect(await f.repository.read(f.ids[2]!)).toEqual(untouched);
  expect(f.ids.map(id => f.values.get(`image.${id}`))).toEqual(beforeImages);
});

it.each(['storage', 'foreign', 'capacity', 'duplicate', 'jpeg'] as const)('does not save a prefix or call a model when %s validation fails', async failure => {
  const f = await setup(); const execute = vi.fn(async () => outcome);
  if (failure === 'storage') f.fail();
  if (failure === 'foreign') f.plan.images[0]!.sessionIds.push(randomUUID());
  if (failure === 'capacity') await f.engine.addMaterials(f.ids[1]!, Array.from({ length: 7 }, () => ({ image: jpeg, width: 2, height: 2 })));
  if (failure === 'duplicate') f.plan.images[0]!.sessionIds.push(f.ids[0]!);
  if (failure === 'jpeg') f.plan.images[0]!.width = 3;
  const before = new Map(f.values); await expect(f.queue.addMaterials(f.plan, execute)).rejects.toThrow();
  expect(f.values).toEqual(before); expect(execute).not.toHaveBeenCalled(); expect(f.queue.busy).toBe(false);
});

it('preserves committed supplements but admits no solves if cancelled while atomic storage is finishing', async () => {
  const f = await setup(); let release = () => {}; let entered = () => {};
  const waiting = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  f.hold(async () => { entered(); await gate; }); const controller = new AbortController(); const execute = vi.fn(async () => outcome);
  const saving = f.queue.addMaterials(f.plan, execute, controller.signal); await waiting; controller.abort(); release();
  const result = await saving; expect(result.savedIds).toEqual(f.ids.slice(0, 2)); expect(result.queuedIds).toEqual([]);
  expect(execute).not.toHaveBeenCalled(); expect((await f.repository.read(f.ids[0]!)).materials).toHaveLength(1); expect(f.queue.busy).toBe(false);
});

it('rejects already cancelled submissions without altering evidence', async () => {
  const f = await setup(); const execute = vi.fn(async () => outcome); const controller = new AbortController(); controller.abort();
  const before = new Map(f.values); await expect(f.queue.addMaterials(f.plan, execute, controller.signal)).rejects.toThrow();
  expect(f.values).toEqual(before); expect(execute).not.toHaveBeenCalled();
});

const redo = (f: Awaited<ReturnType<typeof setup>>, index: number) => ({ message: 'Redo', context: { kind: 'regenerate' as const, sourceRunId: f.records[index]!.session.runs[0]!.id } });
function latch() { let release = () => {}; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }

it('reanswers an idle recipient while a different question continues without cancellation', async () => {
  const f = await setup(); f.engine.configureConcurrency({ solver: 2, verifier: 1 }); const held = latch(); let otherSignal: AbortSignal | undefined;
  await f.queue.enqueue(f.ids[2]!, async (_input, signal) => { otherSignal = signal; await held.promise; return outcome; }, false, redo(f, 2));
  await expect.poll(() => !!otherSignal).toBe(true);
  const execute = vi.fn(async () => outcome);
  const result = await f.queue.addMaterials(f.plan, execute);
  await expect.poll(() => execute.mock.calls.length).toBe(2);
  expect(result.queuedIds).toEqual(f.ids.slice(0, 2)); expect(otherSignal?.aborted).toBe(false);
  held.release(); await f.queue.waitForIdle();
  expect((await f.repository.read(f.ids[2]!)).materials).toBeUndefined();
});

it('cancels only active recipients, lets unrelated queued work advance, and rejects stale results', async () => {
  const f = await setup(); f.engine.configureConcurrency({ solver: 2, verifier: 1 });
  const targetGate = latch(), otherGate = latch(); const signals = new Map<string, AbortSignal>(); const started: string[] = [];
  const old = async (input: SolverInput, signal: AbortSignal) => { started.push(input.identity.sessionId); signals.set(input.identity.sessionId, signal); if (input.identity.sessionId === f.ids[0]) await targetGate.promise; if (input.identity.sessionId === f.ids[1]) await otherGate.promise; return outcome; };
  for (const [index, id] of f.ids.entries()) await f.queue.enqueue(id, old, false, redo(f, index));
  await expect.poll(() => started.length).toBe(2);
  f.plan.images[0]!.sessionIds = [f.ids[0]!]; const execute = vi.fn(async () => outcome);
  const saving = f.queue.addMaterials(f.plan, execute);
  await expect.poll(() => signals.get(f.ids[0]!)?.aborted).toBe(true);
  expect(signals.get(f.ids[1]!)?.aborted).toBe(false);
  await expect(f.engine.start(f.ids[0]!, 'conflicting start', redo(f, 0).context, execute)).rejects.toThrow('补图');
  otherGate.release(); await expect.poll(() => started.includes(f.ids[2]!)).toBe(true);
  expect(execute).not.toHaveBeenCalled(); targetGate.release();
  await saving; await f.queue.waitForIdle();
  const target = await f.repository.read(f.ids[0]!);
  expect(target.session.runs.map(run => run.status)).toEqual(['completed', 'cancelled', 'completed']);
  expect(target.session.runs.at(-1)?.imageIds).toEqual(target.activeImageIds); expect(execute).toHaveBeenCalledTimes(1);
  for (const id of f.ids.slice(1)) { const record = await f.repository.read(id); expect(record.materials).toBeUndefined(); expect(record.session.runs.at(-1)?.status).toBe('completed'); }
});

it('replaces a waiting recipient with one supplemented request and preserves other waiting items', async () => {
  const f = await setup(); const gate = latch(); const started: string[] = [];
  const old = async (input: SolverInput) => { started.push(input.identity.sessionId); if (input.identity.sessionId === f.ids[2]) await gate.promise; return outcome; };
  await f.queue.enqueue(f.ids[2]!, old, false, redo(f, 2));
  await expect.poll(() => started.length).toBe(1);
  await f.queue.enqueue(f.ids[0]!, old, false, redo(f, 0)); await f.queue.enqueue(f.ids[1]!, old, false, redo(f, 1));
  f.plan.images[0]!.sessionIds = [f.ids[0]!]; const execute = vi.fn(async (input: SolverInput) => { expect(input.materials).toHaveLength(1); return outcome; });
  await f.queue.addMaterials(f.plan, execute); expect(f.queue.ids.filter(id => id === f.ids[0])).toHaveLength(1);
  gate.release(); await f.queue.waitForIdle();
  expect(started).toEqual([f.ids[2], f.ids[1]]); expect(execute).toHaveBeenCalledTimes(1);
});

it('invalid assignments do not cancel running recipients or disturb the queue', async () => {
  const f = await setup(); const gate = latch(); let signal: AbortSignal | undefined;
  await f.queue.enqueue(f.ids[0]!, async (_input, current) => { signal = current; await gate.promise; return outcome; }, false, redo(f, 0));
  await expect.poll(() => !!signal).toBe(true); f.plan.batchId = randomUUID();
  const execute = vi.fn(async () => outcome);
  await expect(f.queue.addMaterials(f.plan, execute)).rejects.toThrow('批次');
  expect(signal?.aborted).toBe(false); expect(execute).not.toHaveBeenCalled(); gate.release(); await f.queue.waitForIdle();
});

it('a failed material write restores the original waiting request without interrupting other work', async () => {
  const f = await setup(); const gate = latch(); const oldInputs: SolverInput[] = []; let otherSignal: AbortSignal | undefined;
  const old = async (input: SolverInput, signal: AbortSignal) => { oldInputs.push(input); if (input.identity.sessionId === f.ids[2]) { otherSignal = signal; await gate.promise; } return outcome; };
  await f.queue.enqueue(f.ids[2]!, old, false, redo(f, 2)); await expect.poll(() => !!otherSignal).toBe(true);
  await f.queue.enqueue(f.ids[0]!, old, false, redo(f, 0));
  const write = f.documents.batch;
  f.documents.batch = async changes => { if (changes.some(change => change.key.startsWith('material.'))) throw new Error('MATERIAL_WRITE_FAILED'); await write(changes); };
  f.plan.images[0]!.sessionIds = [f.ids[0]!]; const execute = vi.fn(async () => outcome);
  await expect(f.queue.addMaterials(f.plan, execute)).rejects.toThrow('MATERIAL_WRITE_FAILED');
  expect(otherSignal?.aborted).toBe(false); expect(f.queue.ids).toContain(f.ids[0]);
  gate.release(); await f.queue.waitForIdle();
  expect(oldInputs.map(input => input.identity.sessionId)).toEqual([f.ids[2], f.ids[0]]);
  expect(oldInputs[1]?.materials ?? []).toHaveLength(0); expect(execute).not.toHaveBeenCalled();
});

it('serializes successive overlapping submissions and keeps each answer bound to its own evidence', async () => {
  const f = await setup(); const gate = latch(); let entered = false;
  const write = f.documents.batch;
  f.documents.batch = async changes => { if (!entered && changes.some(change => change.key.startsWith('material.'))) { entered = true; await gate.promise; } await write(changes); };
  f.plan.images[0]!.sessionIds = [f.ids[0]!]; const snapshots: number[] = [];
  const execute = vi.fn(async (input: SolverInput) => { snapshots.push(input.materials?.length ?? 0); return outcome; });
  const first = f.queue.addMaterials(f.plan, execute); await expect.poll(() => entered).toBe(true);
  const second = f.queue.addMaterials(f.plan, execute); gate.release(); await Promise.all([first, second]); await f.queue.waitForIdle();
  const record = await f.repository.read(f.ids[0]!); expect(record.materials).toHaveLength(2);
  expect(snapshots.at(-1)).toBe(2); expect(snapshots.length).toBeLessThanOrEqual(2);
  expect(record.session.runs.at(-1)?.imageIds).toEqual(record.activeImageIds);
  expect(new Set(f.queue.ids).size).toBe(f.queue.ids.length);
});

it('supplementing a verifier waiter cancels only that waiter and keeps the other verification alive', async () => {
  const f = await setup(); f.engine.configureConcurrency({ solver: 2, verifier: 1 }); const verifierGate = latch(); const signals = new Map<string, AbortSignal>();
  const executeOld: import('./local-engine.js').DeviceSolve = async (input, signal, _event, _diagnostic, lifecycle) => {
    if (outcome.status !== 'completed' || !lifecycle) throw new Error('NO_LIFECYCLE');
    signals.set(input.identity.sessionId, signal); await lifecycle.candidate(outcome.candidate); const release = await lifecycle.verification();
    try { await verifierGate.promise; return outcome; } finally { await release(); }
  };
  await f.queue.enqueue(f.ids[1]!, executeOld, false, redo(f, 1));
  await expect.poll(() => f.engine.actives.some(run => run.sessionId === f.ids[1] && run.status === 'verifying')).toBe(true);
  await f.queue.enqueue(f.ids[0]!, executeOld, false, redo(f, 0));
  await expect.poll(() => signals.has(f.ids[0]!)).toBe(true);
  f.plan.images[0]!.sessionIds = [f.ids[0]!]; const execute = vi.fn(async () => outcome);
  await f.queue.addMaterials(f.plan, execute); await expect.poll(() => execute.mock.calls.length).toBe(1);
  expect(signals.get(f.ids[0]!)?.aborted).toBe(true); expect(signals.get(f.ids[1]!)?.aborted).toBe(false);
  verifierGate.release(); await f.queue.waitForIdle();
});

it('admits a newly added unrelated question while a receiving old request is still winding down', async () => {
  const f = await setup(); f.engine.configureConcurrency({ solver: 2, verifier: 1 }); const gate = latch(); let oldSignal: AbortSignal | undefined;
  const later = await f.engine.create(jpeg, 2, 2, 'act', { ...f.records[0]!.batch!, position: 4 });
  await f.queue.enqueue(f.ids[0]!, async (_input, signal) => { oldSignal = signal; await gate.promise; return outcome; }, false, redo(f, 0));
  await expect.poll(() => !!oldSignal).toBe(true); f.plan.images[0]!.sessionIds = [f.ids[0]!];
  const saving = f.queue.addMaterials(f.plan, async () => outcome);
  await expect.poll(() => oldSignal?.aborted).toBe(true);
  const execute = vi.fn(async () => outcome); const admission = f.queue.enqueue(later.session.id, execute);
  try { await expect.poll(() => execute.mock.calls.length).toBe(1); await admission; }
  finally { gate.release(); await saving; await f.queue.waitForIdle(); }
});

it('merges overlapping image assignments in order and queues each recipient once', async () => {
  const f = await setup(); f.plan.images.push({ image: jpeg, width: 2, height: 2, sessionIds: f.ids.slice(1) });
  const counts: number[] = []; const execute = vi.fn(async (input: SolverInput) => { counts.push(input.materials?.length ?? 0); return outcome; });
  const result = await f.queue.addMaterials(f.plan, execute); await f.queue.waitForIdle();
  expect(result.queuedIds).toEqual(f.ids); expect(counts).toEqual([1, 2, 1]); expect(execute).toHaveBeenCalledTimes(3);
});

it('automatically answers unanswered and failed recipients without requiring a saved answer context', async () => {
  const f = await setup(); const batch = f.records[0]!.batch!;
  const unanswered = await f.engine.create(jpeg, 2, 2, 'act', { ...batch, position: 4 });
  const failed = await f.engine.create(jpeg, 2, 2, 'act', { ...batch, position: 5 });
  await f.engine.start(failed.session.id, '', undefined, async () => { throw new Error('SYNTHETIC_FAILED'); }); await f.engine.waitForIdle();
  f.plan.images[0]!.sessionIds = [unanswered.session.id, failed.session.id]; const execute = vi.fn(async () => outcome);
  await f.queue.addMaterials(f.plan, execute); await f.queue.waitForIdle(); expect(execute).toHaveBeenCalledTimes(2);
  expect((await f.repository.read(unanswered.session.id)).session.runs).toHaveLength(1);
  expect((await f.repository.read(failed.session.id)).session.runs.at(-1)?.status).toBe('completed');
});

it('stopping the batch during an accepted atomic write retains supplements and prevents dispatch', async () => {
  const f = await setup(); let release = () => {}; let entered = () => {};
  const waiting = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  f.hold(async () => { entered(); await gate; }); const execute = vi.fn(async () => outcome);
  const saving = f.queue.addMaterials(f.plan, execute); await waiting; const stopping = f.queue.stop(f.plan.batchId); release();
  expect((await saving).queuedIds).toEqual([]); await stopping;
  expect(execute).not.toHaveBeenCalled(); expect((await f.repository.read(f.ids[1]!)).materials).toHaveLength(1); expect(f.queue.busy).toBe(false);
});

it('rejects adapters without a cross-record transaction before writing any supplement', async () => {
  const f = await setup(); const { batch: _batch, ...nonTransactional } = f.documents;
  const engine = new LocalEngine(new LocalRepository(nonTransactional), randomUUID); const queue = new LocalBatchQueue(engine);
  const before = new Map(f.values); const execute = vi.fn(async () => outcome);
  await expect(queue.addMaterials(f.plan, execute)).rejects.toThrow('批量补图事务'); expect(f.values).toEqual(before); expect(execute).not.toHaveBeenCalled();
});

async function groupedRecipient() {
  const f = await setup(); const batch = f.records[0]!.batch!;
  const record = await f.engine.create(jpeg, 2, 2, 'act', { ...batch, position: 4 });
  if (outcome.status !== 'completed') throw new Error('GROUP_OUTCOME');
  const grouped: SolveOutcome = { ...outcome, candidate: { ...outcome.candidate, questions: [1, 2].map(number => ({ number, answer: `Answer ${number}`, stepIds: [], figureIds: [] })) } };
  await f.engine.start(record.session.id, '', undefined, async () => grouped); await f.engine.waitForIdle();
  f.plan.images[0]!.sessionIds = [record.session.id]; return { ...f, groupId: record.session.id, group: await f.repository.read(record.session.id) };
}

it('reanswers grouped photos sequentially within their existing question threads without duplicating roots', async () => {
  const f = await groupedRecipient(); const inputs: SolverInput[] = []; let simultaneous = 0; let maximum = 0;
  const execute = vi.fn(async (input: SolverInput) => { inputs.push(input); simultaneous++; maximum = Math.max(maximum, simultaneous); await new Promise(resolve => setTimeout(resolve, 2)); simultaneous--; return outcome; });
  await f.queue.addMaterials(f.plan, execute); await f.queue.waitForIdle();
  expect(execute).toHaveBeenCalledTimes(2); expect(maximum).toBe(1); expect(inputs[0]?.focus?.content).toContain('第1题'); expect(inputs[1]?.focus?.content).toContain('第2题');
  expect(inputs.map(input => input.focus)).toMatchObject([{ questionNumber: 1 }, { questionNumber: 2 }]);
  const record = await f.repository.read(f.groupId); const threads = questionConversations(record.session.runs);
  expect(record.materials).toHaveLength(1); expect(record.session.runs).toHaveLength(3); expect(threads).toHaveLength(2); expect(threads.map(thread => thread.runs.length)).toEqual([2, 2]);
  expect(record.session.runs[0]).toEqual(f.group.session.runs[0]);
});

it('stopping the first grouped question prevents the remaining questions from being dispatched', async () => {
  const f = await groupedRecipient();
  const execute = vi.fn(async (_input: SolverInput, signal: AbortSignal) => { await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })); return outcome; });
  await f.queue.addMaterials(f.plan, execute); await expect.poll(() => execute.mock.calls.length).toBe(1);
  await f.queue.stop(f.plan.batchId); expect(execute).toHaveBeenCalledTimes(1); expect(f.queue.busy).toBe(false);
  expect((await f.repository.read(f.groupId)).session.runs.at(-1)?.status).toBe('cancelled');
});

it('checks the complete grouped plan against the conversation limit before saving any image', async () => {
  const f = await groupedRecipient(); const root = f.group.session.runs[0]; if (!root) throw new Error('GROUP_ROOT');
  const extra = Array.from({ length: 8 }, () => ({ ...root, id: randomUUID(), context: { kind: 'regenerate' as const, sourceRunId: root.id, number: 1 }, outcome }));
  await f.repository.save({ ...f.group, session: { ...f.group.session, runs: [...f.group.session.runs, ...extra] } });
  const before = new Map(f.values); const execute = vi.fn(async () => outcome);
  await expect(f.queue.addMaterials(f.plan, execute)).rejects.toThrow('对话次数上限'); expect(f.values).toEqual(before); expect(execute).not.toHaveBeenCalled();
});
