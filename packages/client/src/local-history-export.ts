import { MAX_HISTORY_ARCHIVE_BYTES, MAX_HISTORY_LINE_BYTES } from './local-history-import.js';
import { LocalDataError, type LocalRepository } from './local-repository.js';

export type HistoryExportProgress = { completed: number; total: number };
export const HISTORY_EXPORT_PART_BYTES = 128 * 1024 * 1024;
export type HistoryExportPart = { ids: string[]; bytes: number };
export type HistoryExportPlan = { parts: HistoryExportPart[]; skipped: string[] };

// Header + complete currently use under 256 bytes. Keep headroom for decimal counts.
const PART_ENVELOPE_RESERVE_BYTES = 1024;

/** Only IDs and byte counts survive planning; original photos are read one at a time. */
// Decision: .agents/notes/implemented/storage/2026-10-03-backup-and-atomic-repair.md
export async function planHistoryExport(
  repository: LocalRepository,
  signal: Pick<AbortSignal, 'aborted'>,
  onProgress?: (progress: HistoryExportProgress) => void,
  maxBytes = HISTORY_EXPORT_PART_BYTES,
): Promise<HistoryExportPlan> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 2048 || maxBytes > HISTORY_EXPORT_PART_BYTES) {
    throw new Error('备份分卷容量无效。');
  }
  const ids = (await repository.recordIds()).sort();
  const parts: HistoryExportPart[] = [];
  const skipped = repository.issues.filter(issue => issue.key.startsWith('record.') && !issue.sessionId).map(issue => issue.key);
  let part: HistoryExportPart = { ids: [], bytes: PART_ENVELOPE_RESERVE_BYTES };
  let completed = 0;

  for (const id of ids) {
    if (signal.aborted) throw new Error('导出已取消。');
    try {
      const row = await repository.exportQuestion(id);
      const bytes = new TextEncoder().encode(`${JSON.stringify(row)}\n`).byteLength;
      if (bytes > MAX_HISTORY_LINE_BYTES || bytes + PART_ENVELOPE_RESERVE_BYTES > maxBytes) {
        throw new Error('单题备份过大，无法分卷。');
      }
      if (part.ids.length && part.bytes + bytes > maxBytes) {
        parts.push(part);
        part = { ids: [], bytes: PART_ENVELOPE_RESERVE_BYTES };
      }
      part.ids.push(id);
      part.bytes += bytes;
    } catch (cause) {
      // Known damaged records are reported; I/O failures must stop the export.
      if (!(cause instanceof LocalDataError)) throw cause;
      skipped.push(id);
    }
    onProgress?.({ completed: ++completed, total: ids.length });
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }

  if (signal.aborted) throw new Error('导出已取消。');
  if (part.ids.length || (ids.length === 0 && skipped.length === 0)) parts.push(part);
  return { parts, skipped };
}

/** One record at a time: never concatenate all original images in memory. */
export async function writeHistoryExport(
  repository: LocalRepository,
  write: (line: string) => Promise<void>,
  signal: Pick<AbortSignal, 'aborted'>,
  onProgress?: (progress: HistoryExportProgress) => void,
  selectedIds?: readonly string[],
  maxBytes = MAX_HISTORY_ARCHIVE_BYTES,
): Promise<number> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 2048 || maxBytes > MAX_HISTORY_ARCHIVE_BYTES) {
    throw new Error('备份容量无效。');
  }
  let completed = 0;
  let total = 0;
  let bytes = 0;

  // Recheck actual output: a plan is not a transaction and records may have changed.
  for await (const row of repository.exportHistory(signal, selectedIds)) {
    if (signal.aborted) throw new Error('导出已取消。');
    const line = `${JSON.stringify(row)}\n`;
    const size = new TextEncoder().encode(line).byteLength;
    if (size > MAX_HISTORY_LINE_BYTES) throw new Error('单题备份过大，无法导出。');
    bytes += size;
    if (bytes > maxBytes) throw new Error('备份超过分卷容量，请重新整理后导出。');
    await write(line);
    if (row.kind === 'header') total = row.count;
    if (row.kind === 'question') completed++;
    onProgress?.({ completed, total });
  }
  return completed;
}
