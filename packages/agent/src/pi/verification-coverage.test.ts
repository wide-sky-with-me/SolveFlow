import { expect, it } from 'vitest';
import { assessVerificationCoverage } from './verification-coverage.js';
it('does not turn a transcription-only check into a verified answer', () => {
  expect(assessVerificationCoverage({ schemaVersion: 1, verdict: 'pass', checked: ['transcription'], issues: [] })).toMatchObject({ verdict: 'unknown', issues: [{ code: 'INSUFFICIENT_EVIDENCE' }] });
});
it('requires original transcription plus a substantive answer check and preserves failures', () => {
  for (const checked of [['transcription', 'logic'], ['transcription', 'arithmetic']] as const) expect(assessVerificationCoverage({ schemaVersion: 1, verdict: 'pass', checked: [...checked], issues: [] }).verdict).toBe('pass');
  expect(assessVerificationCoverage({ schemaVersion: 1, verdict: 'pass', checked: ['logic'], issues: [] }).verdict).toBe('unknown');
  const fail = { schemaVersion: 1 as const, verdict: 'fail' as const, checked: ['transcription' as const], issues: [{ code: 'TRANSCRIPTION' as const, message: '选项边界错误' }] };
  expect(assessVerificationCoverage(fail)).toEqual(fail);
});
