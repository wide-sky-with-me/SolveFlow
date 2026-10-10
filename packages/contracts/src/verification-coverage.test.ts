import { expect, it } from 'vitest';
import { VerificationSchema } from './agent.js';

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
