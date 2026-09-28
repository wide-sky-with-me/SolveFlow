import { terminal } from '@solveflow/contracts/http';
import { z } from 'zod';
import { fetch } from 'expo/fetch';
import * as Crypto from 'expo-crypto';
import { LocalBatchQueue, LocalEngine, LocalRepository } from '@solveflow/client';
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
  const batch = new LocalBatchQueue(engine);
  onBackgroundExpired(runId => { if (engine.actives.some(run => run.id === runId && !terminal(run.status))) void engine.cancelRun(runId, 'deadline'); });
  async function executor() {
    if (!settings) throw new Error('请先在设置中配置模型服务。');
    const snapshot = settings; const credentials = { solver: await readKey(keyName('solver')) ?? '', verifier: await readKey(keyName('verifier')) };
    LocalKeySchema.parse(credentials.solver); if (snapshot.verifier) LocalKeySchema.parse(credentials.verifier);
    return (input: Parameters<typeof solveOnDevice>[0], signal: AbortSignal, event: Parameters<typeof solveOnDevice>[5], diagnostic: Parameters<typeof solveOnDevice>[6]) => solveOnDevice(input, snapshot, credentials, fetch, signal, event, diagnostic, background.scheduleTimeout);
  }
  return {
    repository, engine, batch,
    async newBatch() { const date = new Date(); return { id: Crypto.randomUUID(), title: await repository.nextBatchTitle(date), createdAt: date.toISOString(), exam: settings?.exam ?? 'general' as const }; },
    get settings() { return settings; },
    async credentials(): Promise<LocalCredentials> { return { solver: await readKey(keyName('solver')) ?? '', verifier: await readKey(keyName('verifier')) }; },
    async configured() { return !!settings && !!await readKey(keyName('solver')) && (!settings.verifier || !!await readKey(keyName('verifier'))); },
    async saveSettings(value: LocalSettings, credentials: LocalCredentials) {
      if (engine.actives.length || batch.busy) throw new Error('请先等待解题结束或取消，再修改模型设置。');
      const parsed = LocalSettingsSchema.parse(value); LocalKeySchema.parse(credentials.solver); if (parsed.verifier) LocalKeySchema.parse(credentials.verifier);
      const nextSlot = slot === 'a' ? 'b' : 'a'; const oldSlot = slot;
      try { await writeKey(`${nextSlot}.solver`, credentials.solver); if (parsed.verifier) await writeKey(`${nextSlot}.verifier`, credentials.verifier); await documents.put('settings', JSON.stringify({ settings: parsed, keySlot: nextSlot })); }
      catch { await writeKey(`${nextSlot}.solver`, null); await writeKey(`${nextSlot}.verifier`, null); throw new Error('设置保存失败，请检查设备安全存储与可用空间。'); }
      settings = parsed; slot = nextSlot;
      if (oldSlot) { await writeKey(`${oldSlot}.solver`, null); await writeKey(`${oldSlot}.verifier`, null); }
    },
    async clearKeys() { if (engine.actives.length || batch.busy) throw new Error('请先结束当前解题。'); await writeKey(keyName('solver'), null); await writeKey(keyName('verifier'), null); },
    async enqueueBatch(id: string, retry = false) { return batch.enqueue(id, await executor(), retry); },
    async removeBatch(id: string) {
      await batch.stop(id);
      for (const row of await repository.listHistory()) if (row.batch?.id === id) await engine.remove(row.id);
    },
    async start(id: string, message: string, context: Parameters<LocalEngine['start']>[2]) {
      if (batch.busy) throw new Error('请先等待批量任务完成或停止批量解题。');
      return engine.start(id, message, context, await executor());
    },
  };
}
export function createRuntime() { opening ??= openRuntime().catch(cause => { opening = null; throw cause; }); return opening; }
export type Runtime = Awaited<ReturnType<typeof createRuntime>>;
