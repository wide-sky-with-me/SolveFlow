import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { loadWebEnv } from '../../scripts/web-env.mjs';
const base = { WEB_ENV_ENABLED: 'true', SOLVEFLOW_LLM_BASE_URL: 'https://fixture.invalid/v1', SOLVEFLOW_LLM_API_KEY: 'synthetic-provider-secret', SOLVEFLOW_SOLVER_MODEL: 'primary', SOLVEFLOW_VERIFIER_MODEL: 'checker', WEB_ENV_BACKUP_MODEL: 'gpt-6.1-sol', WEB_ENV_BACKUP_API: 'openai-responses', WEB_ENV_BACKUP_THINKING_MODE: 'on', WEB_ENV_BACKUP_THINKING_EFFORT: 'high' };
it('requires explicit opt-in and does not export provider keys in bootstrap', async () => {
  expect(await loadWebEnv('/tmp/nonexistent-solveflow-env', {})).toBeNull();
  const env = await loadWebEnv('/tmp/nonexistent-solveflow-env', base); if (!env) throw new Error('ENV'); expect(env.bootstrap.settings.backup).toMatchObject({ model: 'gpt-6.1-sol', api: 'openai-responses', thinking: { mode: 'on', effort: 'high' } });
  expect(JSON.stringify(env.bootstrap)).not.toContain('synthetic-provider-secret'); expect(env.roles.backup?.key).toBe('synthetic-provider-secret');
  expect(env.bootstrap.accessTokens.backup).not.toBe(env.roles.backup?.key);
});
it('supports per-role non-streaming without rewriting legacy settings and rejects invalid switches', async () => {
  const env = await loadWebEnv('/tmp/nonexistent-solveflow-env', { ...base, WEB_ENV_SOLVER_STREAMING: 'true', WEB_ENV_VERIFIER_STREAMING: 'false', WEB_ENV_BACKUP_STREAMING: 'false' });
  expect(env?.bootstrap.settings).toMatchObject({ solver: { streaming: true }, verifier: { streaming: false }, backup: { streaming: false } });
  await expect(loadWebEnv('/tmp/nonexistent-solveflow-env', { ...base, WEB_ENV_BACKUP_STREAMING: 'maybe' })).rejects.toThrow('WEB_ENV_BACKUP_INVALID');
});
it('refuses to inherit a key across destination or provider changes', async () => {
  await expect(loadWebEnv('/tmp/nonexistent-solveflow-env', { ...base, WEB_ENV_BACKUP_BASE_URL: 'https://elsewhere.invalid/v1' })).rejects.toThrow('WEB_ENV_BACKUP_INVALID');
  await expect(loadWebEnv('/tmp/nonexistent-solveflow-env', { ...base, WEB_ENV_BACKUP_PROVIDER: 'different' })).rejects.toThrow('WEB_ENV_BACKUP_INVALID');
  const env = await loadWebEnv('/tmp/nonexistent-solveflow-env', { ...base, WEB_ENV_BACKUP_BASE_URL: 'https://elsewhere.invalid/v1', WEB_ENV_BACKUP_API_KEY: 'synthetic-own' }); if (!env) throw new Error('ENV'); expect(env.roles.backup?.key).toBe('synthetic-own');
});
it('reads dotenv at runtime and process overrides without exposing unrelated configuration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'solveflow-env-')); const file = join(directory, '.env');
  try { await writeFile(file, Object.entries({ ...base, DATABASE_PASSWORD: 'synthetic-database' }).map(([key, value]) => `${key}=${value}`).join('\n'));
    const env = await loadWebEnv(file, { WEB_ENV_SOLVER_MODEL: 'override' }); if (!env) throw new Error('ENV'); expect(env.bootstrap.settings.solver.model).toBe('override'); expect(JSON.stringify(env.bootstrap)).not.toContain('synthetic-database');
    await expect(loadWebEnv(file, { WEB_ENV_BACKUP_API: 'invalid' })).rejects.toThrow('WEB_ENV_BACKUP_INVALID');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
