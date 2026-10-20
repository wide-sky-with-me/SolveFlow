import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadWebEnv } from './web-env.mjs';
import { openWebModelSettings } from './web-model-settings.mjs';
import { WebStoredModelsSchema, WebStoredPresetsSchema } from '../packages/contracts/dist/local.js';
const destination = resolve(process.argv[2] ?? '.runtime/remote-web-2026-10-14/private-state');
await mkdir(destination, { recursive: true, mode: 0o700 });
const environment = await loadWebEnv(new URL('../.env', import.meta.url), { WEB_ENV_ENABLED: 'true' });
await openWebModelSettings(environment, resolve('.runtime/web-model-settings.json'), resolve('.runtime/web-model-presets.json'));
const roles = ['solver', 'verifier', 'backup'];
const models = WebStoredModelsSchema.parse({ schemaVersion: 1,
  models: Object.fromEntries(roles.map(role => [role, environment.roles[role]?.profile ?? null])),
  keys: Object.fromEntries(roles.map(role => [role, environment.roles[role]?.key ?? null])),
});
let activeConfigurationVerified = false;
try {
  const active = await fetch('http://127.0.0.1:3100/__solveflow/web-env', { signal: AbortSignal.timeout(8000) });
  if (!active.ok) throw new Error('ACTIVE_CONFIGURATION_NOT_READABLE');
  const publicConfiguration = await active.json();
  if (roles.some(role => JSON.stringify(publicConfiguration.settings?.[role]) !== JSON.stringify(models.models[role]))) throw new Error('ACTIVE_CONFIGURATION_CHANGED');
  activeConfigurationVerified = true;
} catch (error) { if (error.message === 'ACTIVE_CONFIGURATION_CHANGED') throw error; }
let presets = { schemaVersion: 1, presets: [] };
const presetFile = resolve('.runtime/web-model-presets.json');
try {
  if ((await stat(presetFile)).size > 131072) throw new Error('PRESETS_TOO_LARGE');
  presets = WebStoredPresetsSchema.parse(JSON.parse(await readFile(presetFile, 'utf8')));
} catch (error) { if (error.code !== 'ENOENT') throw error; }
await writeFile(resolve(destination, 'web-model-settings.json'), JSON.stringify(models), { mode: 0o600, flag: 'wx' });
await writeFile(resolve(destination, 'web-model-presets.json'), JSON.stringify(presets), { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify({ type: 'web.models.exported', source: 'persisted-configuration', activeConfigurationVerified, roles: roles.filter(role => models.models[role]), presetCount: presets.presets.length, credentialsPrinted: false, databaseCopied: false }));
