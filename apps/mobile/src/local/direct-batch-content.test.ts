import { describe, expect, it } from 'vitest';
import { BatchPrintCopySchema, BatchPrintProblemSchema, BatchPrintQuestionSchema } from '@solveflow/contracts/local';
import { directBatchBlocks, directAnswerGroups } from './direct-batch-content';
import { directTextLines } from './direct-batch-pdf.web';
import { directNativeText } from './direct-pdf-resources.web';

const id = '11111111-1111-4111-8111-111111111111';
const problem = { text: '已解析 $x+1=3$\n第二行', subject: 'math', uncertainties: [], options: [{ label: 'A', text: '1' }, { label: 'B', text: '2' }] };
const problems = [1, 2].map(ordinal => BatchPrintProblemSchema.parse({ key: `q${ordinal}`, ordinal, recordId: id, problem }));
const questions = problems.map(({ problem: _problem, ...question }) => BatchPrintQuestionSchema.parse({ ...question, runId: null, candidate: null, baselineWrong: false, validOptions: [] }));
const layouts = Object.fromEntries(problems.map(question => [question.key, { problem: question.problem!, warnings: [], assets: [{ key: 'source', sourceId: id, role: 'source' as const, alt: '原图' }] }]));
const prepared = { layouts, images: { source: 'data:image/jpeg;base64,AQID' } };
const copy = BatchPrintCopySchema.parse({ copyIndex: 1, total: 2, correct: 1, incorrect: 1, answers: problems.map(question => ({ key: question.key, ordinal: question.ordinal, recordId: id, runId: null, answer: 'ANSWER_CANARY', selectedOptions: [question.ordinal === 1 ? 'A' : 'B'], incorrect: question.ordinal === 1, changed: question.ordinal === 1 })) });

describe('direct parsed content', () => {
  it('uses standard PDF text only for printable ASCII and keeps unsupported glyphs on the browser path', () => {
    expect(directNativeText('English (A), 1:8, 17.50 $x^2$')).toBe(true);
    for (const text of ['中文', 'α = 2', '“quoted”', 'café', '😀', 'A\tB', 'A\nB', '\u0001']) expect(directNativeText(text)).toBe(false);
  });
  it('keeps parsed text/options and each original image group once without reading answers in pure mode', () => {
    const blocks = directBatchBlocks({ mode: 'questions', title: '批次', problems, prepared });
    expect(blocks.filter(block => block.kind === 'image')).toHaveLength(1);
    expect(blocks).toContainEqual({ kind: 'text', text: problem.text });
    expect(JSON.stringify(blocks)).not.toContain('ANSWER_CANARY');
    expect(JSON.stringify(blocks)).not.toContain('作答：');
  });
  it('preserves planned choices and marks only the explicit incorrect item', () => {
    const blocks = directBatchBlocks({ mode: 'answers', title: '批次', problems, prepared, questions, copy, markIncorrect: true });
    expect(blocks.filter(block => block.kind === 'text' && block.heading && block.incorrect)).toHaveLength(1);
    expect(blocks).toContainEqual({ kind: 'text', text: '作答：（A）', incorrect: true, highlights: [{ start: 3, end: 6 }] });
    expect(JSON.stringify(directBatchBlocks({ mode: 'answers', title: '批次', problems, prepared, questions, copy }))).not.toContain('× 作答错误');
  });
  it('puts the copy-specific answer table first and anchors each source question without leaking into pure exports', () => {
    const sourceProblems = problems.map(question => ({ ...question, problem: { ...question.problem!, sourceNumber: `Item ${question.ordinal + 10}` } }));
    const sourceLayouts = Object.fromEntries(sourceProblems.map(question => [question.key, { ...layouts[question.key]!, problem: question.problem! }]));
    const blocks = directBatchBlocks({ mode: 'answers', title: '批次', problems: sourceProblems, prepared: { ...prepared, layouts: sourceLayouts }, questions, copy, markIncorrect: true });
    expect(blocks[2]).toMatchObject({ kind: 'answer-table', entries: [
      { key: 'q1', ordinal: 1, sourceNumber: 'Item 11', answer: '1', incorrect: true },
      { key: 'q2', ordinal: 2, sourceNumber: 'Item 12', answer: '2', incorrect: false },
    ] });
    expect(blocks.find(block => block.kind === 'text' && block.anchor?.key === 'q1')).toMatchObject({ text: '第 1 题（原题 Item 11）  × 作答错误', anchor: { key: 'q1', title: '第 1 题（原题 Item 11）' } });
    expect(directBatchBlocks({ mode: 'questions', title: '纯题', problems, prepared }).some(block => block.kind === 'answer-table')).toBe(false);
  });
  it('numbers summaries by original option order and groups them in fives without changing body letters', () => {
    const entries = Array.from({ length: 12 }, (_, index) => ({ key: `q${index + 1}`, ordinal: index + 1, answer: '4', incorrect: false }));
    expect(directAnswerGroups(entries).map(group => group.map(entry => entry.ordinal))).toEqual([[1, 2, 3, 4, 5], [6, 7, 8, 9, 10], [11, 12]]);
    const reordered = { ...problem, options: [{ label: 'F', text: 'one' }, { label: 'J', text: 'two' }, { label: 'A', text: 'three' }, { label: 'D', text: 'four' }] };
    const blocks = directBatchBlocks({ mode: 'answers', title: 'ACT', problems, prepared: { ...prepared, layouts: { ...layouts, q1: { ...layouts.q1!, problem: reordered } } }, questions, copy });
    expect(blocks[2]).toMatchObject({ kind: 'answer-table', entries: [{ answer: '3', choice: true }, { answer: '2', choice: true }] });
    expect(blocks).toContainEqual({ kind: 'text', text: '作答：（A）', incorrect: false, highlights: [{ start: 3, end: 6 }] });
  });
  it('highlights only selected labels, keeping the saved explanation and original punctuation unchanged', () => {
    const candidate = { schemaVersion: 1 as const, kind: 'answer' as const, problem, answer: 'Compare (A) and D in the original explanation.', selectedOptions: ['A'], steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
    const blocks = directBatchBlocks({ mode: 'answers', title: '批次', problems, prepared, questions: questions.map(question => ({ ...question, candidate })), copy: { ...copy, answers: copy.answers.map(answer => ({ ...answer, changed: false })) } });
    expect(blocks).toContainEqual({ kind: 'text', text: '作答：（A）\nCompare (A) and D in the original explanation.', incorrect: false, highlights: [{ start: 3, end: 6 }] });
  });
  it('does not present an unanswered or long free response as a highlighted choice in the table', () => {
    const blocks = directBatchBlocks({ mode: 'answers', title: '批次', problems, prepared, questions, copy: { ...copy, answers: copy.answers.map(answer => { const { selectedOptions: _options, ...rest } = answer; return { ...rest, answer: answer.ordinal === 1 ? '' : 'Long free response'.repeat(100) }; }) } });
    expect(blocks[2]).toMatchObject({ kind: 'answer-table', entries: [{ answer: '未保存作答', choice: false }, { answer: '见本题作答', choice: false }] });
  });
  it('reports a missing source instead of silently dropping a diagram', () => {
    expect(() => directBatchBlocks({ mode: 'questions', title: '批次', problems, prepared: { ...prepared, images: {} } })).toThrow('缺少保存的原题图');
  });
  it('keeps every character and explicit line break when wrapping CJK, emoji and long formula source', () => {
    const text = '中英文 mixed words 😀😃\n\\frac{a+b}{c+d}'.repeat(4);
    const lines = directTextLines(text, value => Array.from(value).length, 10);
    expect(lines.join('')).toBe(text.replaceAll('\n', ''));
    expect(lines.every(line => Array.from(line).length <= 10)).toBe(true);
    expect(lines.every(line => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(line))).toBe(true);
    expect(() => directTextLines('中', () => 20, 10)).toThrow('文字超出页宽');
  });
});
