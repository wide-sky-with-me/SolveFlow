import { describe, expect, it } from 'vitest';
import { RunViewSchema } from '@solveflow/contracts/http';
import { answerValue, questionOverviewItem } from './answer-preview.js';

const baseRun = {
  schemaVersion: 1 as const,
  id: '00000000-0000-4000-8000-000000000001',
  sessionId: '00000000-0000-4000-8000-000000000010',
  message: '',
  createdAt: '2026-11-18T10:00:00.000Z',
  seq: 1,
};

describe('answerValue and questionOverviewItem', () => {
  it('extracts structured responseValue, labelled conclusions, and compact values without guessing from prose', () => {
    expect(answerValue({ answer: '解析过程', responseValue: '-3/2' })).toBe('-3/2');
    expect(answerValue({ answer: '由面积公式计算。\n**结果：29**' })).toBe('29');
    expect(answerValue({ answer: 'chlorophyll' })).toBe('chlorophyll');
    expect(answerValue({ answer: '因为判别式大于零，所以方程有两个不相等的实数根，需要结合区间继续讨论。' })).toBeNull();
  });

  it('distinguishes verified, pending verification, explicit fail verdict, active solving, and unanswered states', () => {
    expect(questionOverviewItem([])).toMatchObject({ tone: 'unanswered', phaseLabel: '未答', answer: null });
    expect(questionOverviewItem([], true)).toMatchObject({ tone: 'processing', phaseLabel: '等待中', answer: null });

    const solving = RunViewSchema.parse({ ...baseRun, status: 'solving', outcome: null });
    expect(questionOverviewItem([solving])).toMatchObject({ tone: 'processing', phaseLabel: '答题中', answer: null });

    const pendingChoice = RunViewSchema.parse({
      ...baseRun,
      status: 'verifying',
      outcome: {
        schemaVersion: 1,
        status: 'completed',
        verified: false,
        warning: null,
        verification: null,
        verificationStatus: 'pending',
        candidate: {
          schemaVersion: 1,
          kind: 'answer',
          problem: { text: 'Choose one.', subject: 'english', uncertainties: [], options: [{ label: 'A', text: '1' }, { label: 'B', text: '2' }] },
          selectedOptions: ['B'],
          answer: '选 B',
          steps: [],
          knowledgePoints: [],
          citationIds: [],
          clarificationQuestions: [],
        },
      },
    });
    expect(questionOverviewItem([pendingChoice])).toMatchObject({ state: 'answered', tone: 'answered', phaseLabel: '校验中', answer: 'B', excerpt: false });

    if (pendingChoice.outcome?.status !== 'completed') throw new Error('EXPECTED_COMPLETED');
    const explicitFail = RunViewSchema.parse({
      ...pendingChoice,
      status: 'completed',
      outcome: {
        ...pendingChoice.outcome,
        verificationStatus: undefined,
        verification: { schemaVersion: 1, verdict: 'fail', checked: ['transcription', 'logic'], issues: [{ code: 'ARITHMETIC', basis: '原图 2+3', message: '应为 5' }] },
      },
    });
    expect(questionOverviewItem([explicitFail])).toMatchObject({ state: 'answered', tone: 'failed', phaseLabel: '有疑点', answer: 'B' });

    const passedNumeric = RunViewSchema.parse({
      ...pendingChoice,
      status: 'completed',
      outcome: {
        ...pendingChoice.outcome,
        verified: true,
        verificationStatus: undefined,
        verification: { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'logic'], issues: [] },
        candidate: {
          ...pendingChoice.outcome.candidate,
          problem: { text: 'Find discriminant.', subject: 'math', uncertainties: [] },
          selectedOptions: undefined,
          responseValue: '29',
          answer: '判别式计算得 29。',
        },
      },
    });
    expect(questionOverviewItem([passedNumeric])).toMatchObject({ state: 'verified', tone: 'verified', phaseLabel: '通过', answer: '29', excerpt: false });
  });
});
