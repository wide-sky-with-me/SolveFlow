import type { LocalRepository } from './local-repository.js';
export type HistoryExportProgress = { completed: number; total: number };
/** One record at a time: never concatenate all original images in memory. */
export async function writeHistoryExport(repository: LocalRepository, write: (line: string) => Promise<void>, signal: Pick<AbortSignal, 'aborted'>, onProgress?: (progress: HistoryExportProgress) => void): Promise<number> {
  let completed = 0; let total = 0; let bytes = 0;
  for await (const row of repository.exportHistory(signal)) {
    if (signal.aborted) throw new Error('导出已取消。');
    const line = `${JSON.stringify(row)}\n`;
    bytes += new TextEncoder().encode(line).byteLength;
    if (bytes > 768 * 1024 * 1024) throw new Error('导出文件超过768MB，无法继续导出。');
    await write(line);
    if (row.kind === 'header') total = row.count;
    if (row.kind === 'question') completed++;
    onProgress?.({ completed, total });
  }
  return completed;
}
