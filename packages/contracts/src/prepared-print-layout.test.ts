import { describe, expect, it } from 'vitest';
import { parsePreparedPrintRecord, PreparedPrintRecordSchema } from './prepared-print-layout.js';
import { parseBatchPrintLayout } from './batch-print-layout.js';

const sourceId = '10000000-0000-4000-8000-000000000001';
const problem = { text: 'Refer to the graph.', subject: 'math', uncertainties: ['Some options are cut off.'], optionsComplete: false };
const input = { purpose: 'reference' as const, questions: [{ key: 'record/single', problem }], sources: [{ id: sourceId, image: 'data:image/jpeg;base64,AQID' }] };
function record() { return { schemaVersion: 1, layouts: { 'record/single': { problem, assets: [{ key: 'figure', sourceId, role: 'question', alt: 'Graph' }], warnings: ['Check the missing choices.'] } }, images: { figure: 'data:image/jpeg;base64,AQID' }, sources: [{ key: 'figure', image: 'data:image/jpeg;base64,AQID', label: 'Original crop', region: true }], adjustments: { figure: { rotation: 0, crop: { left: 0, top: 0, right: 1, bottom: 1 }, enhance: true } } }; }
describe('persistent prepared paper contracts', () => {
  it('preserves the crop, warning and editable source without claiming a complete question', () => { const parsed = parsePreparedPrintRecord(record(), input); expect(parsed.layouts['record/single']?.problem.optionsComplete).toBe(false); expect(parsed.sources).toHaveLength(1); });
  it('rejects foreign questions, foreign sources and missing material', () => {
    expect(() => parsePreparedPrintRecord(record(), { ...input, questions: [{ key: 'foreign', problem }] })).toThrow();
    expect(() => parsePreparedPrintRecord(record(), { ...input, sources: [{ id: '10000000-0000-4000-8000-000000000002', image: 'data:image/jpeg;base64,AQID' }] })).toThrow();
    expect(() => parsePreparedPrintRecord({ ...record(), images: {} }, input)).toThrow();
  });
  it('rejects unrelated images and adjustments, duplicate assets and unknown option labels', () => {
    expect(() => parsePreparedPrintRecord({ ...record(), images: { ...record().images, extra: 'data:image/jpeg;base64,AQID' } }, input)).toThrow();
    expect(() => parsePreparedPrintRecord({ ...record(), adjustments: { other: record().adjustments.figure } }, input)).toThrow();
    const layout = record().layouts['record/single']; expect(PreparedPrintRecordSchema.safeParse({ ...record(), layouts: { 'record/single': { ...layout, assets: [...layout.assets, ...layout.assets] } } }).success).toBe(false);
    expect(PreparedPrintRecordSchema.safeParse({ ...record(), layouts: { 'record/single': { ...layout, assets: [{ ...layout.assets[0], role: 'option', optionLabel: 'A' }] } } }).success).toBe(false);
  });
  it('reference parsing keeps necessary figures and discloses partial text while exam parsing stays strict', () => {
    const result = { schemaVersion: 1, questions: [{ key: 'record/single', problem, warnings: ['Check missing choices.'], confidence: .8, sources: [{ id: sourceId, kind: 'illustrations', rotation: 0, regions: [{ id: 'graph', alt: 'Graph', role: 'question', x: .2, y: .2, width: .4, height: .4 }] }] }] };
    const reference = parseBatchPrintLayout(result, input); expect(reference.questions[0]?.sources[0]?.kind).toBe('illustrations'); expect(reference.questions[0]?.warnings.length).toBeGreaterThan(0);
    expect(parseBatchPrintLayout(result, { ...input, purpose: 'exam' }).questions[0]?.sources[0]?.kind).toBe('retain-source');
  });
  it('reference extraction still rejects a confident omission of existing choices or known diagrams', () => {
    const known = { ...problem, options: [{ label: 'A', text: '1' }], illustrations: [{ id: 'graph', alt: 'Graph', x: .2, y: .2, width: .4, height: .4 }] };
    const result = { schemaVersion: 1, questions: [{ key: 'record/single', problem: { text: 'Summary', subject: 'math', uncertainties: [] }, confidence: 1, warnings: [], sources: [{ id: sourceId, kind: 'text-only', rotation: 0, regions: [] }] }] };
    expect(parseBatchPrintLayout(result, { ...input, questions: [{ key: 'record/single', problem: known }] }).questions[0]?.sources[0]?.kind).toBe('retain-source');
  });
});
