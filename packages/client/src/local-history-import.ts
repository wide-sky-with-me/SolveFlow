import { checkHistoryImage } from './history-image.js';
import { z } from 'zod';
import { LocalHistoryExportLineSchema, normalizeLegacyLocalRecord, type LocalHistoryExportLine } from '@solveflow/contracts/local';
export const MAX_HISTORY_ARCHIVE_BYTES = 768 * 1024 * 1024;
export const MAX_HISTORY_LINE_BYTES = 64 * 1024 * 1024;
/** Reopen an immutable file for validation and restore. Each chunk is at most 64 KiB. */
export type HistoryImportSource = () => AsyncIterable<Uint8Array>;
export type HistoryImportProgress = { phase: 'checking' | 'restoring'; completed: number };
type Question = Extract<LocalHistoryExportLine, { kind: 'question' }>;
const ReadableHistoryLineSchema = z.preprocess((value: unknown) => {
  if (typeof value !== 'object' || value === null || !('kind' in value) || value.kind !== 'question' || !('record' in value)) return value;
  return { ...value, record: normalizeLegacyLocalRecord(value.record) };
}, LocalHistoryExportLineSchema);
async function* lines(source: HistoryImportSource, signal: Pick<AbortSignal, 'aborted'>) {
  const decoder = new TextDecoder('utf-8', { fatal: true }); let pending = ''; let bytes = 0; let lineBytes = 0;
  for await (const chunk of source()) {
    if (signal.aborted) throw new Error('恢复已取消。');
    bytes += chunk.byteLength;
    if (bytes > MAX_HISTORY_ARCHIVE_BYTES || chunk.byteLength > 65_536) throw new Error('备份超过读取容量限制。');
    // Count original bytes, including multi-byte characters across chunk boundaries.
    let offset = 0;
    for (let index = 0; index < chunk.length; index++) if (chunk[index] === 10) {
      lineBytes += index - offset;
      if (lineBytes > MAX_HISTORY_LINE_BYTES) throw new Error('单题备份过大。');
      pending += decoder.decode(chunk.subarray(offset, index), { stream: true });
      pending += decoder.decode(); yield pending; pending = ''; lineBytes = 0; offset = index + 1;
    }
    lineBytes += chunk.length - offset;
    if (lineBytes > MAX_HISTORY_LINE_BYTES) throw new Error('单题备份过大。');
    pending += decoder.decode(chunk.subarray(offset), { stream: true });
  }
  pending += decoder.decode(); if (pending.trim()) yield pending;
}
export async function* readHistoryArchive(source: HistoryImportSource, signal: Pick<AbortSignal, 'aborted'>): AsyncGenerator<Question> {
  let count: number | null = null; let complete = false;
  const ids = new Set<string>(); const runs = new Set<string>(); const positions = new Set<string>();
  for await (const line of lines(source, signal)) {
    if (signal.aborted) throw new Error('恢复已取消。');
    if (!line.trim()) continue;
    let value: LocalHistoryExportLine;
    try { value = ReadableHistoryLineSchema.parse(JSON.parse(line)); }
    catch { throw new Error('备份格式无效或版本不受支持。'); }
    if (complete) throw new Error('备份结束标记后含有多余内容。');
    if (count === null) { if (value.kind !== 'header') throw new Error('备份缺少文件头。'); count = value.count; continue; }
    if (value.kind === 'complete') { if (value.count !== count || ids.size !== count) throw new Error('备份题目数量不一致。'); complete = true; continue; }
    if (value.kind !== 'question') throw new Error('备份文件头重复。');
    const record = value.record; const id = record.session.id;
    if (!z.uuid().safeParse(id).success || record.session.runs.some(run => !z.uuid().safeParse(run.id).success)) throw new Error('备份题目或解答编号无效。');
    if (ids.has(id) || ids.size >= count) throw new Error('备份题目重复或数量超限。');
    ids.add(id);
    checkHistoryImage(record.image, record.session.upload);
    for (const material of record.materials ?? []) checkHistoryImage(material.image, material);
    const ownRuns = new Set(record.session.runs.map(run => run.id));
    for (const run of record.session.runs) {
      if (run.sessionId !== id || runs.has(run.id) || (run.context && !ownRuns.has(run.context.sourceRunId))) throw new Error('备份解答归属不一致。');
      runs.add(run.id);
    }
    if (record.batch) {
      const key = `${record.batch.id}:${record.batch.position}`;
      if (positions.has(key)) throw new Error('备份批量序号重复。'); positions.add(key);
    }
    yield value;
  }
  if (!complete || signal.aborted) throw new Error(signal.aborted ? '恢复已取消。' : '备份不完整，缺少结束标记。');
}
