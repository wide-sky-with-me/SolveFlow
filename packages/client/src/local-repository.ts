import { z } from 'zod';
import { MAX_LOCAL_RECORDS, LocalBatchTitleSchema, LocalRecordSchema, LocalFavoriteSchema, LocalDiagnosticsSchema, LocalHistoryExportLineSchema, type LocalHistoryExportLine, type LocalDiagnostic, type LocalRecord } from '@solveflow/contracts/local';
import { terminal, type SessionView } from '@solveflow/contracts/http';
import { makeSafeAgentError } from '@solveflow/contracts/agent';
import { LocalHistorySummarySchema, type LocalHistorySummary } from '@solveflow/contracts/local';
import { historyEntry } from './history-payload.js';
export type LocalDocumentChange = { key: string; value: string | null };
export interface LocalDocuments {
  get(key: string): Promise<string | null>;
  /** Ordered bounded reads; missing keys remain null. Optional for older adapters. */
  getMany?(keys: readonly string[]): Promise<(string | null)[]>;
  put(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
  /** Production stores apply the whole batch in one transaction. */
  batch?(changes: LocalDocumentChange[]): Promise<void>;
}
export type LocalSessionView = SessionView & { favorite: boolean };
export class LocalRepository {
  constructor(private readonly documents: LocalDocuments) {}
  private queue: Promise<unknown> = Promise.resolve();
  private lock<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.catch(() => {}).then(task); this.queue = result; return result;
  }
  private async batch(changes: LocalDocumentChange[]) {
    if (this.documents.batch) return this.documents.batch(changes);
    for (const change of changes) {
      if (change.value === null) await this.documents.remove(change.key);
      else await this.documents.put(change.key, change.value);
    }
  }
  private async batchTitle(id: string) {
    const raw = await this.documents.get(`batch-title.${id}`);
    return raw ? LocalBatchTitleSchema.parse(JSON.parse(raw)).title : null;
  }
  async renameBatch(id: string, title: string) {
    const key = `batch-title.${z.uuid().parse(id)}`;
    const value = LocalBatchTitleSchema.parse({ schemaVersion: 1, title });
    await this.lock(() => this.documents.put(key, JSON.stringify(value)));
    return value.title;
  }
  async nextBatchTitle(date = new Date()) {
    const pad = (value: number) => String(value).padStart(2, '0');
    const hour = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}`;
    return this.lock(async () => {
      const raw = await this.documents.get('batch-sequence');
      const previous = raw ? z.strictObject({ schemaVersion: z.literal(1), hour: z.string().max(20), index: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).parse(JSON.parse(raw)) : null;
      const index = previous?.hour === hour ? previous.index + 1 : 1;
      if (!Number.isSafeInteger(index)) throw new Error('批次编号已达上限。');
      await this.documents.put('batch-sequence', JSON.stringify({ schemaVersion: 1, hour, index }));
      return `${hour}时 · ${pad(index)}`;
    });
  }
  private summary(record: LocalRecord) {
    const { favorite: _favorite, ...entry } = historyEntry(record.session);
    return LocalHistorySummarySchema.parse({ schemaVersion: 1, ...entry, ...(record.batch ? { batch: record.batch } : {}), pending: record.session.runs.some(run => !terminal(run.status)) });
  }
  async listHistory(): Promise<LocalHistorySummary[]> {
    return this.lock(async () => {
      const ids = (await this.documents.keys()).filter(key => key.startsWith('record.')).map(key => z.uuid().parse(key.slice(7)));
      if (ids.length > MAX_LOCAL_RECORDS) throw new Error('本地题目数量超限，请先清理记录。');
      const summaries: LocalHistorySummary[] = []; const titles = new Map<string, string | null>();
      const metadataKeys = ids.flatMap(id => [`summary.${id}`, `favorite.${id}`]);
      const metadata = new Map<string, string | null>();
      if (this.documents.getMany && metadataKeys.length) {
        const values = await this.documents.getMany(metadataKeys);
        if (values.length !== metadataKeys.length) throw new Error('本地批量读取失败。');
        metadataKeys.forEach((key, index) => metadata.set(key, values[index] ?? null));
      }
      const readMetadata = (key: string) => this.documents.getMany ? Promise.resolve(metadata.get(key) ?? null) : this.documents.get(key);
      for (const id of ids) {
        const raw = await readMetadata(`summary.${id}`);
        let summary: ReturnType<typeof LocalHistorySummarySchema.parse> | null = null;
        try { const parsed = LocalHistorySummarySchema.safeParse(raw ? JSON.parse(raw) : null); if (parsed.success && parsed.data.id === id) summary = parsed.data; } catch { /* A derived cache can be rebuilt from the original. */ }
        if (!summary) { summary = this.summary(await this.read(id)); await this.documents.put(`summary.${id}`, JSON.stringify(summary)); }
        if (summary.batch) {
          if (!titles.has(summary.batch.id)) titles.set(summary.batch.id, await this.batchTitle(summary.batch.id));
          const title = titles.get(summary.batch.id); if (title) summary = { ...summary, batch: { ...summary.batch, title } };
        }
        const favorite = await readMetadata(`favorite.${id}`);
        summaries.push({ ...summary, favorite: favorite ? LocalFavoriteSchema.parse(JSON.parse(favorite)).favorite : false });
      }
      return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
  }
  async *exportHistory(signal: Pick<AbortSignal, 'aborted'>): AsyncGenerator<LocalHistoryExportLine> {
    if (signal.aborted) throw new Error('导出已取消。');
    const ids = (await this.documents.keys()).filter(key => key.startsWith('record.')).map(key => z.uuid().parse(key.slice(7))).sort();
    if (ids.length > MAX_LOCAL_RECORDS) throw new Error('本地题目数量超限，无法导出。');
    yield LocalHistoryExportLineSchema.parse({ schemaVersion: 1, kind: 'header', format: 'solveflow-history', createdAt: new Date().toISOString(), count: ids.length });
    for (const id of ids) {
      if (signal.aborted) throw new Error('导出已取消。');
      const record = await this.read(id);
      if (record.session.id !== id) throw new Error('本地题目索引不一致。');
      const rawFavorite = await this.documents.get(`favorite.${id}`);
      const favorite = rawFavorite ? LocalFavoriteSchema.parse(JSON.parse(rawFavorite)).favorite : false;
      const diagnostics = [];
      for (const run of record.session.runs) {
        if (signal.aborted) throw new Error('导出已取消。');
        const raw = await this.documents.get(`diagnostic.${run.id}`);
        if (raw) { const value = LocalDiagnosticsSchema.parse(JSON.parse(raw)); if (value.runId !== run.id) throw new Error('本地诊断归属不一致。'); diagnostics.push(value); }
      }
      yield LocalHistoryExportLineSchema.parse({ schemaVersion: 1, kind: 'question', record, favorite, diagnostics });
    }
    if (signal.aborted) throw new Error('导出已取消。');
    yield { schemaVersion: 1, kind: 'complete', count: ids.length };
  }
  async list(): Promise<LocalSessionView[]> {
    const ids = (await this.documents.keys()).filter(key => key.startsWith('record.'));
    if (ids.length > MAX_LOCAL_RECORDS) throw new Error('本地题目数量超限，请先清理记录。');
    const records: LocalSessionView[] = [];
    for (const id of ids) { const raw = await this.documents.get(id); if (raw) { const session = LocalRecordSchema.parse(JSON.parse(raw)).session; const favorite = await this.documents.get(`favorite.${session.id}`); records.push({ ...session, favorite: favorite ? LocalFavoriteSchema.parse(JSON.parse(favorite)).favorite : false }); } }
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async read(id: string): Promise<LocalRecord> {
    const raw = await this.documents.get(`record.${z.uuid().parse(id)}`);
    if (!raw) throw new Error('本地题目不存在或已删除。');
    const record = LocalRecordSchema.parse(JSON.parse(raw));
    if (record.batch) { const title = await this.batchTitle(record.batch.id); if (title) record.batch.title = title; }
    return record;
  }
  async save(record: LocalRecord): Promise<void> {
    const parsed = LocalRecordSchema.parse(record);
    if (parsed.session.upload.bytes > 4 * 1024 * 1024) throw new Error('题图超过4MB。');
    await this.lock(async () => {
      if (parsed.batch) { const title = await this.batchTitle(parsed.batch.id); if (title) parsed.batch.title = title; }
      await this.batch([
      // Invalidate first so a nontransactional adapter interrupted mid-save rebuilds safely.
      { key: `summary.${parsed.session.id}`, value: null },
      { key: `record.${parsed.session.id}`, value: JSON.stringify(parsed) },
      { key: `summary.${parsed.session.id}`, value: JSON.stringify(this.summary(parsed)) },
    ]); });
  }
  async diagnostics(runId: string) {
    const raw = await this.documents.get(`diagnostic.${z.uuid().parse(runId)}`);
    return raw ? LocalDiagnosticsSchema.parse(JSON.parse(raw)).entries : [];
  }
  async saveDiagnostics(runId: string, entries: LocalDiagnostic[]) {
    await this.lock(() => this.documents.put(`diagnostic.${z.uuid().parse(runId)}`, JSON.stringify(LocalDiagnosticsSchema.parse({ schemaVersion: 1, runId, entries }))));
  }
  async setFavorite(id: string, favorite: boolean) {
    return this.lock(async () => {
    await this.read(id); // Only existing local records may be bookmarked.
    if (z.boolean().parse(favorite)) await this.documents.put(`favorite.${id}`, JSON.stringify(LocalFavoriteSchema.parse({ schemaVersion: 1, favorite: true })));
    else await this.documents.remove(`favorite.${id}`);
    });
  }
  async remove(id: string) { return this.lock(async () => {
    const parsed = z.uuid().parse(id); const record = await this.read(parsed);
    const keys = [`summary.${parsed}`, ...record.session.runs.map(run => `diagnostic.${run.id}`), `record.${parsed}`, `favorite.${parsed}`];
    if (record.batch) {
      let sibling = false;
      for (const key of await this.documents.keys()) {
        if (!key.startsWith('record.') || key === `record.${parsed}`) continue;
        const summary = await this.documents.get(`summary.${key.slice(7)}`);
        let cached: LocalHistorySummary | null = null;
        try { const parsed = LocalHistorySummarySchema.safeParse(summary ? JSON.parse(summary) : null); if (parsed.success) cached = { ...parsed.data, favorite: false }; } catch { /* Rebuild from the record when the derived cache is invalid. */ }
        const siblingBatch = cached ? cached.batch : (await this.read(key.slice(7))).batch;
        if (siblingBatch?.id === record.batch.id) { sibling = true; break; }
      }
      if (!sibling) keys.push(`batch-title.${record.batch.id}`);
    }
    await this.batch(keys.map(key => ({ key, value: null })));
  }); }
  async removeAll() {
    return this.lock(async () => {
      const keys = (await this.documents.keys()).filter(key => /^(record|summary|favorite|diagnostic|batch-title)\./.test(key));
      await this.batch(keys.map(key => ({ key, value: null })));
    });
  }
  async recoverInterrupted() {
    for (const session of await this.listHistory()) {
      if (!session.pending) continue;
      const record = await this.read(session.id);
      record.session.runs = record.session.runs.map(run => terminal(run.status) ? run : { ...run, status: 'failed', outcome: { schemaVersion: 1, status: 'failed', verified: false, error: makeSafeAgentError('WORKER_LOST', run.id) } });
      await this.save(record);
    }
  }
}
