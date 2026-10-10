import { HISTORY_EXPORT_PART_BYTES, writeHistoryExport, type HistoryExportProgress, type LocalRepository } from '@solveflow/client/local';
export async function exportHistory(repository: LocalRepository, signal: AbortSignal, onProgress: (progress: HistoryExportProgress) => void, part?: { ids: readonly string[]; index: number; total: number }): Promise<string | null> {
  const chunks: string[] = []; let bytes = 0;
  await writeHistoryExport(repository, async line => {
    bytes += new TextEncoder().encode(line).byteLength;
    if (bytes > HISTORY_EXPORT_PART_BYTES) throw new Error('本卷超过128MiB，请重新整理后导出。');
    chunks.push(line); await new Promise<void>(resolve => setTimeout(resolve, 0));
  }, signal, onProgress, part?.ids, HISTORY_EXPORT_PART_BYTES);
  if (signal.aborted) throw new Error('导出已取消。');
  const suffix = part && part.total > 1 ? `-part-${part.index}-of-${part.total}` : '';
  const name = `solveflow-history-${new Date().toISOString().replace(/[:.]/g, '-')}${suffix}.ndjson`;
  const url = URL.createObjectURL(new Blob(chunks, { type: 'application/x-ndjson' }));
  const link = document.createElement('a'); link.href = url; link.download = name; document.body.append(link);
  try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  return name;
}
