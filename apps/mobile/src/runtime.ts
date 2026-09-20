import { terminal } from '@solveflow/contracts/http';
import { z } from 'zod';
import { fetch } from 'expo/fetch';
import * as Crypto from 'expo-crypto';
import { LocalEngine, LocalRepository } from '@solveflow/client';
import { solveOnDevice, type LocalCredentials } from '@solveflow/agent/mobile';
import { LocalSettingsSchema, LocalKeySchema, type LocalSettings } from '@solveflow/contracts/local';
import { openDocuments } from './local/documents';
import { readKey, writeKey } from './local/secrets';
import { background, onBackgroundExpired } from './local/background';
import { lockLocalApp } from './local/lock';
let opening: ReturnType<typeof openRuntime> | null = null;
async function openRuntime() {
  await lockLocalApp();
  const documents = await openDocuments(); const repository = new LocalRepository(documents);
  await repository.recoverInterrupted();
  const raw = await documents.get('settings');
  const envelope = raw ? z.strictObject({ settings: LocalSettingsSchema, keySlot: z.enum(['a', 'b']) }).parse(JSON.parse(raw)) : null;
  let settings = envelope?.settings ?? null; let slot = envelope?.keySlot ?? '';
  const keyName = (role: string) => `${slot}.${role}`;
  const engine = new LocalEngine(repository, Crypto.randomUUID, background);
  onBackgroundExpired(runId => { if (engine.active?.id === runId && !terminal(engine.active.status)) void engine.cancel('deadline'); });
  return {
    repository, engine,
    get settings() { return settings; },
    async credentials(): Promise<LocalCredentials> { return { solver: await readKey(keyName('solver')) ?? '', verifier: await readKey(keyName('verifier')) }; },
    async configured() { return !!settings && !!await readKey(keyName('solver')) && (!settings.verifier || !!await readKey(keyName('verifier'))); },
    async saveSettings(value: LocalSettings, credentials: LocalCredentials) {
      if (engine.active) throw new Error('请先等待解题结束或取消，再修改模型设置。');
      const parsed = LocalSettingsSchema.parse(value); LocalKeySchema.parse(credentials.solver); if (parsed.verifier) LocalKeySchema.parse(credentials.verifier);
      const nextSlot = slot === 'a' ? 'b' : 'a'; const oldSlot = slot;
      try { await writeKey(`${nextSlot}.solver`, credentials.solver); if (parsed.verifier) await writeKey(`${nextSlot}.verifier`, credentials.verifier); await documents.put('settings', JSON.stringify({ settings: parsed, keySlot: nextSlot })); }
      catch { await writeKey(`${nextSlot}.solver`, null); await writeKey(`${nextSlot}.verifier`, null); throw new Error('设置保存失败，请检查设备安全存储与可用空间。'); }
      settings = parsed; slot = nextSlot;
      if (oldSlot) { await writeKey(`${oldSlot}.solver`, null); await writeKey(`${oldSlot}.verifier`, null); }
    },
    async clearKeys() { if (engine.active) throw new Error('请先结束当前解题。'); await writeKey(keyName('solver'), null); await writeKey(keyName('verifier'), null); },
    async start(id: string, message: string, context: Parameters<LocalEngine['start']>[2]) {
      if (!settings) throw new Error('请先在设置中配置模型服务。');
      const snapshot = settings; const credentials = { solver: await readKey(keyName('solver')) ?? '', verifier: await readKey(keyName('verifier')) };
      LocalKeySchema.parse(credentials.solver); if (snapshot.verifier) LocalKeySchema.parse(credentials.verifier);
      return engine.start(id, message, context, (input, signal, event, diagnostic) => solveOnDevice(input, snapshot, credentials, fetch, signal, event, diagnostic, background.scheduleTimeout));
    },
  };
}
export function createRuntime() { opening ??= openRuntime(); return opening; }
export type Runtime = Awaited<ReturnType<typeof createRuntime>>;
