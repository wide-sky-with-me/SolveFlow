import { afterEach, expect, it, vi } from 'vitest';
import { BatchPrintSnapshotSchema, LocalRecordSchema } from '@solveflow/contracts/local';
import * as projection from './batch-print-variants.js';

const at = '2026-10-19T00:00:00.000Z';
const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
function source(count = 3, sections = 1, runs = 1) {
  const batch = { id: id(1), title: '  Captured batch  ', exam: 'general', createdAt: at };
  const problem = { text: 'Synthetic problem', subject: 'math', uncertainties: [] as string[] };
  return { schemaVersion: 1, exportedAt: at, batch, records: Array.from({ length: count }, (_, index) => {
    const sessionId = id(index + 1000);
    return { schemaVersion: 1, image: 'data:image/jpeg;base64,AQID', batch: { ...batch, position: index + 1 },
      session: { schemaVersion: 1, id: sessionId, subject: 'math', createdAt: at,
        upload: { schemaVersion: 1, id: sessionId, mimeType: 'image/jpeg', bytes: 3, width: 30, height: 20, expiresAt: at, previewUrl: `/api/v1/uploads/${sessionId}/image` },
        runs: Array.from({ length: runs }, (_, run) => ({ schemaVersion: 1, id: id(2000 + index * 100 + run), sessionId, status: 'completed', message: '', seq: 1, createdAt: at,
          outcome: { schemaVersion: 1, status: 'completed', verified: false, verification: null, warning: null, verificationStatus: 'not_requested',
            candidate: { schemaVersion: 1, kind: 'answer', problem: structuredClone(problem), answer: 'PRIVATE_ANSWER', steps: [], knowledgePoints: [], clarificationQuestions: [], citationIds: [],
              ...(sections > 1 ? { questions: Array.from({ length: sections }, (_, number) => ({ number: number + 1, answer: String(number), problem: structuredClone(problem), stepIds: [], figureIds: [] })) } : {}) } } })) } };
  }) };
}
const capturedQuestions = projection.questionsForCapturedBatchQuestionPrint;
afterEach(() => vi.restoreAllMocks());

it('exports a fully validating captured-only entry rather than a trusted typed shortcut', () => {
  expect(projection.questionsForCapturedBatchQuestionPrint).toBeTypeOf('function');
});

it('yields before every record and validates each image-bearing record once on success', async () => {
  const input = source(); const before = structuredClone(input);
  const expected = projection.questionsForBatchQuestionPrint(input);
  const record = vi.spyOn(LocalRecordSchema, 'safeParse');
  const whole = vi.spyOn(BatchPrintSnapshotSchema, 'parse');
  const seen: number[] = [];
  const turn = vi.fn(async () => { seen.push(record.mock.calls.length); });
  const output = await capturedQuestions(input, turn);
  expect(seen).toEqual([0, 1, 2]); expect(turn).toHaveBeenCalledTimes(3);
  expect(record).toHaveBeenCalledTimes(3); expect(whole).not.toHaveBeenCalled();
  expect(output).toEqual(expected); expect(input).toStrictEqual(before);
  expect(JSON.stringify(output)).not.toContain('PRIVATE_ANSWER');
});

it.each([1, 2, 3])('stops before parsing record %i when the scheduling callback cancels', async stop => {
  const input = source(); const reason = new Error('CANCELLED_AT_RECORD');
  const parse = vi.spyOn(LocalRecordSchema, 'safeParse'); let calls = 0;
  await expect(capturedQuestions(input, async () => { if (++calls === stop) throw reason; })).rejects.toBe(reason);
  expect(calls).toBe(stop); expect(parse).toHaveBeenCalledTimes(stop - 1);
});

it('keeps a private capture isolated from later edits to its original caller', async () => {
  const caller = source(); const owned = structuredClone(caller); const expected = projection.questionsForBatchQuestionPrint(owned);
  const turn = vi.fn(async () => {
    caller.batch.title = 'CALLER'; caller.records[2]!.image = 'INVALID';
    caller.records[2]!.session.runs[0]!.outcome.candidate.problem.uncertainties.push('CALLER');
  });
  const output = await capturedQuestions(owned, turn);
  expect(output).toEqual(expected); expect(owned.batch.title).toBe('  Captured batch  ');
  output[0]?.problem?.uncertainties.push('RENDERER');
  expect(owned.records[0]!.session.runs[0]!.outcome.candidate.problem.uncertainties).toEqual([]);
});

type Input = ReturnType<typeof source>;
const invalidCases: Array<[string, (input: Input) => void]> = [
  ['late image', input => { input.records[2]!.image = 'data:image/jpeg;base64,A\n'; }],
  ['metadata', input => { input.records[1]!.session.id = 'invalid'; }],
  ['answer', input => { Object.assign(input.records[1]!.session.runs[0]!.outcome.candidate, { answer: 123 }); }],
  ['root unknown key', input => { Object.assign(input, { extra: true }); }],
  ['record unknown key', input => { Object.assign(input.records[1]!, { extra: true }); }],
  ['wrong owner', input => { input.records[2]!.batch.id = id(9); }],
  ['duplicate session', input => { input.records[1]!.session = structuredClone(input.records[0]!.session); }],
  ['duplicate position', input => { input.records[2]!.batch.position = 1; }],
  ['material image', input => { Object.assign(input.records[1]!, { materials: [{ id: id(9000), width: 30, height: 20, bytes: 3, image: 'INVALID' }] }); }],
  ['missing selected material', input => { Object.assign(input.records[1]!, { activeImageIds: [id(9000)] }); }],
  ['empty records', input => { input.records = []; }],
  ['record limit', input => { input.records = source(101).records; }],
];
it.each(invalidCases)('retains complete original issues for %s', async (_name, alter) => {
  const input = source(); alter(input); const expected = BatchPrintSnapshotSchema.safeParse(input);
  if (expected.success) throw new Error('INVALID_FIXTURE_ACCEPTED');
  await expect(capturedQuestions(input, async () => {})).rejects.toMatchObject({ issues: expected.error.issues });
});

it('preserves issues spanning multiple invalid records in original order', async () => {
  const input = source(); input.records[0]!.image = 'INVALID';
  Object.assign(input.records[1]!.session.runs[0]!.outcome.candidate, { answer: 123 }); input.records[2]!.session.id = 'INVALID';
  const expected = BatchPrintSnapshotSchema.safeParse(input); if (expected.success) throw new Error('INVALID_FIXTURE_ACCEPTED');
  expect(expected.error.issues.length).toBeGreaterThanOrEqual(3);
  await expect(capturedQuestions(input, async () => {})).rejects.toMatchObject({ issues: expected.error.issues });
});

it('preserves one ownership issue per conflicting record and original issue order', async () => {
  const input = source(); input.records[1]!.session = structuredClone(input.records[0]!.session); input.records[1]!.batch.position = 1; input.records[2]!.batch.id = id(9);
  const expected = BatchPrintSnapshotSchema.safeParse(input); if (expected.success) throw new Error('INVALID_FIXTURE_ACCEPTED');
  expect(expected.error.issues).toHaveLength(2);
  await expect(capturedQuestions(input, async () => {})).rejects.toMatchObject({ issues: expected.error.issues });
});

it('retains material validation and cross-record ownership without a second image scan on success', async () => {
  const input = source(1);
  Object.assign(input.records[0]!, { materials: [{ id: id(9000), width: 30, height: 20, bytes: 3, image: 'data:image/jpeg;base64,AQID' }], activeImageIds: [id(1000), id(9000)] });
  const expected = projection.questionsForBatchQuestionPrint(input);
  const whole = vi.spyOn(BatchPrintSnapshotSchema, 'parse');
  expect(await capturedQuestions(input, async () => {})).toEqual(expected); expect(whole).not.toHaveBeenCalled();
});

it('keeps full source errors ahead of page limits even when early records already exceed 300', async () => {
  const input = source(100, 4); input.records[99]!.image = 'INVALID';
  const expected = BatchPrintSnapshotSchema.safeParse(input); if (expected.success) throw new Error('INVALID_FIXTURE_ACCEPTED');
  const pageGate = vi.fn((count: number) => { if (count > 300) throw new Error('PAGE_LIMIT'); });
  const pending = capturedQuestions(input, async () => {}).then(problems => pageGate(problems.length));
  await expect(pending).rejects.toMatchObject({ issues: expected.error.issues }); expect(pageGate).not.toHaveBeenCalled();
});

it('preserves the output schema limit before the caller page gate', async () => {
  const input = source(100, 3, 2); expect(BatchPrintSnapshotSchema.safeParse(input).success).toBe(true);
  let expected: unknown; try { projection.questionsForBatchQuestionPrint(input); } catch (error) { expected = error; }
  if (typeof expected !== 'object' || expected === null) throw new Error('EXPECTED_OUTPUT_SCHEMA_FAILURE');
  expect(expected).toHaveProperty('issues');
  const pageGate = vi.fn();
  const pending = capturedQuestions(input, async () => {}).then(problems => pageGate(problems.length));
  await expect(pending).rejects.toMatchObject(expected); expect(pageGate).not.toHaveBeenCalled();
});

const collectedQuestions = projection.questionsForCollectedBatchQuestionPrint;
it('exports a collected-data preflight without changing the generic synchronous entry', () => {
  expect(projection.questionsForCollectedBatchQuestionPrint).toBeTypeOf('function');
});
it('captures all metadata before yielding without native cloning or an early image scan', async () => {
  const input = source(); const expected = projection.questionsForBatchQuestionPrint(input);
  input.records[1]!.session.runs[0]!.outcome.candidate.problem = input.records[0]!.session.runs[0]!.outcome.candidate.problem;
  const native = vi.spyOn(globalThis, 'structuredClone'); const whole = vi.spyOn(BatchPrintSnapshotSchema, 'parse');
  const records = vi.spyOn(LocalRecordSchema, 'safeParse'); const seen: number[] = [];
  const output = await collectedQuestions(input, async () => {
    seen.push(records.mock.calls.length); input.batch.title = 'EDITED'; input.records[2]!.image = 'INVALID';
    input.records[0]!.session.runs[0]!.outcome.candidate.problem.uncertainties.push('EDITED'); Object.assign(input, { extra: true });
  });
  expect(output).toEqual(expected); expect(seen).toEqual([0, 1, 2]); expect(native).not.toHaveBeenCalled(); expect(whole).not.toHaveBeenCalled();
  expect(records).toHaveBeenCalledTimes(3);
  const first = records.mock.calls[0]?.[0]; const second = records.mock.calls[1]?.[0];
  expect(first).not.toBe(input.records[0]); expect(first).toHaveProperty('batch.title', '  Captured batch  ');
  const problemOf = (input: unknown): unknown => {
    let value: unknown = input;
    for (const key of ['session', 'runs', '0', 'outcome', 'candidate', 'problem']) {
      if (typeof value !== 'object' || value === null) throw new Error('RECORD_CALL_MISSING');
      value = Reflect.get(value, key);
    }
    return value;
  };
  expect(problemOf(first)).toBe(problemOf(second));
  expect(problemOf(first)).not.toBe(input.records[0]!.session.runs[0]!.outcome.candidate.problem);
});
it.each([1, 2, 3])('cancels collected preflight before record %i', async stop => {
  const input = source(); const reason = new Error('PREFLIGHT_CANCELLED'); let turns = 0;
  const records = vi.spyOn(LocalRecordSchema, 'safeParse');
  await expect(collectedQuestions(input, async () => { if (++turns === stop) throw reason; })).rejects.toBe(reason);
  expect(records).toHaveBeenCalledTimes(stop - 1);
});
it.each(invalidCases)('keeps complete collected-input issues for %s', async (_name, alter) => {
  const input = source(); alter(input); const expected = BatchPrintSnapshotSchema.safeParse(input);
  if (expected.success) throw new Error('INVALID_FIXTURE_ACCEPTED');
  await expect(collectedQuestions(input, async () => {})).rejects.toMatchObject({ issues: expected.error.issues });
});
it('uses only the private preflight view for the complete invalid fallback', async () => {
  const input = source(); input.records[1]!.image = 'INVALID'; const expected = BatchPrintSnapshotSchema.safeParse(input);
  if (expected.success) throw new Error('INVALID_FIXTURE_ACCEPTED');
  await expect(collectedQuestions(input, async () => {
    input.records[1]!.image = 'data:image/jpeg;base64,AQID'; input.records[2]!.session.id = 'CHANGED';
  })).rejects.toMatchObject({ issues: expected.error.issues });
});
it('leaves accessor observations on the original synchronous preflight path', async () => {
  const input = source(1); const image = input.records[0]!.image; let reads = 0;
  Object.defineProperty(input.records[0], 'image', { enumerable: true, get() { reads++; return image; } });
  const expected = projection.questionsForBatchQuestionPrint(input); const expectedReads = reads; reads = 0;
  const turn = vi.fn(async () => {}); expect(await collectedQuestions(input, turn)).toEqual(expected);
  expect(reads).toBe(expectedReads); expect(turn).not.toHaveBeenCalled();
});
it('leaves inherited fields on the original synchronous preflight path', async () => {
  const input = source(1); const record = input.records[0]!; const image = record.image;
  const inherited = { ...record }; Reflect.deleteProperty(inherited, 'image'); Object.setPrototypeOf(inherited, { image });
  input.records[0] = inherited; const expected = projection.questionsForBatchQuestionPrint(input); const turn = vi.fn(async () => {});
  expect(await collectedQuestions(input, turn)).toEqual(expected); expect(turn).not.toHaveBeenCalled();
});
it('falls back without a new product limit when metadata exceeds the view budget', async () => {
  const input = source(); Object.assign(input, { extra: Array.from({ length: 10001 }, () => ({})) });
  const expected = BatchPrintSnapshotSchema.safeParse(input); if (expected.success) throw new Error('INVALID_FIXTURE_ACCEPTED');
  const turn = vi.fn(async () => {}); await expect(collectedQuestions(input, turn)).rejects.toMatchObject({ issues: expected.error.issues }); expect(turn).not.toHaveBeenCalled();
});
it('does not erase an own __proto__ key during preflight isolation', async () => {
  const input = source(); Object.defineProperty(input.records[1], '__proto__', { value: { marker: true }, enumerable: true });
  const expected = BatchPrintSnapshotSchema.safeParse(input); if (expected.success) throw new Error('INVALID_FIXTURE_ACCEPTED');
  await expect(collectedQuestions(input, async () => {})).rejects.toMatchObject({ issues: expected.error.issues });
});
it.each(['hidden', 'sparse', 'native', 'symbol', 'cycle', 'depth', 'properties'])('retains synchronous semantics for unsupported view shape %s', async kind => {
  const input = source(1);
  if (kind === 'hidden') Object.defineProperty(input.records[0], 'image', { value: input.records[0]!.image, enumerable: false });
  if (kind === 'sparse') Reflect.deleteProperty(input.records, '0');
  if (kind === 'native') input.records[0] = Object.assign(new Date(0), input.records[0]);
  if (kind === 'symbol') Object.assign(input, { extra: Symbol() });
  if (kind === 'cycle') { const extra: { self?: unknown } = {}; extra.self = extra; Object.assign(input, { extra }); }
  if (kind === 'depth') { let extra: object = {}; for (let index = 0; index < 70; index++) extra = { next: extra }; Object.assign(input, { extra }); }
  if (kind === 'properties') Object.assign(input, { extra: Object.fromEntries(Array.from({ length: 100001 }, (_, index) => [String(index), 0])) });
  const expected = BatchPrintSnapshotSchema.safeParse(input); const turn = vi.fn(async () => {});
  if (expected.success) expect(await collectedQuestions(input, turn)).toEqual(projection.questionsForBatchQuestionPrint(input));
  else await expect(collectedQuestions(input, turn)).rejects.toMatchObject({ issues: expected.error.issues });
  expect(turn).not.toHaveBeenCalled();
});

it.each([false, true])('keeps complete collected source/output errors ahead of the page gate: %s', async badImage => {
  const input = badImage ? source(100, 4) : source(100, 3, 2);
  if (badImage) input.records[99]!.image = 'INVALID';
  let expected: unknown; try { projection.questionsForBatchQuestionPrint(input); } catch (error) { expected = error; }
  if (typeof expected !== 'object' || expected === null) throw new Error('EXPECTED_SCHEMA_FAILURE');
  expect(expected).toHaveProperty('issues'); const page = vi.fn();
  await expect(collectedQuestions(input, async () => {}).then(problems => page(problems.length))).rejects.toMatchObject(expected);
  expect(page).not.toHaveBeenCalled();
});

it('accepts a business-valid metadata graph through the synchronous budget fallback', async () => {
  const input = source(100, 1, 3);
  for (const [index, record] of input.records.entries()) {
    Object.assign(record, { activeImageIds: [record.session.upload.id], materials: Array.from({ length: 63 }, (_, number) => ({ id: id(1000000 + index * 100 + number), width: 30, height: 20, bytes: 3, image: 'data:image/jpeg;base64,AQID' })) });
    for (const run of record.session.runs) Object.assign(run.outcome.candidate, { steps: [1, 2].map(number => ({ id: `step-${number}`, title: 'Step', explanation: 'Synthetic explanation' })) });
  }
  expect(BatchPrintSnapshotSchema.safeParse(input).success).toBe(true);
  // Unscoped single-question history shares one thread per record, not one per run.
  expect(input.records.flatMap(record => record.session.runs)).toHaveLength(300);
  const expected = projection.questionsForBatchQuestionPrint(input); expect(expected).toHaveLength(100);
  const turn = vi.fn(async () => {}); const whole = vi.spyOn(BatchPrintSnapshotSchema, 'parse');
  expect(await collectedQuestions(input, turn)).toEqual(expected); expect(turn).not.toHaveBeenCalled(); expect(whole).toHaveBeenCalledTimes(1);
});
