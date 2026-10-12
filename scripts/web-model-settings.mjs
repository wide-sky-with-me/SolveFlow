import { readFile, stat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { WebModelUpdateSchema, WebStoredModelsSchema, WebEnvironmentSchema, LocalKeySchema, WebModelPresetCreateSchema, WebStoredPresetsSchema, MAX_WEB_MODEL_PRESETS } from '../packages/contracts/dist/local.js';
// Decision: .agents/notes/implemented/architecture/2026-10-10-web-model-settings-editor.md
// Decision: .agents/notes/implemented/architecture/2026-10-10-web-model-presets.md

const roles = ['solver', 'verifier', 'backup'];
const sameDestination = (a, b) => a.baseURL === b.baseURL && a.provider === b.provider;

/** User edits are separate from .env; unchanged credentials never travel back to the browser. */
export async function openWebModelSettings(environment, file, presetFile = `${file}.presets`) {
  if (!environment) return null;
  const initial = environment.roles;
  let presets = [];
  const expose = bootstrap => WebEnvironmentSchema.parse({ ...bootstrap, canManagePresets: true, presets: presets.map(({ id, name, configuration }) => ({ id, name, models: configuration.models })) });
  async function writePrivate(destination, value) {
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized) > (destination === presetFile ? 131072 : 32768)) throw new Error('本机配置存储容量不足，请精简配置。');
    const temporary = `${destination}.${randomBytes(8).toString('hex')}.next`;
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(serialized); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, destination);
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  function credentialsFor(update) {
    if (!update.presetId) return null;
    const preset = presets.find(value => value.id === update.presetId);
    if (!preset) throw new Error('配置预设不存在，请刷新设置。');
    return preset.configuration;
  }
  function complete(update) {
    const keys = Object.fromEntries(roles.map(role => {
      const profile = update.models[role]; if (!profile) return [role, null];
      return [role, resolveRole(role, profile, update.keys[role], update.presetId).key];
    }));
    return WebStoredModelsSchema.parse({ schemaVersion: 1, models: update.models, keys });
  }
  function resolveRole(role, profile, key, presetId) {
    if (!profile) return null;
    const source = credentialsFor({ presetId });
    const previous = source ? { profile: source.models[role] ?? source.models.solver, key: source.keys[role] ?? source.keys.solver } : environment.roles[role] ?? initial[role] ?? initial.solver;
    const credential = key ?? (previous && sameDestination(profile, previous.profile) ? previous.key : null);
    const parsed = LocalKeySchema.safeParse(credential);
    if (!parsed.success) throw new Error('请为新增或更换服务的模型填写 API Key。');
    return { profile, key: parsed.data, token: randomBytes(32).toString('hex') };
  }
  function prepare(update) {
    const stored = complete(update);
    const nextRoles = Object.fromEntries(roles.map(role => [role, resolveRole(role, stored.models[role], stored.keys[role])]));
    const bootstrap = WebEnvironmentSchema.parse({ schemaVersion: 1, canEditModels: true, settings: { schemaVersion: 1, ...update.models }, accessTokens: Object.fromEntries(roles.map(role => [role, nextRoles[role]?.token ?? null])) });
    return { roles: nextRoles, bootstrap: expose(bootstrap) };
  }
  try {
    if ((await stat(file)).size > 32768) throw new Error('TOO_LARGE');
    const stored = WebStoredModelsSchema.parse(JSON.parse(await readFile(file, 'utf8')));
    Object.assign(environment, prepare(stored));
  } catch (error) { if (error.code !== 'ENOENT') throw new Error('本机 Web 模型配置无法读取，请保留文件并检查配置。'); }
  try {
    if ((await stat(presetFile)).size > 131072) throw new Error('TOO_LARGE');
    presets = WebStoredPresetsSchema.parse(JSON.parse(await readFile(presetFile, 'utf8'))).presets;
  } catch (error) { if (error.code !== 'ENOENT') throw new Error('本机配置预设无法读取，请保留文件并检查配置。'); }
  environment.bootstrap = expose({ ...environment.bootstrap, canEditModels: true });
  return {
    resolveRole,
    async createPreset(value) {
      const input = WebModelPresetCreateSchema.parse(value);
      if (presets.length >= MAX_WEB_MODEL_PRESETS) throw new Error('配置预设已满，请先移除不用的预设。');
      if (presets.some(preset => preset.name === input.name)) throw new Error('预设名称已存在，请使用其他名称。');
      const next = WebStoredPresetsSchema.parse({ schemaVersion: 1, presets: [...presets, { id: randomUUID(), name: input.name, configuration: complete(input.configuration) }] });
      await writePrivate(presetFile, next); presets = next.presets; environment.bootstrap = expose(environment.bootstrap);
      return environment.bootstrap;
    },
    async removePreset(id) {
      if (!presets.some(preset => preset.id === id)) throw new Error('配置预设不存在，请刷新设置。');
      const next = WebStoredPresetsSchema.parse({ schemaVersion: 1, presets: presets.filter(preset => preset.id !== id) });
      await writePrivate(presetFile, next); presets = next.presets; environment.bootstrap = expose(environment.bootstrap);
      return environment.bootstrap;
    },
    async activatePreset(id) {
      const preset = presets.find(value => value.id === id);
      if (!preset) throw new Error('配置预设不存在，请刷新设置。');
      return this.save(preset.configuration);
    },
    async save(value) {
      const update = WebModelUpdateSchema.parse(value); const next = prepare(update);
      const stored = complete(update);
      await writePrivate(file, stored);
      // Publish the complete configuration only after the atomic write succeeds.
      Object.assign(environment, next);
      return next.bootstrap;
    },
  };
}
