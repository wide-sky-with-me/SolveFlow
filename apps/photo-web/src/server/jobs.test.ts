import { expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { PhotoJobs } from './jobs.js';
import { PhotoLedger } from './ledger.js';
import { SolveOutcomeSchema } from '@solveflow/contracts/agent';
const input = () => ({ schemaVersion: 1 as const, requestId: randomUUID(), sessionId: randomUUID(), exam: 'act' as const, image: 'data:image/jpeg;base64,AQID' });
const answer = SolveOutcomeSchema.parse({ schemaVersion: 1, status: 'completed', verified: false, verification: null, verificationStatus: 'not_requested', warning: null, candidate: { schemaVersion: 1, kind: 'answer', problem: { text: 'Synthetic', subject: 'math', uncertainties: [] }, answer: '2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } });
const gate = () => { let release = () => {}; const promise = new Promise<void>(r => { release = r; }); return { promise, release }; };
it('remembers cancellation before a late upload is admitted without affecting another owner', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'photo-job-early-cancel-')); let calls = 0;
  const jobs = new PhotoJobs(join(dir, 'jobs'), new PhotoLedger(join(dir, 'ledger.json')), async () => { calls++; return answer; });
  try {
    const request = input(); expect(await jobs.cancel('a', request.requestId)).toBeNull();
    expect((await jobs.start('a', 'nonce', request))?.status).toBe('cancelled'); expect(calls).toBe(0);
    await jobs.start('b', 'other', request); await expect.poll(async () => (await jobs.status('b', request.requestId))?.status).toBe('finished'); expect(calls).toBe(1);
  } finally { await jobs.close(); await rm(dir, { recursive: true, force: true }); }
});
it('cancels an admission waiting on durable quota without dispatching the model', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'photo-job-admitting-cancel-')), hold = gate(); let calls = 0;
  const ledger = new PhotoLedger(join(dir, 'ledger.json')), original = ledger.claim.bind(ledger);
  const claim = vi.spyOn(ledger, 'claim').mockImplementation(async (account, id) => { await hold.promise; await original(account, id); });
  const jobs = new PhotoJobs(join(dir, 'jobs'), ledger, async () => { calls++; return answer; });
  try {
    const request = input(), accepting = jobs.start('a', 'nonce', request);
    await expect.poll(() => claim.mock.calls.length).toBe(1);
    const stopped = jobs.cancel('a', request.requestId); hold.release(); await accepting; await stopped;
    expect((await jobs.status('a', request.requestId))?.status).toBe('cancelled'); expect(calls).toBe(0);
  } finally { hold.release(); await jobs.close(); await rm(dir, { recursive: true, force: true }); }
});
it('bounds status reads waiting behind admission and does not treat that admission as abandoned', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'photo-job-read-limit-')), hold = gate();
  const ledger = new PhotoLedger(join(dir, 'ledger.json')), original = ledger.claim.bind(ledger);
  const claim = vi.spyOn(ledger, 'claim').mockImplementation(async (account, id) => { await hold.promise; await original(account, id); });
  const jobs = new PhotoJobs(join(dir, 'jobs'), ledger, async () => answer);
  try {
    const request=input(), accepting=jobs.start('a','nonce',request); await expect.poll(()=>claim.mock.calls.length).toBe(1);
    const reads=Array.from({length:127},()=>jobs.status('a',request.requestId));
    await expect(jobs.status('a',request.requestId)).rejects.toThrow('同步请求较多');
    hold.release();await accepting;
    for (const snapshot of await Promise.all(reads)) expect(snapshot).toMatchObject({requestId:request.requestId,status:expect.stringMatching(/^(running|finished)$/)});
  } finally {hold.release();await jobs.close();await rm(dir,{recursive:true,force:true});}
});
it('retains results after disconnect/restart, rejects foreign reads and never replays an admitted request', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'photo-jobs-')), hold = gate(); let calls = 0;
  const ledger = new PhotoLedger(join(dir, 'ledger.json'), 1), jobs = new PhotoJobs(join(dir, 'jobs'), ledger, async () => { calls++; await hold.promise; return answer; });
  try {
    const request = input(); expect((await jobs.start('a', 'nonce', request))?.status).toBe('running');
    expect((await jobs.start('a', 'nonce', request))?.status).toBe('running'); expect(calls).toBe(1);
    expect(await jobs.status('b', request.requestId)).toBeNull();
    await expect(jobs.start('a', 'nonce', { ...request, sessionId: randomUUID() })).rejects.toThrow('其他内容');
    hold.release(); await expect.poll(async () => (await jobs.status('a', request.requestId))?.status).toBe('finished');
    const restarted = new PhotoJobs(join(dir, 'jobs'), ledger, async () => { calls++; return answer; });
    expect((await restarted.status('a', request.requestId))?.outcome).toEqual(answer);
    expect((await restarted.start('a', 'nonce2', request))?.outcome).toEqual(answer); expect(calls).toBe(1); await restarted.close();
  } finally { hold.release(); await jobs.close(); await rm(dir, { recursive: true, force: true }); }
});
it('cancellation wins over late model completion and revoked admission dispatches nothing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'photo-jobs-')), hold = gate(); let calls = 0;
  const jobs = new PhotoJobs(join(dir, 'jobs'), new PhotoLedger(join(dir, 'ledger.json')), async () => { calls++; await hold.promise; return answer; });
  try {
    const first = input(); await jobs.start('a', 'nonce', first); expect((await jobs.cancel('a', first.requestId))?.status).toBe('cancelled');
    hold.release(); await Promise.resolve(); expect((await jobs.status('a', first.requestId))?.status).toBe('cancelled');
    expect((await jobs.start('a', 'revoked', input(), () => false))?.status).toBe('cancelled'); expect(calls).toBe(1);
  } finally { hold.release(); await jobs.close(); await rm(dir, { recursive: true, force: true }); }
});
it('marks abandoned persisted admissions interrupted after a restart without dispatch', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'photo-jobs-')), hold = gate(); let calls = 0;
  const ledger = new PhotoLedger(join(dir, 'ledger.json')), jobs = new PhotoJobs(join(dir, 'jobs'), ledger, async () => { calls++; await hold.promise; return answer; });
  try {
    const request = input(); await jobs.start('a', 'nonce', request);
    const file = join(dir, 'jobs', (await readdir(join(dir, 'jobs'))).find(x => x.endsWith('.json'))!); const admitted = await readFile(file);
    await jobs.close(); await writeFile(file, admitted);
    const restarted = new PhotoJobs(join(dir, 'jobs'), ledger, async () => { calls++; return answer; });
    expect((await restarted.status('a', request.requestId))?.status).toBe('interrupted'); expect(calls).toBe(1); await restarted.close();
  } finally { hold.release(); await jobs.close(); await rm(dir, { recursive: true, force: true }); }
});
it('keeps a completed result in bounded memory on disk failure and retries only its save', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'photo-jobs-')), hold = gate(); let calls = 0;
  const jobs = new PhotoJobs(join(dir, 'jobs'), new PhotoLedger(join(dir, 'ledger.json')), async () => { calls++; await hold.promise; return answer; });
  try {
    const request = input(); await jobs.start('a', 'nonce', request);
    await rename(join(dir, 'jobs'), join(dir, 'saved')); await writeFile(join(dir, 'jobs'), 'simulate unavailable directory'); hold.release();
    await expect.poll(async () => { try { await jobs.status('a', request.requestId); return false; } catch { return true; } }).toBe(true);
    expect(jobs.activeCount).toBe(1); await rm(join(dir, 'jobs')); await rename(join(dir, 'saved'), join(dir, 'jobs'));
    await expect.poll(async () => (await jobs.status('a', request.requestId))?.status).toBe('finished'); expect(calls).toBe(1);
  } finally { hold.release(); await jobs.close(); await rm(dir, { recursive: true, force: true }); }
});
