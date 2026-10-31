import { expect, it } from 'vitest';
import { photoDispatch } from './dispatch.js';

it('bounds actual transport calls, including failures and simultaneous requests', async () => {
  let calls = 0;
  const transport: typeof fetch = async () => { calls++; throw new Error('Synthetic network failure'); };
  const dispatch = photoDispatch(8, transport);
  const results = await Promise.allSettled(Array.from({ length: 12 }, () => dispatch('https://model.invalid')));
  expect(calls).toBe(8);
  expect(results.filter(r => r.status === 'rejected')).toHaveLength(12);
  expect(() => photoDispatch(0, transport)).toThrow('Invalid');
});
