import { z } from 'zod';
import { answer, assert, hold, instrument, integrity, jpeg, open, pageCount, recalled, remember } from './support';

export async function batchFull() {
  const { db, documents } = await open('batch-full');
  try {
    await documents.put('sentinel', 'original');
    const control = instrument(db); control.maxPages = await pageCount(db);
    let rejected = false;
    try { await documents.batch!([{ key: 'sentinel', value: 'changed' }, { key: 'large', value: 'x'.repeat(256 * 1024) }]); }
    catch { rejected = true; }
    assert(rejected && control.nativeFull, 'Expected a real native SQLITE_FULL');
    assert(await documents.get('sentinel') === 'original' && await documents.get('large') === null, 'Failed transaction partially committed');
    control.maxPages = 0;
    await documents.batch!([{ key: 'sentinel', value: 'retried' }, { key: 'large', value: 'x'.repeat(256 * 1024) }]);
    assert(await documents.get('sentinel') === 'retried', 'Write did not recover');
    await integrity(db); return { nativeFull: true, rollback: true, retry: true };
  } finally { await db.closeAsync(); }
}
export async function engineFull() {
  const { db, repository, engine } = await open('engine-full');
  try {
    const record = await engine.create(jpeg, 2, 2); const control = instrument(db); let calls = 0;
    const expected = answer('测'.repeat(8000));
    await engine.start(record.session.id, '', undefined, async () => { calls++; control.maxPages = await pageCount(db); return expected; });
    await engine.waitForIdle();
    assert(control.nativeFull && engine.unsavedRuns.length === 1, 'Native full did not preserve unsaved result');
    let blocked = false; try { await engine.create(jpeg, 2, 2); } catch { blocked = true; }
    assert(blocked, 'New work accepted while result was unsaved');
    control.maxPages = 0; await engine.retryPendingSaves();
    assert(!engine.unsavedRuns.length && calls === 1, 'Save retry replayed model or lost result');
    assert(JSON.stringify((await repository.read(record.session.id)).session.runs[0]?.outcome) === JSON.stringify(expected), 'Saved answer mismatch');
    await integrity(db); return { nativeFull: true, modelCalls: calls, newWorkBlocked: blocked, saved: true };
  } finally { await db.closeAsync(); }
}
export async function killWrite() {
  const { db, documents } = await open('kill-write');
  await documents.put('sentinel', 'original');
  const control = instrument(db);
  control.beforeCommit = async () => { control.beforeCommit = null; await hold('kill-write', { inTransaction: true }); };
  await documents.batch!([{ key: 'sentinel', value: 'changed' }, { key: 'second', value: 'partial' }]);
  throw new Error('Transaction escaped process-stop checkpoint');
}
export async function checkWrite() {
  const { db, documents } = await open('kill-write', false);
  try {
    assert(await documents.get('sentinel') === 'original' && await documents.get('second') === null, 'Process kill left a partial transaction');
    await integrity(db); return { rolledBack: true, integrity: 'ok' };
  } finally { await db.closeAsync(); }
}
export async function killRun() {
  const { engine } = await open('kill-run');
  const record = await engine.create(jpeg, 2, 2);
  let calls = 0;
  await engine.start(record.session.id, '', undefined, async () => { calls++; remember('kill-run', { id: record.session.id, modelCalls: calls }); await hold('kill-run', { activeRunPersisted: true, modelCalls: calls }); return answer(); });
  await engine.waitForIdle();
}
export async function checkRun() {
  const { db, repository } = await open('kill-run', false);
  try {
    const before = z.object({ id: z.uuid(), modelCalls: z.literal(1) }).parse(recalled('kill-run'));
    await repository.recoverInterrupted();
    const run = (await repository.read(before.id)).session.runs[0];
    assert(run?.status === 'failed' && run.outcome?.status === 'failed' && run.outcome.error.code === 'WORKER_LOST', 'Interrupted run was not recovered safely');
    await integrity(db); return { status: run.status, error: run.outcome.error.code, modelCalls: before.modelCalls, restartModelCalls: 0 };
  } finally { await db.closeAsync(); }
}

export async function killUnsaved() {
  const { db, engine } = await open('kill-unsaved');
  const record = await engine.create(jpeg, 2, 2); const control = instrument(db); let calls = 0;
  await engine.start(record.session.id, '', undefined, async () => { calls++; control.maxPages = await pageCount(db); return answer('测'.repeat(8000)); });
  await engine.waitForIdle();
  assert(control.nativeFull && engine.unsavedRuns.length === 1, 'Expected an unsaved result before process stop');
  remember('kill-unsaved', { id: record.session.id, modelCalls: calls });
  await hold('kill-unsaved', { nativeFull: true, memoryOnlyResult: true, modelCalls: calls });
}
export async function checkUnsaved() {
  const { db, repository, engine } = await open('kill-unsaved', false);
  try {
    const { id, modelCalls } = z.object({ id: z.uuid(), modelCalls: z.literal(1) }).parse(recalled('kill-unsaved'));
    await repository.recoverInterrupted();
    const run = (await repository.read(id)).session.runs[0];
    assert(run?.outcome?.status === 'failed' && run.outcome.error.code === 'WORKER_LOST', 'Lost memory result was reported as saved success');
    assert(engine.unsavedRuns.length === 0, 'Unexpected recovered in-memory result');
    await integrity(db); return { interrupted: true, memoryOnlyResultLost: true, modelCalls, restartModelCalls: 0 };
  } finally { await db.closeAsync(); }
}
