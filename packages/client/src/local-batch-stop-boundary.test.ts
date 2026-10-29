import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { LocalEngine, type DeviceSolve } from './local-engine.js';
import { LocalRepository } from './local-repository.js';
import { LocalBatchQueue } from './local-batch.js';
import type { SolveOutcome } from '@solveflow/contracts/agent';
const answer: SolveOutcome = { schemaVersion: 1, status: 'completed', verified: false, verificationStatus: 'not_requested', warning: null, verification: null, candidate: { schemaVersion: 1, kind: 'answer', problem: { text: 'Synthetic x+1=3', subject: 'math', uncertainties: [] }, answer: '2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } };
function fixture() {
  const values = new Map<string, string>();
  const repository = new LocalRepository({ async get(key) { return values.get(key) ?? null; }, async put(key, value) { values.set(key, value); }, async remove(key) { values.delete(key); }, async keys() { return [...values.keys()]; } });
  const engine = new LocalEngine(repository, randomUUID); engine.configureConcurrency({ solver: 2, verifier: 1 });
  const queue = new LocalBatchQueue(engine); const batches = [0, 1].map(index => ({ id: randomUUID(), title: `Synthetic ${index}`, createdAt: new Date().toISOString(), exam: 'general' as const }));
  return { repository, engine, queue, batches, create: (batch: number) => engine.create('data:image/jpeg;base64,AQID', 30, 20, 'general', { ...batches[batch]!, position: 1 }) };
}
it('cancels A immediately without waiting for a different batch material operation to settle', async () => {
  const f = fixture(), a = await f.create(0), b = await f.create(1); let release = () => {}, materialStarted = false, aborted = false;
  const execute: DeviceSolve = async (_input, signal) => { await new Promise<void>(resolve => signal.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true })); return answer; };
  f.engine.addBatchMaterials = async () => { materialStarted = true; await new Promise<void>(resolve => { release = resolve; }); return [b]; };
  let material: Promise<unknown> | undefined, stop: Promise<void> | undefined;
  try {
    await f.queue.enqueue(a.session.id, execute); await expect.poll(() => f.engine.actives.length).toBe(1);
    material = f.queue.addMaterials({ batchId: f.batches[1]!.id, images: [{ image: 'data:image/jpeg;base64,AQID', width: 30, height: 20, sessionIds: [b.session.id] }] }, async () => answer);
    await expect.poll(() => materialStarted).toBe(true); stop = f.queue.stop(f.batches[0]!.id);
    await expect.poll(() => aborted).toBe(true); await stop;
    expect(materialStarted).toBe(true); expect(f.queue.isBusy(f.batches[1]!.id)).toBe(true);
  } finally { release(); await material; await stop; await f.queue.stop(); }
});
it('does not admit an older enqueue after its batch stop finishes while metadata was still being read', async () => {
  const f = fixture(), a = await f.create(0); const read = f.repository.readMetadata.bind(f.repository); let release = () => {}, reading = false, calls = 0;
  f.repository.readMetadata = async id => { reading = true; await new Promise<void>(resolve => { release = resolve; }); return read(id); };
  const enqueue = f.queue.enqueue(a.session.id, async () => { calls++; return answer; }); const observed = enqueue.catch(() => undefined);
  try {
    await expect.poll(() => reading).toBe(true); const stop = f.queue.stop(f.batches[0]!.id);
    // A stop must not depend on this not-yet-accepted metadata read.
    const finished = stop.then(() => true); await expect.poll(() => f.queue.getSnapshot().stoppingBatchIds.length).toBe(0);
    expect(await finished).toBe(true); release(); await observed; await f.queue.waitForIdle(); expect(calls).toBe(0);
  } finally { release(); await observed; await f.queue.stop(); }
});
it('discards a stopped material plan still waiting behind another batch, even after the stop flag clears', async () => {
  const f = fixture(), a = await f.create(0), b = await f.create(1); let release = () => {}, started = false, aCalls = 0;
  f.engine.addBatchMaterials = async plan => {
    if (typeof plan === 'object' && plan && 'batchId' in plan && plan.batchId === f.batches[0]!.id) { aCalls++; return [a]; }
    started = true; await new Promise<void>(resolve => { release = resolve; }); return [b];
  };
  const make = (batch: number, id: string) => ({ batchId: f.batches[batch]!.id, images: [{ image: 'data:image/jpeg;base64,AQID', width: 30, height: 20, sessionIds: [id] }] });
  const first = f.queue.addMaterials(make(1, b.session.id), async () => answer); let second: Promise<unknown> | undefined;
  try {
    await expect.poll(() => started).toBe(true); second = f.queue.addMaterials(make(0, a.session.id), async () => answer).catch((cause: unknown) => cause);
    await f.queue.stop(f.batches[0]!.id); expect(f.queue.getSnapshot().stoppingBatchIds).toEqual([]);
    release(); await first; expect(await second).toBeInstanceOf(Error); expect(aCalls).toBe(0);
  } finally { release(); await first; await second; await f.queue.stop(); }
});
