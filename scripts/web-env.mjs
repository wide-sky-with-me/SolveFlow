import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
import { LocalModelProfileSchema, LocalKeySchema, WebEnvironmentSchema } from '../packages/contracts/dist/local.js';

/** Explicit localhost opt-in; select only model values, never export the environment. */
export async function loadWebEnv(file, overrides = process.env) {
  let values = {}; try { values = parseEnv(await readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw new Error('WEB_ENV_FILE_INVALID'); }
  const env = { ...values, ...overrides }; if (env.WEB_ENV_ENABLED !== 'true') return null;
  const text = key => env[key]?.trim() || undefined;
  const common = { baseURL: text('SOLVEFLOW_LLM_BASE_URL'), provider: text('SOLVEFLOW_LLM_PROVIDER'), key: text('SOLVEFLOW_LLM_API_KEY') };
  const roles = {};
  for (const role of ['solver', 'verifier', 'backup']) {
    const prefix = `WEB_ENV_${role.toUpperCase()}`; const legacy = `SOLVEFLOW_${role.toUpperCase()}`;
    const pick = name => text(`${prefix}_${name}`) ?? (role === 'backup' ? undefined : text(`${legacy}_${name}`));
    const model = pick('MODEL'); if (!model && role !== 'solver') { roles[role] = null; continue; }
    try {
      const baseURL = pick('BASE_URL') ?? common.baseURL;
      const provider = pick('PROVIDER') ?? (baseURL?.replace(/\/+$/, '') === common.baseURL?.replace(/\/+$/, '') ? common.provider : undefined) ?? (baseURL ? new URL(baseURL).hostname : undefined);
      const sameDestination = baseURL?.replace(/\/+$/, '') === common.baseURL?.replace(/\/+$/, '') && provider === (common.provider ?? (common.baseURL ? new URL(common.baseURL).hostname : undefined));
      const key = LocalKeySchema.parse(pick('API_KEY') ?? (sameDestination ? common.key : undefined));
      const compat = JSON.parse(pick('COMPAT') ?? text('SOLVEFLOW_LLM_COMPAT') ?? '{}');
      const thinking = text(`${prefix}_THINKING_MODE`);
      const streaming = text(`${prefix}_STREAMING`);
      if (streaming !== undefined && !['true', 'false'].includes(streaming)) throw new Error('INVALID_STREAMING');
      const profile = LocalModelProfileSchema.parse({ provider, baseURL, model, api: pick('API') ?? text('SOLVEFLOW_LLM_API') ?? 'openai-completions',
        contextWindow: Number(pick('CONTEXT_WINDOW') ?? 32768), maxTokens: Number(pick('MAX_TOKENS') ?? 8192), maxTokensField: pick('MAX_TOKENS_FIELD') ?? compat.maxTokensField ?? 'max_tokens',
        ...(streaming === undefined ? {} : { streaming: streaming === 'true' }),
        ...(thinking ? { thinking: { mode: thinking, ...(text(`${prefix}_THINKING_EFFORT`) ? { effort: text(`${prefix}_THINKING_EFFORT`) } : {}), ...(text(`${prefix}_THINKING_PROTOCOL`) ? { protocol: text(`${prefix}_THINKING_PROTOCOL`) } : {}) } } : {}),
      });
      roles[role] = { profile, key, token: randomBytes(32).toString('hex') };
    } catch { throw new Error(`WEB_ENV_${role.toUpperCase()}_INVALID`); }
  }
  const bootstrap = WebEnvironmentSchema.parse({ schemaVersion: 1, settings: { schemaVersion: 1, solver: roles.solver.profile, verifier: roles.verifier?.profile ?? null, backup: roles.backup?.profile ?? null }, accessTokens: { solver: roles.solver.token, verifier: roles.verifier?.token ?? null, backup: roles.backup?.token ?? null } });
  return { bootstrap, roles };
}
