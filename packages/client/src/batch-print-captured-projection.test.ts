import { afterEach, expect, it, vi } from 'vitest';
import { BatchPrintSnapshotSchema, LocalRecordSchema } from '@solveflow/contracts/local';
import * as projection from './batch-print-variants.js';

const at = '2026-10-19T00:00:00.000Z';
const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
function source(count = 3, sections = 1, runs = 1) {
  const batch = { id: id(1), title: '  Captured projection  ', exam: 'general', createdAt: at };
  const problem = { text: 'Synthetic problem', subject: 'math', uncertainties: [] as string[] };
  return { schemaVersion: 1, exportedAt: at, batch, records: Array.from({ length: count }, (_, index) => {
    const sessionId = id(index + 1000);
    return { schemaVersion: 1, image: 'data:image/jpeg;base64,AQID', batch: { ...batch, position: index + 1 },
      session: { schemaVersion: 1, id: sessionId, subject: 'math', createdAt: at,
        upload: { schemaVersion: 1, id: sessionId, mimeType: 'image/jpeg', bytes: 3, width: 30, height: 20, expiresAt: at, previewUrl: `/api/v1/uploads/${sessionId}/image` },
        runs: Array.from({ length: runs }, (_, run) => ({ schemaVersion: 1, id: id(2000 + index * 100 + run), sessionId, status: 'completed', message: '', seq: 1, createdAt: at,
          outcome: { schemaVersion: 1, status: 'completed', verified: false, verification: null, warning: null, verificationStatus: 'not_requested',
            candidate: { schemaVersion: 1, kind: 'answer', problem: structuredClone(problem), answer: 'PRIVATE_ANSWER', steps: [], knowledgePoints: [], clarificationQuestions: [], citationIds: [],
              ...(sections > 1 ? { questions: Array.from({ length: sections }, (_, number) => ({ number: number + 1, answer: String(number + 1), problem: structuredClone(problem), stepIds: [], figureIds: [] })) } : {}) } } })) } };
  }) };
}
const captured = projection.projectCapturedBatchPrintSnapshot;
afterEach(() => vi.restoreAllMocks());

it.each([false, true])('fully validates and projects the owned capture with answers: %s', async includeAnswers => {
  const input = source(); const before = structuredClone(input); const expected = projection.projectBatchPrintSnapshot(input, includeAnswers);
  const record = vi.spyOn(LocalRecordSchema, 'safeParse'); const whole = vi.spyOn(BatchPrintSnapshotSchema, 'parse');
  const seen: number[] = []; const gate = vi.fn();
  const output = await captured(input, includeAnswers, async () => { seen.push(record.mock.calls.length); }, gate);
  expect(output).toStrictEqual(expected); expect(input).toStrictEqual(before); expect(seen).toEqual([0, 1, 2]);
  expect(record).toHaveBeenCalledTimes(3); expect(whole).not.toHaveBeenCalled(); expect(gate).toHaveBeenCalledExactlyOnceWith(3);
  expect(output.snapshot).not.toBe(input); expect(output.snapshot.records).not.toBe(input.records);
  expect(output.problems.map(problem => problem.ordinal)).toEqual([1, 2, 3]); expect(JSON.stringify(output.problems)).not.toContain('PRIVATE_ANSWER');
  expect(output.questions).toHaveLength(includeAnswers ? 3 : 0);
});
it.each([1, 2, 3])('cancels before validating record %i without projecting partial results', async stop => {
  const reason = Symbol('CANCELLED'); const record = vi.spyOn(LocalRecordSchema, 'safeParse'); const gate = vi.fn(); let turns = 0;
  await expect(captured(source(), true, async () => { if (++turns === stop) throw reason; }, gate)).rejects.toBe(reason);
  expect(turns).toBe(stop); expect(record).toHaveBeenCalledTimes(stop - 1); expect(gate).not.toHaveBeenCalled();
});
it('keeps the original synchronous unknown entry unchanged', () => {
  const input = source(1); const image = input.records[0]!.image; let reads = 0;
  Object.defineProperty(input.records[0], 'image', { enumerable: true, get() { reads++; return image; } });
  const output = projection.projectBatchPrintSnapshot(input, false);
  expect(output).not.toBeInstanceOf(Promise); expect(output.snapshot.records[0]?.image).toBe(image); expect(reads).toBeGreaterThan(0);
});
function observedSource(fault?: { path: string; reason: unknown }) {
  const input = source(2); const reads: string[] = [];
  const observe = (value: unknown, path: string) => {
    if (typeof value !== 'object' || value === null) return;
    for (const key of Object.keys(value)) {
      const child: unknown = Reflect.get(value, key); const field = `${path}.${key}`; observe(child, field);
      Object.defineProperty(value, key, { enumerable: true, configurable: true, get() {
        reads.push(field);
        if (fault && field === fault.path) throw fault.reason;
        return child;
      } });
    }
  };
  observe(input, 'snapshot');
  return { input, reads };
}
const readCounts = (reads: readonly string[]) => Object.fromEntries([...new Set(reads)].map(path => [path, reads.filter(value => value === path).length]));

it.each([false, true])('matches the original schema getter order and exact counts synchronously (answers: %s)', includeAnswers => {
  const oracle = observedSource(); const expected = BatchPrintSnapshotSchema.parse(oracle.input); const expectedReads = [...oracle.reads];
  const actual = observedSource(); const readsAtGate: string[][] = []; const gate = vi.fn(() => { readsAtGate.push([...actual.reads]); });
  const output = projection.projectBatchPrintSnapshot(actual.input, includeAnswers, gate); const actualReads = [...actual.reads];
  // Identity matchers may inspect getters; compare identity as a boolean instead of re-observing the input.
  expect(output).not.toBeInstanceOf(Promise); expect(output.snapshot).toStrictEqual(expected);
  expect(actual.input === oracle.input).toBe(false);
  expect(oracle.reads).toEqual(expectedReads); expect(actual.reads).toEqual(actualReads);
  expect(expectedReads).toContain('snapshot.batch.title');
  expect(expectedReads).toContain('snapshot.records.0.session.runs.0.outcome.candidate.answer');
  expect(expectedReads).toContain('snapshot.records.1.image');
  expect(actualReads).toEqual(expectedReads); expect(readCounts(actualReads)).toEqual(readCounts(expectedReads));
  expect(gate).toHaveBeenCalledExactlyOnceWith(2); expect(readsAtGate).toEqual([expectedReads]);
});
it.each([false, true].flatMap(includeAnswers => [
  'snapshot.schemaVersion', 'snapshot.records.0.session.runs.0.outcome.candidate.answer', 'snapshot.records.1.image',
].map(path => ({ includeAnswers, path }))))('preserves getter throw identity and the complete schema cutoff at $path (answers: $includeAnswers)', ({ includeAnswers, path }) => {
  const reason = Object.freeze({ failure: 'GETTER_FAILURE', path });
  const oracle = observedSource({ path, reason }); let expected: unknown;
  try { BatchPrintSnapshotSchema.parse(oracle.input); } catch (cause) { expected = cause; }
  expect(expected).toBe(reason); expect(oracle.reads.at(-1)).toBe(path);
  const actual = observedSource({ path, reason }); const gate = vi.fn(); let error: unknown;
  try { projection.projectBatchPrintSnapshot(actual.input, includeAnswers, gate); } catch (cause) { error = cause; }
  expect(error).toBe(reason); expect(error).toBe(expected);
  expect(actual.reads).toEqual(oracle.reads); expect(readCounts(actual.reads)).toEqual(readCounts(oracle.reads));
  expect(actual.reads.at(-1)).toBe(path); expect(gate).not.toHaveBeenCalled();
});
it('keeps later caller edits outside the owned capture and returns independent output', async () => {
  const caller = source(); const owned = structuredClone(caller); const expected = projection.projectBatchPrintSnapshot(owned, true);
  const output = await captured(owned, true, async () => {
    caller.batch.title = 'CHANGED'; caller.records[2]!.image = 'INVALID'; caller.records[1]!.session.runs[0]!.outcome.candidate.answer = 'CHANGED';
  });
  expect(output).toStrictEqual(expected); output.snapshot.batch.title = 'RENDERER'; output.questions[0]?.candidate.problem.uncertainties.push('RENDERER');
  expect(owned.batch.title).toBe('  Captured projection  '); expect(owned.records[0]!.session.runs[0]!.outcome.candidate.problem.uncertainties).toEqual([]);
});
it.each(['image', 'answer', 'root', 'owner', 'position', 'session', 'sparse'] as const)('keeps complete source issues and order for %s ahead of the page gate', async field => {
  const input = source();
  if (field === 'image') input.records[2]!.image = 'INVALID';
  if (field === 'answer') Object.assign(input.records[1]!.session.runs[0]!.outcome.candidate, { answer: 123 });
  if (field === 'root') Object.assign(input, { unknown: true });
  if (field === 'owner') input.records[2]!.batch.id = id(9);
  if (field === 'position') input.records[2]!.batch.position = 1;
  if (field === 'session') input.records[1]!.session = structuredClone(input.records[0]!.session);
  if (field === 'sparse') Reflect.deleteProperty(input.records, '1');
  const expected = BatchPrintSnapshotSchema.safeParse(input); if (expected.success) throw new Error('INVALID_FIXTURE_ACCEPTED');
  const gate = vi.fn(); await expect(captured(input, true, async () => {}, gate)).rejects.toMatchObject({ issues: expected.error.issues }); expect(gate).not.toHaveBeenCalled();
});
it('retains issues spanning multiple invalid records without earlier page or answer errors', async () => {
  const input = source(); input.records[0]!.image = 'INVALID'; Object.assign(input.records[1]!.session.runs[0]!.outcome.candidate, { answer: 123 }); input.records[2]!.session.id = 'INVALID';
  const expected = BatchPrintSnapshotSchema.safeParse(input); if (expected.success) throw new Error('INVALID_FIXTURE_ACCEPTED'); expect(expected.error.issues.length).toBeGreaterThanOrEqual(3);
  const gate = vi.fn(() => { throw new Error('PAGE_LIMIT'); }); await expect(captured(input, true, async () => {}, gate)).rejects.toMatchObject({ issues: expected.error.issues }); expect(gate).not.toHaveBeenCalled();
});
it('checks projected subquestion count before extracting incomplete answers', async () => {
  const input = source(); input.records[2]!.session.runs = []; const failure = new Error('PAGE_GATE'); const gate = vi.fn(() => { throw failure; });
  await expect(captured(input, true, async () => {}, gate)).rejects.toBe(failure); expect(gate).toHaveBeenCalledExactlyOnceWith(3);
  await expect(captured(input, true, async () => {})).rejects.toThrow('完整已保存回答');
  expect((await captured(input, false, async () => {})).questions).toEqual([]);
});
it('gates subquestions instead of source records', async () => {
  const input = source(2, 3); const gate = vi.fn(); const output = await captured(input, true, async () => {}, gate);
  expect(gate).toHaveBeenCalledExactlyOnceWith(6); expect(output.problems.map(problem => problem.ordinal)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(output.questions.map(question => question.candidate.answer)).toEqual(['1', '2', '3', '1', '2', '3']);
});
it.each([false, true])('retains source/output errors before the page gate for large inputs (bad image: %s)', async badImage => {
  const input = badImage ? source(100, 4) : source(100, 3, 2); if (badImage) input.records[99]!.image = 'INVALID';
  let expected: unknown; try { projection.projectBatchPrintSnapshot(input, true); } catch (error) { expected = error; }
  if (typeof expected !== 'object' || expected === null) throw new Error('EXPECTED_SCHEMA_FAILURE'); expect(expected).toHaveProperty('issues');
  const gate = vi.fn(); await expect(captured(input, true, async () => {}, gate)).rejects.toMatchObject(expected); expect(gate).not.toHaveBeenCalled();
});
