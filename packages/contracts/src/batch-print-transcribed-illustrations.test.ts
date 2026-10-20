import { expect, it } from 'vitest';
import { BatchPrintLayoutSchema, parseBatchPrintLayout } from './batch-print-layout.js';

const sourceId = '10000000-0000-4000-8000-000000000001';
const table = '| Row | glucose | water |\n| --- | --- | --- |\n| A | no entry | enters |\n| B | enters | leaves |';
const problem = { text: `Which row is correct?\n\n${table}`, subject: 'biology', options: [{ label: 'A', text: 'no entry; enters' }, { label: 'B', text: 'enters; leaves' }], optionsComplete: true, uncertainties: [] };
const illustration = { id: 'table', alt: 'Original table hint', x: .1, y: .3, width: .6, height: .3 };
const original = { ...problem, illustrations: [illustration] };
const input = { questions: [{ key: 'q1', problem: original }], sources: [{ id: sourceId, image: 'data:image/jpeg;base64,AQID' }] };
const output = { schemaVersion: 1, questions: [{ key: 'q1', problem, sources: [{ id: sourceId, kind: 'text-only', rotation: 0, regions: [] }], warnings: [], confidence: .99, illustrationDispositions: [{ id: 'table', kind: 'table', content: table }] }] };

it.each(['exam', 'reference'] as const)('omits a fully transcribed redundant table without restoring the photo for %s', purpose => {
  const checked = { ...input, purpose };
  const first = parseBatchPrintLayout(output, checked);
  expect(first.questions[0]?.sources[0]?.kind).toBe('text-only');
  expect(first.questions[0]?.problem).toEqual(problem);
  expect(first.questions[0]?.warnings).toEqual([]);
  expect(parseBatchPrintLayout(first, checked)).toEqual(first);
});
it('accepts explicitly transcribed text while keeping the original record untouched', () => {
  const before = JSON.stringify(input);
  const plain = { ...problem, text: 'Choose the correct statement. Statement one. Statement two.' };
  const checked = { ...input, questions: [{ key: 'q1', problem: { ...plain, illustrations: [illustration] } }] };
  const parsed = parseBatchPrintLayout({ ...output, questions: [{ ...output.questions[0], problem: plain, illustrationDispositions: [{ id: 'table', kind: 'text', content: plain.text }] }] }, checked);
  expect(parsed.questions[0]?.sources[0]?.kind).toBe('text-only');
  expect(JSON.stringify(input)).toBe(before);
});
it('keeps the legacy missing-diagram guard when no explicit transcription covers the old hint', () => {
  const { illustrationDispositions: _proof, ...question } = output.questions[0]!;
  const parsed = parseBatchPrintLayout({ ...output, questions: [question] }, input);
  expect(parsed.questions[0]?.sources[0]?.kind).toBe('retain-source');
  expect(parsed.questions[0]?.problem).toEqual(original);
  expect(parsed.questions[0]?.warnings.join('')).toContain('遗漏已有图示');
});
it('does not let a transcribed table or an unrelated crop cover another necessary diagram', () => {
  const checked = { ...input, questions: [{ key: 'q1', problem: { ...original, illustrations: [illustration, { ...illustration, id: 'curve', alt: 'Necessary curve' }] } }] };
  expect(parseBatchPrintLayout(output, checked).questions[0]?.sources[0]?.kind).toBe('retain-source');
  const sources = [{ id: sourceId, kind: 'illustrations', rotation: 0, regions: [{ ...illustration, id: 'unrelated', role: 'question' }] }];
  expect(parseBatchPrintLayout({ ...output, questions: [{ ...output.questions[0], sources }] }, checked).questions[0]?.sources[0]?.kind).toBe('retain-source');
});
it('keeps only the necessary crop in a mixed text-table and diagram question', () => {
  const checked = { ...input, questions: [{ key: 'q1', problem: { ...original, illustrations: [illustration, { ...illustration, id: 'curve' }] } }] };
  const value = { ...output, questions: [{ ...output.questions[0], sources: [{ id: sourceId, kind: 'illustrations', rotation: 0, regions: [{ ...illustration, id: 'new-curve', role: 'question' }] }], illustrationDispositions: [...output.questions[0]!.illustrationDispositions, { id: 'curve', kind: 'crop', sourceId, regionId: 'new-curve' }] }] };
  const parsed = parseBatchPrintLayout(value, checked);
  expect(parsed.questions[0]?.sources[0]?.regions).toHaveLength(1);
  expect(parsed.questions[0]?.sources[0]?.regions[0]?.id).toBe('new-curve');
  expect(parseBatchPrintLayout(parsed, checked)).toEqual(parsed);
});
it.each(['unknown-id', 'duplicate-id', 'unprinted-content', 'broken-table', 'table-without-data', 'flattened-rendering', 'missing-region', 'missing-source'])('rejects invalid disposition evidence: %s', kind => {
  const evidence = kind === 'unknown-id' ? [{ id: 'other', kind: 'table', content: table }]
    : kind === 'duplicate-id' ? [output.questions[0]!.illustrationDispositions[0], output.questions[0]!.illustrationDispositions[0]]
    : kind === 'missing-region' ? [{ id: 'table', kind: 'crop', sourceId, regionId: 'absent' }]
    : kind === 'missing-source' ? [{ id: 'table', kind: 'source', sourceId: '20000000-0000-4000-8000-000000000001' }]
    : [{ id: 'table', kind: 'table', content: kind === 'unprinted-content' ? table.replace('no entry', 'not printed') : kind === 'broken-table' ? table.replace('| --- | --- | --- |', '| --- | --- |') : kind === 'table-without-data' ? table.split('\n').slice(0, 2).join('\n') : table }];
  const value = { ...output, questions: [{ ...output.questions[0], problem: kind === 'flattened-rendering' ? { ...problem, text: problem.text.replaceAll('\n', ' ') } : problem, illustrationDispositions: evidence }] };
  expect(() => parseBatchPrintLayout(value, input)).toThrow();
});
it('keeps confidence and option gates and removes stale disposition references on fallback', () => {
  const uncertain = { ...output, questions: [{ ...output.questions[0], confidence: .6 }] };
  const parsed = parseBatchPrintLayout(uncertain, input);
  expect(parsed.questions[0]?.sources[0]?.kind).toBe('retain-source');
  expect(parsed.questions[0]?.illustrationDispositions).toBeUndefined();
  expect(() => parseBatchPrintLayout(parsed, input)).not.toThrow();
  const incomplete = { ...output, questions: [{ ...output.questions[0], problem: { ...problem, optionsComplete: false, uncertainties: ['Missing option.'] } }] };
  expect(parseBatchPrintLayout(incomplete, input).questions[0]?.sources[0]?.kind).toBe('retain-source');
  const omitted = { ...output, questions: [{ ...output.questions[0], problem: { ...problem, text: `Re-read wording.\n\n${table}`, options: undefined } }] };
  const restored = parseBatchPrintLayout(omitted, input);
  expect(restored.questions[0]?.problem).toEqual(original);
  expect(restored.questions[0]?.illustrationDispositions).toBeUndefined();
  expect(() => parseBatchPrintLayout(restored, input)).not.toThrow();
});
it('continues to reject foreign sources even when transcription evidence is valid', () => {
  const value = { ...output, questions: [{ ...output.questions[0], sources: [{ ...output.questions[0]!.sources[0], id: '20000000-0000-4000-8000-000000000001' }] }] };
  expect(() => parseBatchPrintLayout(value, input)).toThrow();
  expect(BatchPrintLayoutSchema.safeParse(output).success).toBe(true);
});
it.each(['corner', 'all'] as const)('preserves legitimate empty %s header cells without inventing labels or adding a photo', header => {
  const faithful = table.replace('| Row | glucose | water |', header === 'corner' ? '| | glucose | water |' : '| | | |');
  const value = { ...output, questions: [{ ...output.questions[0], problem: { ...problem, text: `Which row is correct?\n\n${faithful}` }, illustrationDispositions: [{ id: 'table', kind: 'table', content: faithful }] }] };
  const parsed = parseBatchPrintLayout(value, input);
  expect(parsed.questions[0]?.sources[0]?.kind).toBe('text-only');
  expect(parsed.questions[0]?.problem.text).toContain(faithful);
  expect(parseBatchPrintLayout(parsed, input)).toEqual(parsed);
});
