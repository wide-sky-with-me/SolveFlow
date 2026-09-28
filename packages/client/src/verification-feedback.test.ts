import { expect, it } from 'vitest';
import { SolveOutcomeSchema } from '@solveflow/contracts/agent';
import { verificationFeedback } from './verification-feedback.js';
const candidate = { schemaVersion: 1, kind: 'answer', problem: { text: 'Find x.', subject: 'math', uncertainties: [] }, answer: '2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
const result = (extra: object) => SolveOutcomeSchema.parse({ schemaVersion: 1, status: 'completed', candidate, verified: false, verification: null, warning: 'MODEL_TIMEOUT', ...extra });
it('distinguishes an unfinished verifier from an incorrect answer, using recorded causes only', () => {
  expect(verificationFeedback(result({}))).toMatchObject({ title: '校验超时', issues: [] });
  expect(verificationFeedback(result({ warning: 'MODEL_OUTPUT_INVALID' }))).toMatchObject({ title: '校验结果无法读取', issues: [] });
  expect(verificationFeedback(result({ warning: null, verificationStatus: 'not_requested' }))).toBeNull();
});
it('shows the actual issue, category and actionable advice for fail and unknown', () => {
  for (const verdict of ['fail', 'unknown']) {
    const feedback = verificationFeedback(result({ warning: null, verification: { schemaVersion: 1, verdict, checked: ['transcription'], issues: [{ code: 'TRANSCRIPTION', message: '第二行分母无法区分 3 和 8。' }] } }));
    expect(feedback?.issues).toEqual([{ label: '题目识别', message: '第二行分母无法区分 3 和 8。' }]);
    expect(feedback?.next).toContain('更正题干');
    expect(feedback?.title).toBe(verdict === 'fail' ? '校验发现疑点' : '校验无法确认');
  }
});
it('keeps a saved pass when a separate verification request fails and explains that request', () => {
  const passed = result({ verified: true, warning: null, verification: { schemaVersion: 1, verdict: 'pass', checked: ['transcription'], issues: [] } });
  expect(verificationFeedback(passed)).toBeNull();
  expect(verificationFeedback(passed, 'MODEL_TIMEOUT')?.title).toBe('校验超时');
});
