// Decision: .agents/notes/implemented/agent/2026-10-09-direct-answer-review.md
import { isAuxiliaryContext, terminal } from '@solveflow/contracts/http';
import { z } from 'zod';
import { fetch } from 'expo/fetch';
import * as Crypto from 'expo-crypto';
import { LocalBatchQueue, LocalDataError, LocalEngine, LocalRepository } from '@solveflow/client/local';
import { solveOnDevice, type LocalCredentials } from '@solveflow/agent/mobile';
import { LocalSettingsSchema, LocalKeySchema, LocalConcurrencySchema, LocalBatchEditSchema, ExamTypeSchema, type LocalSettings, type WebEnvironment, type WebModelUpdate } from '@solveflow/contracts/local';
import { openDocuments } from './local/documents';
import { readKey, writeKey } from './local/secrets';
import { background, onBackgroundExpired } from './local/background';
import { lockLocalApp } from './local/lock';
import { loadWebEnvironment, webModelFetch, webModelTestFetch, saveWebModelSettings, mutateWebModelPresets } from './local/web-env';
import type { ModelPresetAction } from './local/model-preset-action';
let opening: ReturnType<typeof openRuntime> | null = null;
const settingsEnvelopeSchema = z.strictObject({ settings: LocalSettingsSchema, keySlot: z.enum(['a', 'b']) });
const webPreferencesSchema = z.strictObject({ exam: ExamTypeSchema, concurrency: LocalConcurrencySchema });
const damagedSettingsMessage = '模型设置已损坏，原值已保留；历史可查看、导出。';
// Decision: .agents/notes/implemented/architecture/2026-10-03-device-owned-runtime.md
async function openRuntime() {
  await lockLocalApp();
  const documents = await openDocuments(); const repository = new LocalRepository(documents);
  await repository.recoverInterrupted();
  let raw: string | null = null; let settingsWarning = '';
  try { raw = await documents.get('settings'); }
  catch (cause) { if (!(cause instanceof LocalDataError && cause.key === 'settings')) throw cause; settingsWarning = damagedSettingsMessage; }
  let envelope: z.infer<typeof settingsEnvelopeSchema> | null = null;
  if (raw !== null) {
    // Preserve damaged configuration until an explicit settings save; I/O failures above still stop startup.
    try { envelope = settingsEnvelopeSchema.parse(JSON.parse(raw)); }
    catch { settingsWarning = damagedSettingsMessage; }
  }
  let settings = envelope?.settings ?? null; let slot = envelope?.keySlot ?? '';
  const savedExam = ExamTypeSchema.safeParse(await documents.get('default-exam'));
  let defaultExam = savedExam.success ? savedExam.data : 'general' as const;
  let environment: WebEnvironment | null = null;
  try { environment = await loadWebEnvironment(fetch); }
  catch { settingsWarning = '本地 Web 环境配置暂不可用，历史仍可查看；请检查服务后刷新。'; }
  const modelFetch = webModelFetch(environment, fetch);
  if (environment) {
    const exam = ExamTypeSchema.safeParse(await documents.get('web-environment-exam') ?? settings?.exam ?? defaultExam);
    let preferences = { exam: exam.success ? exam.data : 'general' as const, concurrency: LocalConcurrencySchema.parse(environment.settings.concurrency ?? {}) };
    const savedPreferences = await documents.get('web-environment-preferences');
    if (savedPreferences !== null) {
      try { preferences = webPreferencesSchema.parse(JSON.parse(savedPreferences)); }
      catch { settingsWarning = '考试与并发设置已损坏，原值已保留；本次使用默认并发。'; }
    }
    settings = { ...environment.settings, ...preferences }; slot = 'environment';
    for (const role of ['solver', 'verifier', 'backup'] as const) await writeKey(`${slot}.${role}`, environment.accessTokens[role]);
  }
  const keyName = (role: string) => `${slot}.${role}`;
  const engine = new LocalEngine(repository, Crypto.randomUUID, background);
  engine.configureConcurrency(settings?.concurrency);
  const batch = new LocalBatchQueue(engine);
  onBackgroundExpired(runId => { if (engine.actives.some(run => run.id === runId && !terminal(run.status))) void engine.cancelRun(runId, 'deadline'); });
  async function executor() {
    if (!settings) throw new Error('请先在设置中配置模型服务。');
    const snapshot = settings; const credentials = { solver: await readKey(keyName('solver')) ?? '', verifier: await readKey(keyName('verifier')), backup: await readKey(keyName('backup')) };
    LocalKeySchema.parse(credentials.solver); if (snapshot.verifier) LocalKeySchema.parse(credentials.verifier);
    if (snapshot.backup) LocalKeySchema.parse(credentials.backup);
    return (input: Parameters<typeof solveOnDevice>[0], signal: AbortSignal, event: Parameters<typeof solveOnDevice>[5], diagnostic: Parameters<typeof solveOnDevice>[6], lifecycle?: Parameters<typeof solveOnDevice>[8]) => solveOnDevice(input, snapshot, credentials, modelFetch, signal, event, diagnostic, background.scheduleTimeout, lifecycle);
  }
  let cachedExecutor: ReturnType<typeof executor> | null = null;
  let savingSettings = false;
  function modelUpdate(value: LocalSettings, credentials: LocalCredentials, presetId?: string): WebModelUpdate {
    const parsed = LocalSettingsSchema.parse(value);
    return { schemaVersion: 1, models: { solver: parsed.solver, verifier: parsed.verifier, backup: parsed.backup ?? null }, keys: { solver: credentials.solver || null, verifier: credentials.verifier || null, backup: credentials.backup || null }, ...(presetId ? { presetId } : {}) };
  }
  async function adoptEnvironment(next: WebEnvironment) {
    if (!environment) throw new Error('本地 Web 环境配置不可用。');
    Object.assign(environment, next);
    for (const role of ['solver', 'verifier', 'backup'] as const) await writeKey(`environment.${role}`, next.accessTokens[role]);
    settings = { ...next.settings, exam: settings?.exam ?? defaultExam, concurrency: settings?.concurrency ?? LocalConcurrencySchema.parse({}) }; cachedExecutor = null;
  }
  async function changePreset(action: ModelPresetAction) {
    if (savingSettings || engine.actives.length || batch.busy) throw new Error('请先等待解题结束或取消，再修改配置预设。');
    if (!environment?.canManagePresets) throw new Error('当前平台不支持配置预设。');
    savingSettings = true;
    try {
      const next = await mutateWebModelPresets(environment, action, fetch);
      if (action.kind === 'activate') { engine.invalidatePendingCorrections(); await adoptEnvironment(next); }
      else Object.assign(environment, next);
    } finally { savingSettings = false; }
  }
  async function getExecutor() {
    if (savingSettings) throw new Error('正在保存设置，请稍候。');
    const acceptedSettings = settings;
    cachedExecutor ??= executor().catch(err => { cachedExecutor = null; throw err; });
    const execute = await cachedExecutor;
    if (savingSettings) throw new Error('正在保存设置，请稍候。');
    if (settings !== acceptedSettings) throw new Error('设置已变更，请重新开始本次解题。');
    return execute;
  }
  return {
    repository, engine, batch,
    async newBatch() { const date = new Date(); return { id: Crypto.randomUUID(), title: await repository.nextBatchTitle(date), createdAt: date.toISOString(), exam: settings?.exam ?? defaultExam }; },
    get settings() { return settings; },
    get defaultExam() { return settings?.exam ?? defaultExam; },
    async saveDefaultExam(value: import('@solveflow/contracts/local').ExamType) {
      if (savingSettings || engine.actives.length || batch.busy) throw new Error('请先结束当前解题，再切换默认考试。');
      const exam = ExamTypeSchema.parse(value);
      savingSettings = true;
      try {
        if (!settings) { await documents.put('default-exam', exam); defaultExam = exam; return; }
        const next = { ...settings, exam };
        // Change only the preference; leave model profiles and credential slots intact.
        if (environment) await documents.put('web-environment-preferences', JSON.stringify({ exam, concurrency: LocalConcurrencySchema.parse(next.concurrency ?? {}) }));
        else await documents.put('settings', JSON.stringify({ settings: next, keySlot: slot }));
        engine.invalidatePendingCorrections();
        settings = next; cachedExecutor = null;
      } finally { savingSettings = false; }
    },
    get settingsWarning() { return settingsWarning; },
    get environmentManaged() { return !!environment; }, modelFetch,
    get modelSettingsEditable() { return !environment || !!environment.canEditModels; },
    get canManageModelPresets() { return !!environment?.canManagePresets; },
    get modelPresets() { return environment?.presets ?? []; },
    saveModelPreset(name: string, value: LocalSettings, credentials: LocalCredentials, presetId?: string) { return changePreset({ kind: 'create', name, configuration: modelUpdate(value, credentials, presetId) }); },
    removeModelPreset(id: string) { return changePreset({ kind: 'remove', id }); },
    activateModelPreset(id: string) { return changePreset({ kind: 'activate', id }); },
    connectionFetch(role: 'solver' | 'verifier' | 'backup', profile: import('@solveflow/contracts/local').LocalModelProfile, key: string, presetId?: string) { return webModelTestFetch(environment, role, profile, key, fetch, presetId); },
    async credentials(): Promise<LocalCredentials> { return { solver: await readKey(keyName('solver')) ?? '', verifier: await readKey(keyName('verifier')), backup: await readKey(keyName('backup')) }; },
    async configured() { return !!settings && !!await readKey(keyName('solver')) && (!settings.verifier || !!await readKey(keyName('verifier'))) && (!settings.backup || !!await readKey(keyName('backup'))); },
    async saveSettings(value: LocalSettings, credentials: LocalCredentials, presetId?: string) {
      if (savingSettings || engine.actives.length || batch.busy) throw new Error('请先等待解题结束或取消，再修改模型设置。');
      engine.invalidatePendingCorrections();
      savingSettings = true;
      try {
        if (environment) {
          const parsed = LocalSettingsSchema.parse(value);
          let modelSaved = false;
          const modelsChanged = JSON.stringify([parsed.solver, parsed.verifier, parsed.backup ?? null]) !== JSON.stringify([environment.settings.solver, environment.settings.verifier, environment.settings.backup ?? null]);
          if (modelsChanged || credentials.solver || credentials.verifier || credentials.backup || presetId) {
            if (!environment.canEditModels) throw new Error('模型由本地 .env 管理，请更新 Web 服务后编辑。');
            const next = await saveWebModelSettings(environment, modelUpdate(parsed, credentials, presetId), fetch);
            modelSaved = true;
            await adoptEnvironment(next);
          }
          // One preference write; environment models/tokens never replace manual settings.
          try { await documents.put('web-environment-preferences', JSON.stringify({ exam: parsed.exam ?? 'general', concurrency: LocalConcurrencySchema.parse(parsed.concurrency ?? {}) })); }
          catch { throw new Error(modelSaved ? '模型配置已保存，但考试或并发偏好保存失败，请重试。' : '考试或并发偏好保存失败，原偏好已保留。'); }
          engine.configureConcurrency(parsed.concurrency);
          settings = parsed; cachedExecutor = null; return;
        }
        const parsed = LocalSettingsSchema.parse(value); LocalKeySchema.parse(credentials.solver); if (parsed.verifier) LocalKeySchema.parse(credentials.verifier);
        if (parsed.backup) LocalKeySchema.parse(credentials.backup);
        const nextSlot = slot === 'a' ? 'b' : 'a'; const oldSlot = slot;
        try { await writeKey(`${nextSlot}.solver`, credentials.solver); if (parsed.verifier) await writeKey(`${nextSlot}.verifier`, credentials.verifier); await writeKey(`${nextSlot}.backup`, parsed.backup ? credentials.backup ?? null : null); await documents.put('settings', JSON.stringify({ settings: parsed, keySlot: nextSlot })); }
        catch { await writeKey(`${nextSlot}.solver`, null); await writeKey(`${nextSlot}.verifier`, null); await writeKey(`${nextSlot}.backup`, null); throw new Error('设置保存失败，请检查设备安全存储与可用空间。'); }
        engine.configureConcurrency(parsed.concurrency);
        settings = parsed; slot = nextSlot; cachedExecutor = null; settingsWarning = '';
        if (oldSlot) { await writeKey(`${oldSlot}.solver`, null); await writeKey(`${oldSlot}.verifier`, null); await writeKey(`${oldSlot}.backup`, null); }
      } finally { savingSettings = false; }
    },
    async clearKeys() { if (environment) throw new Error('模型凭据由本地 .env 管理，请在文件中清除并重启服务。'); if (engine.actives.length || batch.busy) throw new Error('请先结束当前解题。'); engine.invalidatePendingCorrections(); cachedExecutor = null; await writeKey(keyName('solver'), null); await writeKey(keyName('verifier'), null); await writeKey(keyName('backup'), null); },
    async continueWithMaterials(id: string, context: Parameters<LocalEngine['start']>[2]) {
      if (!context || context.kind !== 'regenerate') throw new Error('请选择要补充解答的题目。');
      const message = '请结合原题图和本轮全部补图，从头重新解答本题；补图已经提供所需细节，请实际检查，不沿用旧的缺图判断。';
      const record = await repository.readMetadata(id);
      if (record.batch) return batch.enqueue(id, await getExecutor(), false, { message, context });
      return engine.start(id, message, context, await getExecutor());
    },
    async enqueueBatch(id: string, retry = false) { return batch.enqueue(id, await getExecutor(), retry); },
    async retryBatch(id: string, runId: string) { return batch.enqueue(id, await getExecutor(), true, undefined, runId); },
    async removeBatch(id: string) {
      z.uuid().parse(id);
      await batch.stop(id);
      const ids: string[] = [];
      for (const row of await repository.listHistory()) if (row.batch?.id === id && (await repository.readMetadata(row.id)).batch?.id === id) ids.push(row.id);
      await engine.removeMany(ids);
    },
    async removeSingleHistory() {
      const ids: string[] = [];
      for (const row of await repository.listHistory()) if (!row.batch && !(await repository.readMetadata(row.id)).batch) ids.push(row.id);
      await engine.removeMany(ids);
    },
    async editBatch(value: import('@solveflow/contracts/local').LocalBatchEdit) {
      const edit = LocalBatchEditSchema.parse(value);
      await batch.stop(edit.batchId);
      await engine.editBatch(edit);
    },
    async start(id: string, message: string, context: Parameters<LocalEngine['start']>[2], imageEdit?: Parameters<LocalEngine['start']>[4]) {
      if (batch.busy && !isAuxiliaryContext(context?.kind)) throw new Error('请先等待批量任务完成或停止批量解题。');
      if (context?.kind === 'verification' && settings?.backup)
        return engine.startVerification(id, message, context, await getExecutor());
      return engine.start(id, message, context, await getExecutor(), imageEdit);
    },
  };
}
export function createRuntime() { opening ??= openRuntime().catch(cause => { opening = null; throw cause; }); return opening; }
export type Runtime = Awaited<ReturnType<typeof createRuntime>>;
