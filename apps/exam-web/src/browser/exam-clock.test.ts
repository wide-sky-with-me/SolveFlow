import { expect, it } from 'vitest';
import { formatExamDuration } from './exam-clock.js';
it('formats elapsed exam time across minutes and days without wrapping hours', () => {
  expect(formatExamDuration(0)).toBe('00:00:00');
  expect(formatExamDuration(3661)).toBe('01:01:01');
  expect(formatExamDuration(90061.8)).toBe('25:01:01');
  expect(formatExamDuration(-1)).toBe('00:00:00');
  expect(formatExamDuration(Infinity)).toBe('00:00:00');
});
