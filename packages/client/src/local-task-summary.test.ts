import { makeSafeAgentError } from '@solveflow/contracts/agent';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { LocalRepository } from './local-repository.js';
import { LocalEngine } from './local-engine.js';
import { LOCAL_HISTORY_ANSWER_STATE_VERSION } from '@solveflow/contracts/local';
it('rebuilds an old failed summary as an explicit stop using metadata, preserving all original bytes', async () => {
  const values = new Map<string, string>(), reads: string[] = [];
  const repository = new LocalRepository({ async get(key) { reads.push(key); return values.get(key) ?? null; }, async put(key, value) { values.set(key, value); }, async remove(key) { values.delete(key); }, async keys() { return [...values.keys()]; } });
  const engine = new LocalEngine(repository, randomUUID), record = await engine.create('data:image/jpeg;base64,AQID', 30, 20, 'general');
  let started = false;
  const run = await engine.start(record.session.id, '', undefined, async (_input, signal) => {
    started = true; await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    return { schemaVersion: 1, status: 'failed', verified: false, error: makeSafeAgentError('CANCELLED', 'summary-fixture') };
  });
  await expect.poll(() => started).toBe(true); await engine.cancelRun(run.id);
  const summaryKey = `summary.${record.session.id}`, current = JSON.parse(values.get(summaryKey)!);
  const { answerReady: _ready, taskState: _state, ...old } = current;
  values.set(summaryKey, JSON.stringify({ ...old, answerStateVersion: 2, answerState: 'failed' }));
  const original = new Map([...values].filter(([key]) => key !== summaryKey)); reads.length = 0;
  const [summary] = await repository.listHistory();
  expect(summary).toMatchObject({ taskState: 'cancelled', answerReady: false, answerStateVersion: LOCAL_HISTORY_ANSWER_STATE_VERSION });
  expect(reads.some(key => key.startsWith('image.') || key.startsWith('material.'))).toBe(false);
  for (const [key, value] of original) expect(values.get(key)).toBe(value);
});
