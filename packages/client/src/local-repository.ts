import { z } from 'zod';
import { LocalRecordSchema, LocalFavoriteSchema, LocalDiagnosticsSchema, type LocalDiagnostic, type LocalRecord } from '@solveflow/contracts/local';
import { terminal, type SessionView } from '@solveflow/contracts/http';
import { makeSafeAgentError } from '@solveflow/contracts/agent';
export interface LocalDocuments {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}
export type LocalSessionView = SessionView & { favorite: boolean };
export class LocalRepository {
  constructor(private readonly documents: LocalDocuments) {}
  async list(): Promise<LocalSessionView[]> {
    const ids = (await this.documents.keys()).filter(key => key.startsWith('record.'));
    if (ids.length > 100) throw new Error('本地题目数量超限，请先清理记录。');
    const records: LocalSessionView[] = [];
    for (const id of ids) { const raw = await this.documents.get(id); if (raw) { const session = LocalRecordSchema.parse(JSON.parse(raw)).session; const favorite = await this.documents.get(`favorite.${session.id}`); records.push({ ...session, favorite: favorite ? LocalFavoriteSchema.parse(JSON.parse(favorite)).favorite : false }); } }
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async read(id: string): Promise<LocalRecord> {
    const raw = await this.documents.get(`record.${z.uuid().parse(id)}`);
    if (!raw) throw new Error('本地题目不存在或已删除。');
    return LocalRecordSchema.parse(JSON.parse(raw));
  }
  async save(record: LocalRecord): Promise<void> {
    const parsed = LocalRecordSchema.parse(record);
    if (parsed.session.upload.bytes > 4 * 1024 * 1024) throw new Error('题图超过4MB。');
    await this.documents.put(`record.${parsed.session.id}`, JSON.stringify(parsed));
  }
  async diagnostics(runId: string) {
    const raw = await this.documents.get(`diagnostic.${z.uuid().parse(runId)}`);
    return raw ? LocalDiagnosticsSchema.parse(JSON.parse(raw)).entries : [];
  }
  async saveDiagnostics(runId: string, entries: LocalDiagnostic[]) {
    await this.documents.put(`diagnostic.${z.uuid().parse(runId)}`, JSON.stringify(LocalDiagnosticsSchema.parse({ schemaVersion: 1, runId, entries })));
  }
  async setFavorite(id: string, favorite: boolean) {
    await this.read(id); // Only existing local records may be bookmarked.
    if (z.boolean().parse(favorite)) await this.documents.put(`favorite.${id}`, JSON.stringify(LocalFavoriteSchema.parse({ schemaVersion: 1, favorite: true })));
    else await this.documents.remove(`favorite.${id}`);
  }
  async remove(id: string) { const parsed = z.uuid().parse(id); const record = await this.read(parsed); for (const run of record.session.runs) await this.documents.remove(`diagnostic.${run.id}`); await this.documents.remove(`record.${parsed}`); await this.documents.remove(`favorite.${parsed}`); }
  async recoverInterrupted() {
    for (const session of await this.list()) {
      if (session.runs.every(run => terminal(run.status))) continue;
      const record = await this.read(session.id);
      record.session.runs = record.session.runs.map(run => terminal(run.status) ? run : { ...run, status: 'failed', outcome: { schemaVersion: 1, status: 'failed', verified: false, error: makeSafeAgentError('WORKER_LOST', run.id) } });
      await this.save(record);
    }
  }
}
