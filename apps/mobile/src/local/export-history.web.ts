import { writeHistoryExport, type HistoryExportProgress, type LocalRepository } from '@solveflow/client';
export async function exportHistory(repository: LocalRepository, signal: AbortSignal, onProgress: (progress: HistoryExportProgress) => void): Promise<string | null> {
  const chunks: string[] = []; let bytes = 0;
  await writeHistoryExport(repository, async line => {
    bytes += new TextEncoder().encode(line).byteLength;
    if (bytes > 128 * 1024 * 1024) throw new Error('浏览器导出上限为128MB，请使用安卓本地导出。');
    chunks.push(line); await new Promise<void>(resolve => setTimeout(resolve, 0));
  }, signal, onProgress);
  if (signal.aborted) throw new Error('导出已取消。');
  const name = `solveflow-history-${new Date().toISOString().replace(/[:.]/g, '-')}.ndjson`;
  const url = URL.createObjectURL(new Blob(chunks, { type: 'application/x-ndjson' }));
  const link = document.createElement('a'); link.href = url; link.download = name; document.body.append(link);
  try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  return name;
}
