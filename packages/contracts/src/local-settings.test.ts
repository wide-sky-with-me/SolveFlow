import { expect, it } from 'vitest';
import { LocalConcurrencySchema, LocalSettingsSchema } from './local.js';

it('reads old settings without concurrency and gives new queues independent defaults', () => {
  const solver = { provider: 'fixture', baseURL: 'https://fixture.invalid/v1', model: 'fixture', api: 'openai-completions', contextWindow: 32768, maxTokens: 8192, maxTokensField: 'max_tokens' };
  expect(LocalSettingsSchema.parse({ schemaVersion: 1, solver, verifier: null })).not.toHaveProperty('concurrency');
  expect(LocalConcurrencySchema.parse({})).toEqual({ solver: 8, verifier: 8 });
  expect(LocalConcurrencySchema.parse({ solver: 1, verifier: 32 })).toEqual({ solver: 1, verifier: 32 });
});

it.each([0, -1, 33, 1.5, '3', Infinity, NaN])('rejects invalid concurrency %s rather than silently clamping it', value => {
  expect(LocalConcurrencySchema.safeParse({ solver: value, verifier: 3 }).success).toBe(false);
  expect(LocalConcurrencySchema.safeParse({ solver: 5, verifier: value }).success).toBe(false);
});
