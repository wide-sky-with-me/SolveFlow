import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { MAX_HISTORY_ARCHIVE_BYTES, type HistoryImportProgress, type LocalRepository } from '@solveflow/client/local';
export async function importHistory(repository: LocalRepository, signal: AbortSignal, progress: (value: HistoryImportProgress) => void, repairSessionId?: string) {
  const selected = await File.pickFileAsync({ mimeTypes: '*/*' });
  if (selected.canceled) return null;
  return readNativeHistoryFile(repository, selected.result, signal, progress, repairSessionId);
}
/** Read the same bounded private cache for both SAF and isolated native fixtures. */
// Decision: .agents/notes/implemented/storage/2026-10-03-native-storage-acceptance.md
export async function readNativeHistoryFile(repository: LocalRepository, file: File, signal: AbortSignal, progress: (value: HistoryImportProgress) => void, repairSessionId?: string) {
  if (!file.size || file.size > MAX_HISTORY_ARCHIVE_BYTES) throw new Error('请选择不超过768MB的完整备份。');
  const directory = new Directory(Paths.cache, 'history-restore');
  // At most one restore modal exists; clear leftovers from an interrupted process.
  if (directory.exists) directory.delete(); directory.create();
  const local = new File(directory, 'archive.ndjson');
  try {
    if (signal.aborted) throw new Error('恢复已取消。');
    // Expo's copy is asynchronous. Read only after completion and keep the cache
    // alive until copying settles, including when the user cancels during it.
    await file.copy(local);
    if (signal.aborted) throw new Error('恢复已取消。');
    const source = async function* () {
      const handle = local.open(FileMode.ReadOnly);
      try {
        while (true) {
          if (signal.aborted) throw new Error('恢复已取消。');
          const bytes = handle.readBytes(65_536); if (!bytes.length) break;
          yield bytes;
          await new Promise<void>(resolve => setTimeout(resolve, 0));
        }
      } finally { handle.close(); }
    };
    return await (repairSessionId ? repository.restoreQuestion(source, repairSessionId, signal, progress) : repository.importHistory(source, signal, progress));
  } finally { if (directory.exists) directory.delete(); }
}
