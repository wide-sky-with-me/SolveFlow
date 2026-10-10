import { Directory, type File } from 'expo-file-system';
import { ZodError } from 'zod';
import { HISTORY_EXPORT_PART_BYTES, writeHistoryExport, type HistoryExportProgress, type LocalRepository } from '@solveflow/client/local';
export async function exportHistory(repository: LocalRepository, signal: AbortSignal, onProgress: (progress: HistoryExportProgress) => void, part?: { ids: readonly string[]; index: number; total: number }): Promise<string | null> {
  let directory: Directory;
  try { directory = await Directory.pickDirectoryAsync(); }
  catch (cause) { if (cause instanceof Error && 'code' in cause && cause.code === 'ERR_PICKER_CANCELLED') return null; throw new Error('无法选择导出目录，请重试。'); }
  if (signal.aborted) throw new Error('导出已取消。');
  const suffix = part && part.total > 1 ? `-part-${part.index}-of-${part.total}` : '';
  const name = `solveflow-history-${new Date().toISOString().replace(/[:.]/g, '-')}${suffix}.ndjson`;
  const file = directory.createFile(name, 'application/x-ndjson');
  const result = await writeNativeHistoryFile(repository, file, signal, onProgress, part);
  return result === null ? null : name;
}
/** Shared by the SAF picker and the isolated Android acceptance app. */
export async function writeNativeHistoryFile(repository: LocalRepository, file: File, signal: AbortSignal, onProgress: (progress: HistoryExportProgress) => void, part?: { ids: readonly string[]; index: number; total: number }): Promise<string | null> {
  let stage = '读取记录';
  try {
    await writeHistoryExport(repository, async line => {
      stage = '编码记录'; const bytes = new TextEncoder().encode(line); stage = '写入文件';
      for (let offset = 0; offset < bytes.length; offset += 65_536) {
        if (signal.aborted) throw new Error('导出已取消。');
        // expo-file-system 57.0.7 does not retain the ParcelFileDescriptor in
        // content-URI FileHandle. Scoped writes own and close their SAF stream.
        file.write(bytes.subarray(offset, offset + 65_536), { append: true });
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      stage = '读取记录';
    }, signal, onProgress, part?.ids, part ? HISTORY_EXPORT_PART_BYTES : undefined);
    return file.name;
  } catch (cause) {
    let cleanupFailed = false;
    try { file.delete(); } catch { cleanupFailed = true; }
    if (cleanupFailed) throw new Error('导出未完成，所选目录可能留有不完整文件，请删除后重试。');
    if (signal.aborted) return null;
    const fields = cause instanceof ZodError ? cause.issues.slice(0, 3).map(issue => issue.path.map(part => typeof part === 'number' ? part : typeof part === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(part) ? part : '?').join('.')).join(', ') : '';
    const category = cause instanceof RangeError ? '容量限制' : cause instanceof ZodError ? `数据校验${fields ? `：${fields}` : ''}` : '操作失败';
    throw new Error(`导出失败（${stage}／${category}），请检查本地记录、目录权限与存储空间。`);
  }
}
