// Decision: .agents/notes/implemented/architecture/2026-10-09-overall-study-timer.md
import { z } from 'zod';
import { MAX_LOCAL_RECORDS, LocalBatchEditSchema, type LocalBatchEdit, ReadableLocalRecordSchema, ReadableStoredLocalRecordSchema, StoredLocalRecordSchema, StoredLocalImageSchema, LocalBatchTitleSchema, LocalRecordSchema, LocalFavoriteSchema, LocalDiagnosticsSchema, LocalHistoryExportLineSchema, type LocalHistoryExportLine, type LocalDiagnostic, type LocalRecord, type LocalRecordMetadata, LocalStudyTimerSchema, type LocalStudyTimer } from '@solveflow/contracts/local';
import { terminal, questionAnswerState, type SessionView } from '@solveflow/contracts/http';
import { makeSafeAgentError, type SolveOutcome } from '@solveflow/contracts/agent';
import { LocalHistorySummarySchema, type LocalHistorySummary } from '@solveflow/contracts/local';
import { readHistoryArchive, type HistoryImportSource, type HistoryImportProgress } from './local-history-import.js';
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
export type LocalStorageIssue = { key: string; sessionId?: string; repairable: boolean };
/** Invalid saved bytes, distinct from an unavailable/full storage device. */
export class LocalDataError extends Error {
  constructor(readonly key: string) { super('部分本地记录无法读取，原数据已保留，请打开记录维护。'); }
}
function decodeDocument<T>(key: string, raw: string, schema: z.ZodType<T>): T {
  try { return schema.parse(JSON.parse(raw)); } catch { throw new LocalDataError(key); }
}
function recordMetadata(record: LocalRecord): LocalRecordMetadata {
  const { image: _image, materials, ...metadata } = record;
  return { ...metadata, ...(materials ? { materials: materials.map(({ image: _photo, ...info }) => info) } : {}) };
}
// Decision: .agents/notes/implemented/agent/2026-10-04-exam-response-and-materials.md
const materialKey = (sessionId: string, materialId: string) => `material.${sessionId}.${materialId}`;
function materialChanges(record: LocalRecord, start = 0): LocalDocumentChange[] {
  return (record.materials ?? []).slice(start).map(item => ({ key: materialKey(record.session.id, item.id), value: JSON.stringify({ schemaVersion: 1, image: item.image }) }));
}
// Older importers persisted false although normal writes represent it by absence.
// Accept exactly that historical shape without weakening the canonical contract.
const StoredFavoriteSchema = z.union([LocalFavoriteSchema, z.strictObject({ schemaVersion: z.literal(1), favorite: z.literal(false) })]);
function readFavorite(raw: string | null, key: string): boolean { return raw === null ? false : decodeDocument(key, raw, StoredFavoriteSchema).favorite; }
function interruptedRun(run: SessionView['runs'][number]): SessionView['runs'][number] {
  if (terminal(run.status)) return run;
  if (run.outcome?.status === 'completed') {
    const { verificationStatus: _pending, ...outcome } = run.outcome;
    return { ...run, status: 'completed', seq: run.seq + 1, outcome: { ...outcome, verified: false, verification: null, warning: 'WORKER_LOST' } };
  }
  const outcome: SolveOutcome = { schemaVersion: 1, status: 'failed', verified: false, error: makeSafeAgentError('WORKER_LOST', run.id) };
  return { ...run, status: 'failed', outcome };
}
export class LocalRepository {
  constructor(private readonly documents: LocalDocuments) {}
  private history: LocalHistorySummary[] | null = null;
  private damaged = new Map<string, LocalStorageIssue>();
  private issueListeners = new Set<() => void>();
  get issues(): LocalStorageIssue[] { return [...this.damaged.values()].map(issue => ({ ...issue })); }
  subscribeIssues(listener: () => void) { this.issueListeners.add(listener); return () => { this.issueListeners.delete(listener); }; }
  private noteIssue(cause: unknown, sessionId?: string) {
    if (!(cause instanceof LocalDataError)) throw cause;
    if (!this.damaged.has(cause.key) && this.damaged.size < MAX_LOCAL_RECORDS * 4) {
      this.damaged.set(cause.key, { key: cause.key, ...(sessionId ? { sessionId } : {}), repairable: /^(favorite|batch-title)\./.test(cause.key) });
      for (const listener of this.issueListeners) listener();
    }
  }
  /** Count includes isolated records, so corruption cannot bypass the storage cap. */
  async recordIds({ strict = false }: { strict?: boolean } = {}) {
    const keys = (await this.documents.keys()).filter(key => key.startsWith('record.'));
    if (keys.length > MAX_LOCAL_RECORDS) throw new Error('本地题目数量超限，请先清理记录。');
    const ids: string[] = [];
    for (const key of keys) { const id = z.uuid().safeParse(key.slice(7)); if (id.success) ids.push(id.data); else this.noteIssue(new LocalDataError(key)); }
    if (strict && ids.length !== keys.length) throw new LocalDataError(keys.find(key => !z.uuid().safeParse(key.slice(7)).success)!);
    return ids;
  }
  private listeners = new Set<() => void>();
  subscribeHistory(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed() { for (const listener of this.listeners) listener(); }
  private historyCopy() { return this.history!.map(row => ({ ...row, ...(row.batch ? { batch: { ...row.batch } } : {}) })); }
  private queue: Promise<unknown> = Promise.resolve();
  private lock<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.catch(() => {}).then(task).catch((cause: unknown) => { this.history = null; throw cause; }); this.queue = result; return result;
  }
  private async batch(changes: LocalDocumentChange[]) {
    if (this.documents.batch) return this.documents.batch(changes);
    for (const change of changes) {
      if (change.value === null) await this.documents.remove(change.key);
      else await this.documents.put(change.key, change.value);
    }
  }
  private async batchTitle(id: string) {
    const key = `batch-title.${id}`; const raw = await this.documents.get(key);
    const title = raw === null ? null : decodeDocument(key, raw, LocalBatchTitleSchema).title;
    this.damaged.delete(key); return title;
  }
  private studyTimerKey(id: string, scope: string) {
    const address = z.string().max(45).regex(/^[0-9a-f-]{36}:(?:single|[1-9][0-9]{0,2})$/i).parse(scope);
    z.uuid().parse(address.split(':')[0]);
    return `study-time.${z.uuid().parse(id)}.${address}`;
  }
  async readStudyTimer(id: string, scope: string): Promise<LocalStudyTimer> {
    const key = this.studyTimerKey(id, scope); const raw = await this.documents.get(key);
    return raw === null ? { schemaVersion: 1, elapsedMs: 0, startedAt: null } : decodeDocument(key, raw, LocalStudyTimerSchema);
  }
  async readOverallStudyTimer(): Promise<LocalStudyTimer> {
    const key = 'study-time.overall'; const raw = await this.documents.get(key);
    return raw === null ? { schemaVersion: 1, elapsedMs: 0, startedAt: null } : decodeDocument(key, raw, LocalStudyTimerSchema);
  }
  async saveOverallStudyTimer(value: LocalStudyTimer) {
    const timer = LocalStudyTimerSchema.parse(value);
    await this.lock(() => this.documents.put('study-time.overall', JSON.stringify(timer)));
  }
  async saveStudyTimer(id: string, scope: string, value: LocalStudyTimer) {
    const key = this.studyTimerKey(id, scope); const timer = LocalStudyTimerSchema.parse(value);
    await this.lock(async () => {
      if (await this.documents.get(`record.${id}`) === null) throw new Error('题目已不存在，无法保存计时。');
      if (await this.documents.get(key) === null && (await this.documents.keys()).filter(value => value.startsWith(`study-time.${id}.`)).length >= 40) throw new Error('本题计时记录已达到上限。');
      await this.documents.put(key, JSON.stringify(timer));
    });
  }
  async renameBatch(id: string, title: string) {
    const key = `batch-title.${z.uuid().parse(id)}`;
    const value = LocalBatchTitleSchema.parse({ schemaVersion: 1, title });
    await this.lock(async () => { await this.documents.put(key, JSON.stringify(value)); this.history = this.history?.map(row => row.batch?.id === id ? { ...row, batch: { ...row.batch, title: value.title } } : row) ?? null; this.changed(); });
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
  private summary(record: Pick<LocalRecord, 'session' | 'batch'>) {
    const { favorite: _favorite, ...entry } = historyEntry(record.session);
    return LocalHistorySummarySchema.parse({ schemaVersion: 1, ...entry, ...(record.batch ? { batch: record.batch } : {}), answerState: questionAnswerState(record.session.runs), pending: record.session.runs.some(run => !terminal(run.status)) });
  }
  async listHistory({ cached = false }: { cached?: boolean } = {}): Promise<LocalHistorySummary[]> {
    return this.lock(async () => {
      if (cached && this.history) return this.historyCopy();
      const ids = await this.recordIds();
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
        try {
        const summaryKey = `summary.${id}`; let raw: string | null = null;
        try { raw = await readMetadata(summaryKey); }
        catch (cause) { if (!(cause instanceof LocalDataError && cause.key === summaryKey)) throw cause; }
        let summary: ReturnType<typeof LocalHistorySummarySchema.parse> | null = null;
        try { const parsed = LocalHistorySummarySchema.safeParse(raw ? JSON.parse(raw) : null); if (parsed.success && parsed.data.id === id && parsed.data.answerState !== undefined) summary = parsed.data; } catch { /* A derived cache can be rebuilt from the original. */ }
        if (!summary) { summary = this.summary(await this.readMetadata(id)); await this.documents.put(summaryKey, JSON.stringify(summary)); }
        this.damaged.delete(summaryKey);
        if (summary.batch) {
          if (!titles.has(summary.batch.id)) titles.set(summary.batch.id, await this.batchTitle(summary.batch.id));
          const title = titles.get(summary.batch.id); if (title) summary = { ...summary, batch: { ...summary.batch, title } };
        }
        const favorite = await readMetadata(`favorite.${id}`);
        summaries.push({ ...summary, favorite: readFavorite(favorite, `favorite.${id}`) });
        this.damaged.delete(`favorite.${id}`);
        } catch (cause) { this.noteIssue(cause, id); }
      }
      this.history = summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return this.historyCopy();
    });
  }
  async exportQuestion(id: string): Promise<Extract<LocalHistoryExportLine, { kind: 'question' }>> {
    try {
      const record = await this.read(id);
      const favorite = readFavorite(await this.documents.get(`favorite.${id}`), `favorite.${id}`);
      const diagnostics = [];
      for (const run of record.session.runs) {
        const key = `diagnostic.${run.id}`; const raw = await this.documents.get(key);
        if (raw) { const value = decodeDocument(key, raw, LocalDiagnosticsSchema); if (value.runId !== run.id) throw new LocalDataError(key); diagnostics.push(value); }
      }
      return LocalHistoryExportLineSchema.options[1].parse({ schemaVersion: 1, kind: 'question', record, favorite, diagnostics });
    } catch (cause) { if (cause instanceof LocalDataError) this.noteIssue(cause, id); throw cause; }
  }
  async *exportHistory(signal: Pick<AbortSignal, 'aborted'>, selectedIds?: readonly string[]): AsyncGenerator<LocalHistoryExportLine> {
    if (signal.aborted) throw new Error('导出已取消。');
    const ids = selectedIds ? z.array(z.uuid()).max(MAX_LOCAL_RECORDS).parse(selectedIds) : await this.recordIds({ strict: true });
    if (new Set(ids).size !== ids.length) throw new Error('导出题目重复。');
    ids.sort();
    if (ids.length > MAX_LOCAL_RECORDS) throw new Error('本地题目数量超限，无法导出。');
    yield LocalHistoryExportLineSchema.parse({ schemaVersion: 1, kind: 'header', format: 'solveflow-history', createdAt: new Date().toISOString(), count: ids.length });
    for (const id of ids) {
      if (signal.aborted) throw new Error('导出已取消。');
      yield await this.exportQuestion(id);
    }
    if (signal.aborted) throw new Error('导出已取消。');
    yield { schemaVersion: 1, kind: 'complete', count: ids.length };
  }
  async list(): Promise<LocalSessionView[]> {
    const ids = (await this.documents.keys()).filter(key => key.startsWith('record.'));
    if (ids.length > MAX_LOCAL_RECORDS) throw new Error('本地题目数量超限，请先清理记录。');
    const records: LocalSessionView[] = [];
    for (const id of ids) { const raw = await this.documents.get(id); if (raw) { const session = (await this.read(id.slice(7))).session; const favorite = await this.documents.get(`favorite.${session.id}`); records.push({ ...session, favorite: readFavorite(favorite, `favorite.${session.id}`) }); } }
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  private async loadRecord(id: string, resolveTitle = true) {
    const raw = await this.documents.get(`record.${z.uuid().parse(id)}`);
    if (raw === null) throw new Error('本地题目不存在或已删除。');
    const key = `record.${id}`;
    const record = decodeDocument(key, raw, ReadableLocalRecordSchema);
    if (record.session.id !== id) throw new LocalDataError(key);
    this.damaged.delete(key);
    if (resolveTitle && record.batch) { const title = await this.batchTitle(record.batch.id); if (title) record.batch.title = title; }
    return record;
  }
  async readMetadata(id: string): Promise<LocalRecordMetadata> {
    try {
    const record = await this.loadRecord(id);
    return { schemaVersion: 1, session: record.session, ...(record.exam ? { exam: record.exam } : {}), ...(record.batch ? { batch: record.batch } : {}), ...(record.activeImageIds ? { activeImageIds: record.activeImageIds } : {}), ...(record.materials ? { materials: record.materials.map(item => ({ id: item.id, bytes: item.bytes, width: item.width, height: item.height })) } : {}) };
    } catch (cause) { if (cause instanceof LocalDataError) this.noteIssue(cause, id); throw cause; }
  }
  async read(id: string): Promise<LocalRecord> {
    try {
    const record = await this.loadRecord(id);
    if (record.schemaVersion === 1) return record;
    const photo = await this.documents.get(`image.${id}`);
    if (!photo) throw new LocalDataError(`image.${id}`);
    const image = decodeDocument(`image.${id}`, photo, StoredLocalImageSchema).image;
    this.damaged.delete(`image.${id}`);
    const materials = [];
    for (const info of record.materials ?? []) {
      const key = materialKey(id, info.id); const raw = await this.documents.get(key);
      if (!raw) throw new LocalDataError(key);
      materials.push({ ...info, image: decodeDocument(key, raw, StoredLocalImageSchema).image });
      this.damaged.delete(key);
    }
    return LocalRecordSchema.parse({ ...record, schemaVersion: 1, image, ...(materials.length ? { materials } : {}) });
    } catch (cause) { if (cause instanceof LocalDataError) this.noteIssue(cause, id); throw cause; }
  }
  async save(record: LocalRecord): Promise<void> {
    const parsed = LocalRecordSchema.parse(record);
    if (parsed.session.upload.bytes > 4 * 1024 * 1024) throw new Error('题图超过4MB。');
    await this.lock(async () => {
      if (parsed.batch) { const title = await this.batchTitle(parsed.batch.id); if (title) parsed.batch.title = title; }
      const old = await this.documents.get(`record.${parsed.session.id}`);
      if (old === null && (await this.documents.keys()).filter(key => key.startsWith('record.')).length >= MAX_LOCAL_RECORDS) throw new Error('已保存500张题图，请先清理记录。');
      const stored = old ? ReadableStoredLocalRecordSchema.safeParse(JSON.parse(old)) : null;
      const { image } = parsed; const metadata = recordMetadata(parsed);
      if (stored?.success && JSON.stringify(stored.data.session.upload) !== JSON.stringify(parsed.session.upload)) throw new Error('已保存的原图不可替换，请新建题目。');
      const previousMaterials = stored?.success ? stored.data.materials ?? [] : [];
      if (previousMaterials.some((item, index) => JSON.stringify(item) !== JSON.stringify(metadata.materials?.[index]))) throw new Error('已保存的材料不可移除或替换。');
      const additions = materialChanges(parsed, previousMaterials.length);
      if ((additions.length || parsed.activeImageIds && JSON.stringify(parsed.activeImageIds) !== JSON.stringify(stored?.success ? stored.data.activeImageIds : undefined)) && !this.documents.batch) throw new Error('当前存储不支持材料的事务保存。');
      const photo: LocalDocumentChange[] = stored?.success ? [] : [{ key: `image.${parsed.session.id}`, value: JSON.stringify({ schemaVersion: 1, image }) }];
      await this.batch([
      ...photo, ...additions,
      // Invalidate first so a nontransactional adapter interrupted mid-save rebuilds safely.
      { key: `summary.${parsed.session.id}`, value: null },
      { key: `record.${parsed.session.id}`, value: JSON.stringify({ ...metadata, schemaVersion: 2 }) },
      { key: `summary.${parsed.session.id}`, value: JSON.stringify(this.summary(parsed)) },
    ]);
    if (this.history) {
      const previous = this.history.find(row => row.id === parsed.session.id);
      this.history = [...this.history.filter(row => row.id !== parsed.session.id), { ...this.summary(parsed), favorite: previous?.favorite ?? false }].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    this.changed(); });
  }
  /** Replace one explicitly selected unreadable question in one transaction. */
  // Decision: .agents/notes/implemented/storage/2026-10-03-backup-and-atomic-repair.md
  async restoreQuestion(source: HistoryImportSource, sessionId: string, signal: Pick<AbortSignal, 'aborted'>, progress?: (value: HistoryImportProgress) => void) {
    const id = z.uuid().parse(sessionId);
    return this.lock(async () => {
      if (!this.documents.batch) throw new Error('当前存储不支持安全恢复。');
      let damaged = false;
      try { await this.read(id); } catch (cause) {
        if (cause instanceof LocalDataError && ([`record.${id}`, `image.${id}`].includes(cause.key) || cause.key.startsWith(`material.${id}.`))) damaged = true;
        else throw cause;
      }
      if (!damaged) throw new Error('这道题可以正常读取，未覆盖本机记录。');
      let selected: Extract<LocalHistoryExportLine, { kind: 'question' }> | undefined; let checked = 0;
      for await (const row of readHistoryArchive(source, signal)) {
        if (row.record.session.id === id) selected = row;
        progress?.({ phase: 'checking', completed: ++checked });
      }
      if (!selected) throw new Error('备份中没有这道题，请选择包含它的分卷。');
      const record = selected.record; const runIds = new Set(record.session.runs.map(run => run.id));
      for (const otherId of await this.recordIds()) {
        if (otherId === id) continue;
        let other: Awaited<ReturnType<LocalRepository['readMetadata']>>;
        try { other = await this.readMetadata(otherId); }
        catch (cause) { if (!(cause instanceof LocalDataError)) throw cause; this.noteIssue(cause, otherId); continue; }
        if (other.session.runs.some(run => runIds.has(run.id)) || (record.batch && other.batch?.id === record.batch.id && other.batch.position === record.batch.position)) throw new Error('备份与其他题目的编号冲突，未恢复。');
      }
      if (record.batch) { const title = await this.batchTitle(record.batch.id); if (title) record.batch.title = title; }
      record.session.runs = record.session.runs.map(interruptedRun);
      const { image } = record; const metadata = recordMetadata(record);
      const obsoleteMaterials = (await this.documents.keys()).filter(key => key.startsWith(`material.${id}.`)).map(key => ({ key, value: null }));
      const changes: LocalDocumentChange[] = [
        ...obsoleteMaterials,
        { key: `record.${id}`, value: JSON.stringify({ ...metadata, schemaVersion: 2 }) },
        { key: `image.${id}`, value: JSON.stringify({ schemaVersion: 1, image }) },
        ...materialChanges(record),
        { key: `summary.${id}`, value: JSON.stringify(this.summary(record)) },
        { key: `favorite.${id}`, value: selected.favorite ? JSON.stringify({ schemaVersion: 1, favorite: true }) : null },
      ];
      // Existing diagnostic keys may belong to another unreadable record. Keep
      // them untouched; repair never guesses ownership from corrupt bytes.
      for (const item of selected.diagnostics) if (await this.documents.get(`diagnostic.${item.runId}`) === null) changes.push({ key: `diagnostic.${item.runId}`, value: JSON.stringify(item) });
      if (signal.aborted) throw new Error('恢复已取消。');
      // One question in one atomic transaction: failed writes retain the old data.
      await this.batch(changes);
      for (const key of [`record.${id}`, `image.${id}`, `favorite.${id}`, ...obsoleteMaterials.map(item => item.key)]) this.damaged.delete(key);
      this.history = null; this.changed(); progress?.({ phase: 'restoring', completed: 1 });
      return { restored: 1, skipped: 0 };
    });
  }
  /** Validate the complete archive before writes; merge only absent IDs. */
  // Decision: .agents/notes/implemented/storage/2026-10-05-import-with-damaged-records.md
  async importHistory(source: HistoryImportSource, signal: Pick<AbortSignal, 'aborted'>, progress?: (value: HistoryImportProgress) => void) {
    return this.lock(async () => {
      if (!this.documents.batch) throw new Error('当前存储不支持安全恢复。');
      const keys = await this.documents.keys();
      const existing = new Set(keys.filter(key => key.startsWith('record.')).map(key => key.slice(7)));
      // Diagnostics may survive unreadable metadata. Their keys reserve run IDs
      // even when the incoming archive has no diagnostic entries to write.
      const occupiedRuns = new Set(keys.filter(key => key.startsWith('diagnostic.') && z.uuid().safeParse(key.slice(11)).success).map(key => key.slice(11)));
      const positions = new Map<string, string>();
      for (const id of existing) {
        if (!z.uuid().safeParse(id).success) { this.noteIssue(new LocalDataError(`record.${id}`)); continue; }
        try {
          // Optional title damage must not hide otherwise valid run ownership.
          const record = await this.loadRecord(id, false);
          for (const run of record.session.runs) occupiedRuns.add(run.id);
          if (record.batch) positions.set(`${record.batch.id}:${record.batch.position}`, id);
        } catch (cause) {
          if (!(cause instanceof LocalDataError)) throw cause;
          this.noteIssue(cause, id);
          const raw = await this.documents.get(`summary.${id}`);
          let summary: z.infer<typeof LocalHistorySummarySchema> | undefined;
          try {
            const parsed = LocalHistorySummarySchema.safeParse(raw === null ? null : JSON.parse(raw));
            if (parsed.success && parsed.data.id === id && parsed.data.answerState !== undefined) summary = parsed.data;
          } catch { /* Invalid derived data cannot supply a reservation. */ }
          if (summary?.batch) positions.set(`${summary.batch.id}:${summary.batch.position}`, id);
        }
      }
      const wanted = new Set<string>(); let skipped = 0;
      for await (const row of readHistoryArchive(source, signal)) {
        const id = row.record.session.id;
        if (existing.has(id)) { skipped++; continue; }
        if (existing.size + wanted.size >= MAX_LOCAL_RECORDS) throw new Error('恢复后的题目数量超过500道，请先清理记录。');
        if (row.record.session.runs.some(run => occupiedRuns.has(run.id))) throw new Error('备份中的解答编号与已有记录冲突。');
        if (row.record.batch && positions.has(`${row.record.batch.id}:${row.record.batch.position}`)) throw new Error('备份中的批量序号与已有记录冲突。');
        wanted.add(id); progress?.({ phase: 'checking', completed: wanted.size + skipped });
      }
      const inserted: string[] = []; const rollbackKeys: string[] = [];
      try {
        for await (const row of readHistoryArchive(source, signal)) {
          const id = row.record.session.id;
          if (existing.has(id)) continue;
          if (!wanted.delete(id)) throw new Error('备份文件在恢复期间发生变化。');
          const record = row.record;
          if (record.session.runs.some(run => occupiedRuns.has(run.id))) throw new Error('备份解答编号冲突。');
          if (record.batch && positions.has(`${record.batch.id}:${record.batch.position}`)) throw new Error('备份批量序号冲突。');
          for (const run of record.session.runs) occupiedRuns.add(run.id);
          if (record.batch) {
            positions.set(`${record.batch.id}:${record.batch.position}`, id);
            const title = await this.batchTitle(record.batch.id); if (title) record.batch.title = title;
          }
          record.session.runs = record.session.runs.map(interruptedRun);
          const { image } = record; const metadata = recordMetadata(record);
          const changes = [
            { key: `record.${id}`, value: JSON.stringify({ ...metadata, schemaVersion: 2 }) },
            { key: `image.${id}`, value: JSON.stringify({ schemaVersion: 1, image }) },
            ...materialChanges(record),
            { key: `summary.${id}`, value: JSON.stringify(this.summary(record)) },
            // Unbookmarked records use absence, matching setFavorite and all readers.
            { key: `favorite.${id}`, value: row.favorite ? JSON.stringify(LocalFavoriteSchema.parse({ schemaVersion: 1, favorite: true })) : null },
            ...row.diagnostics.map(item => ({ key: `diagnostic.${item.runId}`, value: JSON.stringify(item) })),
          ];
          // Reject orphan keys too: rollback must never erase pre-existing documents.
          for (const change of changes) if (await this.documents.get(change.key) !== null) throw new Error('恢复记录与本机数据冲突。');
          await this.batch(changes);
          rollbackKeys.push(...changes.map(change => change.key)); inserted.push(id);
          progress?.({ phase: 'restoring', completed: inserted.length });
        }
        if (wanted.size || signal.aborted) throw new Error(signal.aborted ? '恢复已取消。' : '备份文件在恢复期间发生变化。');
      } catch (cause) {
        try { await this.batch(rollbackKeys.map(key => ({ key, value: null }))); }
        catch { this.history = null; this.changed(); throw new Error('恢复未完成，部分记录未能撤回，请检查存储空间后查看历史。'); }
        throw cause;
      }
      this.history = null; this.changed();
      return { restored: inserted.length, skipped };
    });
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
    await this.readMetadata(id); // Only existing local records may be bookmarked.
    if (z.boolean().parse(favorite)) await this.documents.put(`favorite.${id}`, JSON.stringify(LocalFavoriteSchema.parse({ schemaVersion: 1, favorite: true })));
    else await this.documents.remove(`favorite.${id}`);
    this.history = this.history?.map(row => row.id === id ? { ...row, favorite } : row) ?? null; this.changed();
    });
  }
  /** Explicit repair discards only an invalid optional override, never a photo or answer. */
  async repairAuxiliary(key: string) {
    const match = /^(favorite|batch-title)\.([a-f0-9-]+)$/i.exec(key);
    if (!match || !z.uuid().safeParse(match[2]).success) throw new Error('该记录不能自动修复，请从备份恢复。');
    await this.lock(async () => {
      let raw: string | null = null; let invalid = false;
      try {
        raw = await this.documents.get(key);
        if (raw !== null) { if (match[1] === 'favorite') readFavorite(raw, key); else decodeDocument(key, raw, LocalBatchTitleSchema); }
      } catch (cause) { if (!(cause instanceof LocalDataError && cause.key === key)) throw cause; invalid = true; }
      if (invalid) await this.documents.remove(key);
      else if (raw !== null) throw new Error('该信息已经正常，无需修复。');
      this.damaged.delete(key); this.history = null; this.changed();
    });
  }
  // Decision: .agents/notes/implemented/storage/2026-10-10-scoped-history-and-batch-edit.md
  private async removalChanges(records: LocalRecordMetadata[], existingKeys: string[]) {
    const selected = new Set(records.map(record => record.session.id));
    const keys = new Set<string>();
    for (const record of records) {
      const id = record.session.id;
      for (const key of existingKeys) if (key.startsWith(`material.${id}.`) || key.startsWith(`study-time.${id}.`)) keys.add(key);
      for (const key of [`summary.${id}`, `record.${id}`, `image.${id}`, `favorite.${id}`, ...record.session.runs.map(run => `diagnostic.${run.id}`)]) keys.add(key);
    }
    const remainingBatches = new Set<string>(); let unknownSibling = false;
    if (records.some(record => record.batch)) for (const key of existingKeys) {
      if (!key.startsWith('record.') || selected.has(key.slice(7))) continue;
      try { const sibling = await this.loadRecord(key.slice(7), false); if (sibling.batch) remainingBatches.add(sibling.batch.id); }
      catch (cause) { this.noteIssue(cause, key.slice(7)); unknownSibling = true; }
    }
    for (const record of records) if (record.batch && !unknownSibling && !remainingBatches.has(record.batch.id)) keys.add(`batch-title.${record.batch.id}`);
    return [...keys].map(key => ({ key, value: null }));
  }
  async remove(id: string) { return this.removeMany([id]); }
  async removeMany(ids: readonly string[]) { return this.lock(async () => {
    const selected = new Set(z.array(z.uuid()).max(MAX_LOCAL_RECORDS).parse(ids)); if (!selected.size) return;
    if (selected.size > 1 && !this.documents.batch) throw new Error('当前存储不支持批量删除事务。');
    const records = await Promise.all([...selected].map(id => this.readMetadata(id)));
    const changes = await this.removalChanges(records, await this.documents.keys());
    await this.batch(changes);
    for (const { key } of changes) this.damaged.delete(key);
    this.history = this.history?.filter(row => !selected.has(row.id)) ?? null; this.changed();
  }); }
  /** Reorder metadata and delete the omitted records in one transaction, without re-encoding images. */
  async editBatch(value: LocalBatchEdit) { return this.lock(async () => {
    const edit = LocalBatchEditSchema.parse(value);
    if (!this.documents.batch) throw new Error('当前存储不支持批次调整事务。');
    const records: LocalRecordMetadata[] = [];
    for (const id of await this.recordIds({ strict: true })) {
      try { const record = await this.readMetadata(id); if (record.batch?.id === edit.batchId) records.push(record); }
      catch (cause) { this.noteIssue(cause, id); throw new Error('存在无法确认归属的记录，请先处理记录维护。'); }
    }
    const ids = new Set(records.map(record => record.session.id));
    if (ids.size !== edit.expectedIds.length || edit.expectedIds.some(id => !ids.has(id))) throw new Error('批次图片已变化，请重新打开调整。');
    const retained = new Set(edit.orderedIds);
    const changes: LocalDocumentChange[] = await this.removalChanges(records.filter(record => !retained.has(record.session.id)), await this.documents.keys());
    for (const [index, id] of edit.orderedIds.entries()) {
      const record = records.find(record => record.session.id === id); if (!record?.batch) throw new Error('批次题目不存在。');
      // Legacy v1 keeps its inline original; v2 updates metadata without touching image keys.
      const original = await this.loadRecord(id, false);
      const next = { ...original, batch: { ...record.batch, position: index + 1 } };
      changes.push({ key: `record.${id}`, value: JSON.stringify(next) }, { key: `summary.${id}`, value: JSON.stringify(this.summary(next)) });
    }
    await this.batch(changes);
    for (const { key, value } of changes) if (value === null) this.damaged.delete(key);
    this.history = null; this.changed();
  }); }
  async removeAll() {
    return this.lock(async () => {
      const keys = (await this.documents.keys()).filter(key => key !== 'study-time.overall' && /^(record|image|material|summary|favorite|diagnostic|batch-title|study-time)\./.test(key));
      await this.batch(keys.map(key => ({ key, value: null })));
      this.damaged.clear();
      this.history = []; this.changed();
    });
  }
  async recoverInterrupted() {
    for (const session of await this.listHistory()) {
      if (!session.pending) continue;
      try { await this.lock(async () => {
        // Recovery changes task metadata only. A missing/corrupt separate photo
        // must not prevent startup and access to the rest of the user's history.
        const record = await this.loadRecord(session.id);
        if (record.session.runs.every(run => terminal(run.status))) return;
        record.session.runs = record.session.runs.map(interruptedRun);
        await this.batch([
          { key: `summary.${session.id}`, value: null },
          { key: `record.${session.id}`, value: JSON.stringify(record) },
          { key: `summary.${session.id}`, value: JSON.stringify(this.summary(record)) },
        ]);
        this.history = null; this.changed();
      }); } catch (cause) { this.noteIssue(cause, session.id); }
    }
  }
}
