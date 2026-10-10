import { expect, it } from 'vitest';
import { AnswerCandidateSchema } from './agent.js';
import { ChemistrySchema, formulaAtoms, reactionLatex } from './chemistry.js';
import { FigureSchema } from './figure.js';
import { answerText } from './choice-presentation.js';

const term = (formula: string, coefficient = 1, charge = 0) => ({ formula, coefficient, charge });
const water = { reactants: [term('H2', 2), term('O2')], products: [term('H2O', 2)], arrow: 'forward' };
it('checks molecular, ionic, hydrate and half-reaction conservation', () => {
  const reactions = [water,
    { reactants: [term('Fe', 1, 3), term('e', 1, -1)], products: [term('Fe', 1, 2)], arrow: 'equilibrium' },
    { reactants: [term('CuSO4·5H2O')], products: [term('CuSO4'), term('H2O', 5)], arrow: 'forward' },
  ];
  const result = ChemistrySchema.parse({ reactions });
  expect(reactionLatex(result.reactions[0]!)).toBe(String.raw`\ce{2H2 + O2 -> 2H2O}`);
  expect(Object.fromEntries(formulaAtoms('Al2(SO4)3'))).toEqual({ Al: 2, S: 3, O: 12 });
  for (const invalid of [
    { ...water, products: [term('H2O')] },
    { reactants: [term('Fe', 1, 3)], products: [term('Fe', 1, 2)], arrow: 'forward' },
    { ...water, reactants: [term('e', 1, 0)] },
  ]) expect(ChemistrySchema.safeParse({ reactions: [invalid] }).success).toBe(false);
});
it('rejects unsupported chemistry grammar and bounded-parser abuse', () => {
  for (const formula of ['', '2H2O', 'H0', 'Na+', 'Xx2', 'H2O)', '(H2O', '()', 'C1001', '(((((H)))))', 'H2O.', String.raw`\href{x}{H}`]) expect(() => formulaAtoms(formula)).toThrow();
});

const graph = {
  schemaVersion: 1, id: 'market', kind: 'coordinate', title: '供需均衡', description: 'P=10-Q 与 P=Q 在 (5,5) 相交。',
  purpose: 'economics', xRange: [0, 10], yRange: [0, 10], xLabel: 'Q (units)', yLabel: 'P ($/unit)',
  elements: [{ id: 'd', kind: 'polynomial', coefficients: [10, -1] }, { id: 's', kind: 'segment', from: [0, 0], to: [10, 10] },
    { id: 'e', kind: 'point', at: [5, 5] }, { id: 'cs', kind: 'polygon', points: [[0, 5], [0, 10], [5, 5]] }],
  checks: [{ kind: 'intersection', pointId: 'e', curveIds: ['d', 's'] }, { kind: 'polygon-area', polygonId: 'cs', expected: 12.5 }],
};
it('validates equilibrium and surplus area against the actual plotted elements', () => {
  expect(FigureSchema.safeParse(graph).success).toBe(true);
  expect(FigureSchema.safeParse({ ...graph, elements: graph.elements.map(item => item.id === 'e' ? { ...item, at: [5, 6] } : item) }).success).toBe(false);
  for (const checks of [
    [{ kind: 'point-on-curve', pointId: 'e', curveId: 'missing' }],
    [{ kind: 'intersection', pointId: 'e', curveIds: ['d', 'd'] }],
    [{ kind: 'polygon-area', polygonId: 'cs', expected: 25 }],
  ]) expect(FigureSchema.safeParse({ ...graph, checks }).success).toBe(false);
  expect(FigureSchema.safeParse({ ...graph, xLabel: undefined }).success).toBe(false);
});
it('rejects self-crossed regions and keeps unchecked legacy figures readable', () => {
  // Shoelace alone gives 2 for this crossed boundary; matching that number
  // still must not turn a self-intersecting region into a checked area.
  expect(FigureSchema.safeParse({ ...graph, checks: [{ kind: 'polygon-area', polygonId: 'cs', expected: 2 }], elements: graph.elements.map(item => item.id === 'cs' ? { ...item, points: [[0, 0], [4, 4], [0, 4], [3, 0]] } : item) }).success).toBe(false);
  expect(FigureSchema.safeParse({ ...graph, purpose: undefined, checks: undefined, elements: graph.elements.map(({ id: _id, ...rest }) => rest) }).success).toBe(true);
});
const essay = { schemaVersion: 1, kind: 'answer', problem: { text: 'Write an argument.', subject: 'writing', response: { type: 'essay', wordLimit: 750 }, uncertainties: [] }, answer: 'First paragraph.\n\nSecond paragraph.', writing: { mode: 'revision', title: 'A careful argument', feedback: [{ paragraph: 2, comment: 'Clarified the counterargument.' }] }, steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
it('keeps prose, title and feedback distinct and preserves them in text exports', () => {
  const candidate = AnswerCandidateSchema.parse(essay);
  expect(answerText(candidate)).toContain('第 2 段：Clarified');
  expect(answerText(candidate)).toContain('A careful argument');
  expect(AnswerCandidateSchema.safeParse({ ...essay, writing: { ...essay.writing, feedback: [{ paragraph: 3, comment: 'Not present' }] } }).success).toBe(false);
  expect(AnswerCandidateSchema.safeParse({ ...essay, writing: { mode: 'feedback' } }).success).toBe(false);
  expect(AnswerCandidateSchema.safeParse({ ...essay, problem: { ...essay.problem, response: { type: 'short-answer' } }, writing: { mode: 'feedback' } }).success).toBe(true);
  expect(AnswerCandidateSchema.safeParse({ ...essay, writing: undefined }).success).toBe(true);
});
