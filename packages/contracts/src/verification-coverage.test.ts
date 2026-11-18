import { expect, it } from 'vitest';
import { assessVerificationCoverage, GeneratedVerificationSchema, VerificationSchema, verificationIssueCode, verificationIssueText } from './agent.js';

const pass = { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'logic'], issues: [] };
const item = { questionNumber: 1, partLabel: '(a)', verdict: 'pass', checked: ['transcription', 'arithmetic'] };
it('round-trips new per-part coverage while keeping legacy verification readable', () => {
  const current = { ...pass, coverage: [item] };
  expect(VerificationSchema.parse(JSON.parse(JSON.stringify(current)))).toEqual(current);
  expect(VerificationSchema.parse(pass)).toEqual(pass);
});
it.each([
  { coverage: Array.from({ length: 49 }, () => item) },
  { coverage: [{ ...item, questionNumber: 0 }] },
  { coverage: [{ ...item, partLabel: '' }] },
  { coverage: [{ ...item, checked: ['transcription', 'transcription'] }] },
  { coverage: [{ ...item, verdict: 'certain' }] },
  { coverage: [{ ...item, rawReasoning: 'private' }] },
])('rejects malformed or unbounded coverage: %j', patch => {
  expect(VerificationSchema.safeParse({ ...pass, ...patch }).success).toBe(false);
});

it('requires distinct evidence and consequence for new findings and preserves old records', () => {
  const issue = { code: 'LOGIC', message: 'The conclusion excludes a possible common cause.' };
  const review = { ...pass, verdict: 'fail', issues: [issue] };
  expect(VerificationSchema.safeParse(review).success).toBe(true);
  expect(GeneratedVerificationSchema.safeParse(review).success).toBe(false);
  expect(GeneratedVerificationSchema.safeParse({ ...review, issues: [{ ...issue, basis: issue.message }] }).success).toBe(false);
  expect(GeneratedVerificationSchema.safeParse({ ...review, issues: [{ ...issue, basis: 'Both groups had the same limited water supply.' }] }).success).toBe(true);
});
it('distinguishes a saved coverage mismatch from an actual missing passage', () => {
  expect(verificationIssueCode({ code: 'INSUFFICIENT_EVIDENCE', message: '逐题或逐小问核验与候选的题号、原小问标签不完整对应，尚不能确认全部作答正确。' })).toBe('REVIEW_INCOMPLETE');
  expect(verificationIssueCode({ code: 'INSUFFICIENT_EVIDENCE', message: '请补拍 Passage A 的末段。' })).toBe('INSUFFICIENT_EVIDENCE');
});

it('keeps a concrete request for missing information out of wrong-answer correction', () => {
  const review = VerificationSchema.parse({ ...pass, verdict: 'fail', issues: [{ code: 'INSUFFICIENT_EVIDENCE',
    basis: 'The photograph shows Passage B, while the question asks about Passage A.', message: 'Please supply the opening of Passage A to identify the first publication.' }] });
  expect(assessVerificationCoverage(review)).toEqual({ ...review, verdict: 'unknown' });
});

it('explains an old verification bookkeeping error without claiming the student supplied an incomplete photo', () => {
  const issue = { code:'REVIEW_INCOMPLETE' as const, message:'ACT尚未分别核对全部可见正文、设问、选项、当前高亮及表格，答案通过不代表转录完整。' };
  expect(verificationIssueText(issue)).toBe('核验没有确认原题的设问和选项是否支持当前答案，请重新核验。');
  expect(verificationIssueText({code:'TRANSCRIPTION',basis:'图中为负号。',message:'按正号计算改变了答案。'})).toBe('图中为负号。 按正号计算改变了答案。');
});
