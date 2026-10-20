import { describe, expect, it } from 'vitest';
import { BatchPrintLayoutInputSchema, BatchPrintLayoutSchema, parseBatchPrintLayout } from './batch-print-layout.js';
const ids = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'];
const problem = { text: '求 x+1=2 的解。', subject: 'math', uncertainties: [], options: [{ label: 'A', text: '1' }, { label: 'B', text: '2' }] };
const input = BatchPrintLayoutInputSchema.parse({ questions: [{ key: 'one', problem }, { key: 'two', problem }], sources: ids.map(id => ({ id, image: 'data:image/jpeg;base64,AQID' })) });
const result = () => ({ schemaVersion: 1, questions: input.questions.map(question => ({ ...question, sources: ids.map(id => ({ id, kind: 'text-only', rotation: 0, regions: [] })), warnings: [], confidence: .95 })) });
describe('batch print image layout', () => {
  it('bounds combined source bytes before dispatching a model request', () => {
    const image = 'data:image/jpeg;base64,' + 'A'.repeat(4 * 1024 * 1024);
    expect(BatchPrintLayoutInputSchema.safeParse({ questions: input.questions, sources: [1, 2, 3].map(index => ({ id: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`, image })) }).success).toBe(false);
  });
  it('allows text-only questions and restores trusted source/question order', () => {
    const value = result(); value.questions.reverse(); value.questions.forEach(question => question.sources.reverse());
    const parsed = parseBatchPrintLayout(value, input);
    expect(parsed.questions.map(question => question.key)).toEqual(['one', 'two']);
    expect(parsed.questions[0]?.sources.map(source => source.id)).toEqual(ids);
    expect(parsed.questions[0]?.sources.every(source => source.kind === 'text-only')).toBe(true);
  });
  it.each(['confidence', 'warning', 'uncertainty', 'options'])('retains every source for uncertain %s output', condition => {
    const value = result(); const question = value.questions[0]!;
    const changed = { ...question, ...(condition === 'confidence' ? { confidence: .89 } : condition === 'warning' ? { warnings: ['图边缘被遮挡'] } : { problem: { ...problem, uncertainties: ['选项难以辨认'], ...(condition === 'options' ? { optionsComplete: false } : {}) } }) };
    const parsed = parseBatchPrintLayout({ ...value, questions: [changed, value.questions[1]] }, input);
    expect(parsed.questions[0]?.sources.every(source => source.kind === 'retain-source' && !source.regions.length)).toBe(true);
    expect(parsed.questions[0]?.warnings.length).toBeGreaterThan(0);
  });
  it('keeps the reference question and originals if confident extraction loses known options', () => {
    const value = result();
    const changed = { ...value.questions[0], problem: { ...problem, options: undefined }, confidence: 1 };
    const parsed = parseBatchPrintLayout({ ...value, questions: [changed, value.questions[1]] }, input);
    expect(parsed.questions[0]?.problem.options).toEqual(problem.options);
    expect(parsed.questions[0]?.sources.every(source => source.kind === 'retain-source')).toBe(true);
    expect(parsed.questions[0]?.warnings.join('')).toContain('选项');
    expect(parsed.questions[1]?.sources.every(source => source.kind === 'text-only')).toBe(true);
  });
  it('cannot erase a known diagram with a text-only confidence claim', () => {
    const diagram = { id: 'graph', alt: '函数图', x: .1, y: .2, width: .4, height: .3 };
    const reference = { ...input, questions: [{ ...input.questions[0]!, problem: { ...problem, illustrations: [diagram] } }, input.questions[1]!] };
    const parsed = parseBatchPrintLayout(result(), reference);
    expect(parsed.questions[0]?.sources.every(source => source.kind === 'retain-source')).toBe(true);
    expect(parsed.questions[0]?.warnings.join('')).toContain('图示');
    const value = result();
    const withDiagram = { ...value.questions[0], sources: [{ id: ids[0], kind: 'illustrations', rotation: -3, regions: [{ ...diagram, role: 'question' }] }, value.questions[0]!.sources[1]] };
    expect(parseBatchPrintLayout({ ...value, questions: [withDiagram, value.questions[1]] }, reference).questions[0]?.sources[0]?.rotation).toBe(-3);
  });
  it('labels explicit source fallback and keeps warnings bounded', () => {
    const value = result();
    const retained = { ...value.questions[0], sources: value.questions[0]!.sources.map(source => ({ ...source, kind: 'retain-source', rotation: 0 })) };
    expect(parseBatchPrintLayout({ ...value, questions: [retained, value.questions[1]] }, input).questions[0]?.warnings.join('')).toContain('原图');
    const uncertain = { ...retained, confidence: .5, warnings: Array.from({ length: 8 }, (_, index) => `疑点 ${index}`) };
    const parsed = parseBatchPrintLayout({ ...value, questions: [uncertain, value.questions[1]] }, input);
    expect(BatchPrintLayoutSchema.safeParse(parsed).success).toBe(true);
    expect(parsed.questions[0]?.warnings).toHaveLength(8);
  });
  it('rejects missing, duplicate and foreign source or question IDs', () => {
    const value = result();
    for (const questions of [value.questions.slice(1), [value.questions[0], value.questions[0]], [{ ...value.questions[0], key: 'foreign' }, value.questions[1]], [{ ...value.questions[0], sources: value.questions[0]!.sources.slice(1) }, value.questions[1]], [{ ...value.questions[0], sources: [{ ...value.questions[0]!.sources[0], id: '10000000-0000-4000-8000-000000000003' }, value.questions[0]!.sources[1]] }, value.questions[1]]]) expect(() => parseBatchPrintLayout({ ...value, questions }, input)).toThrow();
  });
  it('validates image-option ownership, bounds and source-only pixels', () => {
    const region = { id: 'figureA', role: 'option', optionLabel: 'A', alt: '选项图', x: .1, y: .2, width: .4, height: .3 };
    const value = result(); const first = value.questions[0]!;
    const make = (image: object) => ({ ...value, questions: [{ ...first, sources: [{ id: ids[0], kind: 'illustrations', rotation: 3, regions: [image] }, first.sources[1]] }, value.questions[1]] });
    expect(BatchPrintLayoutSchema.safeParse(make(region)).success).toBe(true);
    for (const extra of [{ x: -.1 }, { x: .9 }, { optionLabel: 'C' }, { optionLabel: undefined }, { url: 'https://outside.invalid/diagram' }, { rotation: 4 }]) expect(BatchPrintLayoutSchema.safeParse(make({ ...region, ...extra })).success).toBe(false);
    expect(BatchPrintLayoutInputSchema.safeParse({ ...input, sources: Array.from({ length: 9 }, () => input.sources[0]) }).success).toBe(false);
  });
});
