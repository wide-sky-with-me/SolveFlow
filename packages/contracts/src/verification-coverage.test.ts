import { expect, it } from 'vitest';
import { assessVerificationCoverage, GeneratedVerificationSchema, VerificationSchema, verificationIssueCode } from './agent.js';

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
