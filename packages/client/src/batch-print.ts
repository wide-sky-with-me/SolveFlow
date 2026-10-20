import { z } from 'zod';
import { BatchPrintSnapshotSchema, MAX_BATCH_PRINT_BYTES, MAX_BATCH_PHOTOS, type BatchPrintSnapshot } from '@solveflow/contracts/local';
import { terminal } from '@solveflow/contracts/http';
import type { LocalRepository } from './local-repository.js';

// Decision: .agents/notes/implemented/storage/2026-10-12-batch-pdf-export.md
export async function collectBatchPrint(repository: LocalRepository, batchId: string, signal: AbortSignal, onProgress: (completed: number, total: number) => void): Promise<BatchPrintSnapshot> {
  z.uuid().parse(batchId);
  const check = () => { if (signal.aborted) throw new Error('导出已取消。'); };
  // History may omit damaged metadata or favorites; never mistake that for a smaller batch.
  const members = async () => {
    const history = await repository.listHistory(); check();
    const ids = await repository.recordIds({ strict: true }); check();
    const known = new Set(history.map(row => row.id));
    const rows = history.filter(row => row.batch?.id === batchId).map(row => ({ id: row.id, batch: row.batch, pending: row.pending }));
    for (const id of ids) if (!known.has(id)) {
      const record = await repository.readMetadata(id); check();
      if (record.batch?.id === batchId) rows.push({ id, batch: record.batch, pending: record.session.runs.some(run => !terminal(run.status)) });
    }
    return rows.sort((a, b) => (a.batch?.position ?? 0) - (b.batch?.position ?? 0));
  };
  check();
  const rows = await members();
  if (!rows.length || rows.length > MAX_BATCH_PHOTOS) throw new Error('批次为空或题目数量超限。');
  const records: BatchPrintSnapshot['records'] = []; let bytes = 0;
  for (const row of rows) {
    check(); const record = await repository.read(row.id); check();
    if (record.batch?.id !== batchId || record.batch.position !== row.batch?.position) throw new Error('批次已变化，请重新导出。');
    if (record.session.runs.some(run => !terminal(run.status))) throw new Error('本批还有正在处理的题目，请结束后导出。');
    bytes += new TextEncoder().encode(JSON.stringify(record)).byteLength;
    if (bytes > MAX_BATCH_PRINT_BYTES) throw new Error('本批导出内容超过128MiB，请拆分批次。');
    records.push(record); onProgress(records.length, rows.length);
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  check();
  const latest = await members();
  check();
  if (latest.some(row => row.pending)) throw new Error('本批还有正在处理的题目，请结束后导出。');
  if (latest.length !== rows.length || latest.some(row => !rows.some(previous => previous.id === row.id && previous.batch?.position === row.batch?.position))) throw new Error('批次已变化，请重新导出。');
  const batch = records[0]?.batch; if (!batch) throw new Error('批次归属无法确认。');
  const { position: _position, ...identity } = batch;
  return BatchPrintSnapshotSchema.parse({ schemaVersion: 1, batch: identity, exportedAt: new Date().toISOString(), records });
}
