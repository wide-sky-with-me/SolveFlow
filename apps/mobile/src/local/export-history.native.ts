import { Directory } from 'expo-file-system';
import { ZodError } from 'zod';
import { writeHistoryExport, type HistoryExportProgress, type LocalRepository } from '@solveflow/client';
export async function exportHistory(repository: LocalRepository, signal: AbortSignal, onProgress: (progress: HistoryExportProgress) => void): Promise<string | null> {
  let directory: Directory;
  try { directory = await Directory.pickDirectoryAsync(); }
  catch (cause) { if (cause instanceof Error && 'code' in cause && cause.code === 'ERR_PICKER_CANCELLED') return null; throw new Error('无法选择导出目录，请重试。'); }
  if (signal.aborted) throw new Error('导出已取消。');
  const name = `solveflow-history-${new Date().toISOString().replace(/[:.]/g, '-')}.ndjson`;
  const file = directory.createFile(name, 'application/x-ndjson');
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
    }, signal, onProgress);
    return name;
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
