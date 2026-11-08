import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { SolveOutcomeSchema, type SolveOutcome } from '@solveflow/contracts/agent';
import { PracticeJobs } from './practice.js';
const outcome = () => SolveOutcomeSchema.parse({ schemaVersion: 1, status: 'completed', verificationStatus: 'not_requested', verified: false, verification: null, warning: null, candidate: { schemaVersion: 1, kind: 'answer', problem: { text: 'What is 2 + 2?', subject: 'math', uncertainties: [], options: [{ label: 'A', text: '3' }, { label: 'B', text: '4' }] }, selectedOptions: ['B'], answer: 'B. 4', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } });
const image = () => sharp({ create: { width: 300, height: 200, channels: 3, background: '#fff' } }).jpeg().toBuffer();
const request = () => ({ requestId: randomUUID(), exam: 'general' as const });
afterEach(() => vi.useRealTimers());
it('holds a result in memory, isolates owners and reuses a request without dispatching again', async () => {
  const solve = vi.fn(async () => outcome()), jobs = new PracticeJobs(solve), input = request(), bytes = await image();
  await jobs.start('student', input, async () => bytes, async () => {});
  await vi.waitFor(() => expect(jobs.status('student', input.requestId).status).toBe('finished'));
  expect(jobs.status('student', input.requestId).outcome).toEqual(outcome());
  expect(() => jobs.status('other', input.requestId)).toThrow('已过期');
  await jobs.start('student', input, async () => bytes, async () => {});
  expect(solve).toHaveBeenCalledTimes(1);
  await expect(jobs.start('student', { ...input, exam: 'sat' }, async () => bytes, async () => {})).rejects.toThrow('其他题图');
  jobs.close();
});
it('cancels a request before upload admission and while image bytes are still arriving', async () => {
  const solve = vi.fn(async () => outcome()), jobs = new PracticeJobs(solve), input = request(), read = vi.fn(image);
  jobs.cancel('student', input.requestId);
  expect((await jobs.start('student', input, read, async () => {})).status).toBe('cancelled');
  expect(read).not.toHaveBeenCalled();
  const next = request(); let release: (bytes: Uint8Array) => void = () => {}, reading: () => void = () => {};
  const entered = new Promise<void>(resolve => { reading = resolve; });
  const pending = jobs.start('student', next, () => new Promise(resolve => { release = resolve; reading(); }), async () => {});
  await entered;
  jobs.cancel('student', next.requestId); release(await image());
  expect((await pending).status).toBe('cancelled'); expect(solve).not.toHaveBeenCalled(); jobs.close();
});
it('does not begin reading a photo after cancellation while the service plan is loading', async () => {
  let release: (value: null) => void = () => {};
  const capture = () => new Promise<null>(resolve => { release = resolve; }), solve = vi.fn(async () => outcome()), read = vi.fn(image);
  const jobs = new PracticeJobs(solve, Date.now, 4, capture), input = request();
  try {
    const pending = jobs.start('student', input, read, async () => {});
    jobs.cancel('student', input.requestId); release(null);
    expect((await pending).status).toBe('cancelled');
    expect((await jobs.start('student', input, read, async () => {})).status).toBe('cancelled');
    expect(read).not.toHaveBeenCalled();expect(solve).not.toHaveBeenCalled();
  } finally { jobs.close(); }
});
it('closing during service selection returns cancellation without recreating retained jobs', async () => {
  let release: (value: null) => void = () => {};
  const read = vi.fn(image), solve = vi.fn(async () => outcome()), jobs = new PracticeJobs(solve, Date.now, 4, () => new Promise<null>(resolve => { release = resolve; })), input = request();
  const pending = jobs.start('student', input, read, async () => {});
  jobs.close();release(null);
  expect((await pending).status).toBe('cancelled');expect(read).not.toHaveBeenCalled();expect(solve).not.toHaveBeenCalled();
  expect(() => jobs.status('student', input.requestId)).toThrow('已过期');
});
it('does not let a late solver result overwrite cancellation', async () => {
  let finish: (value: SolveOutcome) => void = () => {};
  const solve = vi.fn(() => new Promise<SolveOutcome>(resolve => { finish = resolve; })), jobs = new PracticeJobs(solve), input = request();
  await jobs.start('student', input, image, async () => {});
  jobs.cancel('student', input.requestId); finish(outcome());
  await Promise.resolve(); await Promise.resolve();
  expect(jobs.status('student', input.requestId)).toMatchObject({ status: 'cancelled', outcome: null }); jobs.close();
});
it('bounds global and per-student work, then releases capacity after completion', async () => {
  let finish: (value: SolveOutcome) => void = () => {};
  const jobs = new PracticeJobs(() => new Promise(resolve => { finish = resolve; }), Date.now, 1), input = request();
  await jobs.start('student', input, image, async () => {});
  await expect(jobs.start('other', request(), image, async () => {})).rejects.toThrow('较多');
  finish(outcome()); await vi.waitFor(() => expect(jobs.status('student', input.requestId).status).toBe('finished'));
  await jobs.start('other', request(), image, async () => {}); jobs.close();
});
it('never dispatches bad images or revoked identities and releases rejected reservations', async () => {
  const solve = vi.fn(async () => outcome()), jobs = new PracticeJobs(solve);
  await expect(jobs.start('student', request(), async () => new Uint8Array([1, 2]), async () => {})).rejects.toThrow('无法读取');
  await expect(jobs.start('student', request(), image, async () => { throw new Error('REVOKED'); })).rejects.toThrow();
  expect(solve).not.toHaveBeenCalled();
  await jobs.start('student', request(), image, async () => {}); expect(solve).toHaveBeenCalledOnce(); jobs.close();
});
it('bounds execution time, expires results and never replays a job on a read', async () => {
  vi.useFakeTimers();
  const solve = vi.fn(() => new Promise<SolveOutcome>(() => {})), jobs = new PracticeJobs(solve), input = request();
  await jobs.start('student', input, image, async () => {});
  await vi.advanceTimersByTimeAsync(6 * 60_000);
  expect(jobs.status('student', input.requestId).outcome).toMatchObject({ status: 'failed', error: { code: 'RUN_TIMEOUT' } });
  await vi.advanceTimersByTimeAsync(10 * 60_000 + 1);
  expect(() => jobs.status('student', input.requestId)).toThrow('已过期'); expect(solve).toHaveBeenCalledOnce(); jobs.close();
});
it('closing discards all retained content and refuses new admissions', async () => {
  const jobs = new PracticeJobs(async () => outcome()), input = request();
  await jobs.start('student', input, image, async () => {}); jobs.close();
  expect(() => jobs.status('student', input.requestId)).toThrow('已过期');
  await expect(jobs.start('student', request(), image, async () => {})).rejects.toThrow('较多');
});
