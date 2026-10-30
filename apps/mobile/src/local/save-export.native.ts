import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { z } from 'zod';
import { MAX_EXPORT_STORED_BYTES, MAX_EXPORT_TASK_RECORDS } from '@solveflow/contracts/local';
import { requireExportActive, type ExportArtifact } from '@solveflow/client/local';

async function write(file: File, artifact: ExportArtifact, signal: AbortSignal) {
  try {
    for (let offset = 0; offset < artifact.data.length; offset += 65536) {
      requireExportActive(signal); file.write(artifact.data.subarray(offset, offset + 65536), { append: true });
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    requireExportActive(signal);
    const info = file.info();
    if (!info.exists || info.size !== artifact.data.byteLength) throw new Error('Incomplete file');
  } catch (cause) {
    try { file.delete(); } catch { throw new Error('保存未完成，所选位置可能留有不完整文件，请删除后重试。'); }
    if (signal.aborted) throw cause;
    throw new Error('保存文件失败，请检查目录权限和设备空间。');
  }
}
export async function saveNativeExport(artifact: ExportArtifact, signal: AbortSignal): Promise<string | null> {
  let directory: Directory;
  try { directory = await Directory.pickDirectoryAsync(); }
  catch (cause) { if (cause instanceof Error && 'code' in cause && (cause.code === 'ERR_PICKER_CANCELLED' || cause.code === 'ERR_FILE_PICKING_CANCELLED')) return null; throw new Error('无法选择保存目录，请重试。'); }
  requireExportActive(signal);
  const file = directory.createFile(artifact.name, artifact.mimeType);
  await write(file, artifact, signal); return file.name;
}
export async function shareNativeExport(artifact: ExportArtifact, signal: AbortSignal, taskId: string): Promise<void> {
  if (!await Sharing.isAvailableAsync()) throw new Error('当前设备没有可用的文件分享入口。');
  requireExportActive(signal); z.uuid().parse(taskId);
  const cache = new Directory(Paths.cache, 'pdf-share-v1'); cache.create({ idempotent: true, intermediates: true });
  const entries = cache.list(); let used = 0; let retained = 0;
  if (entries.length > MAX_EXPORT_TASK_RECORDS) throw new Error('分享缓存暂不可用，请使用保存文件。');
  for (const entry of entries) {
    requireExportActive(signal);
    if (!(entry instanceof Directory) || !z.uuid().safeParse(entry.name).success) throw new Error('分享缓存信息无效，请使用保存文件。');
    const stamp = new File(entry, 'shared-at');
    const stampInfo = stamp.info();
    const time = stampInfo.exists && typeof stampInfo.size === 'number' && stampInfo.size <= 32 ? Number(await stamp.text()) : 0;
    if (Number.isFinite(time) && time > 0 && Date.now() - time > 24 * 60 * 60 * 1000) { entry.delete(); continue; }
    const size = entry.info().size;
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) throw new Error('无法检查分享缓存，请使用保存文件。');
    used += size; retained++;
  }
  const directory = new Directory(cache, taskId); const file = new File(directory, artifact.name);
  if (!file.exists) {
    if (used + artifact.data.byteLength > MAX_EXPORT_STORED_BYTES || retained >= MAX_EXPORT_TASK_RECORDS) throw new Error('分享缓存已满，请使用保存文件；旧分享副本会在过期后清理。');
    directory.create({ idempotent: true, intermediates: true });
    const attemptStamp = new File(directory, 'shared-at'); attemptStamp.create({ overwrite: true }); attemptStamp.write(String(Date.now()));
    // Receivers only see the complete renamed file, never a partially written share.
    const pending = new File(directory, '.partial'); pending.create({ overwrite: true });
    await write(pending, artifact, signal); await pending.move(file);
  }
  const info = file.info();
  if (!info.exists || info.size !== artifact.data.byteLength) throw new Error('分享缓存不完整，请使用保存文件。');
  const stamp = new File(directory, 'shared-at'); stamp.create({ overwrite: true }); stamp.write(String(Date.now()));
  requireExportActive(signal);
  // Android resolves when the chooser returns, before a recipient necessarily reads the URI.
  // Keep a bounded, expiring copy rather than deleting it in shareAsync's finally.
  await Sharing.shareAsync(file.uri, { mimeType: artifact.mimeType, UTI: artifact.mimeType === 'application/pdf' ? 'com.adobe.pdf' : 'public.zip-archive', dialogTitle: '保存或分享导出文件' });
}
