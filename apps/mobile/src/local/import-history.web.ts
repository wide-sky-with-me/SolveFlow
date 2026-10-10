import { MAX_HISTORY_ARCHIVE_BYTES, type HistoryImportProgress, type LocalRepository } from '@solveflow/client/local';
export async function importHistory(repository: LocalRepository, signal: AbortSignal, progress: (value: HistoryImportProgress) => void, repairSessionId?: string) {
  const selected = await new Promise<File | null>(resolve => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.ndjson,application/x-ndjson,application/octet-stream';
    const finish = (file: File | null) => { signal.removeEventListener('abort', cancel); input.remove(); resolve(file); };
    const cancel = () => finish(null);
    input.onchange = () => finish(input.files?.[0] ?? null); input.oncancel = cancel;
    signal.addEventListener('abort', cancel, { once: true });
    document.body.append(input); if (signal.aborted) cancel(); else input.click();
  });
  if (!selected) return null;
  if (!selected.size || selected.size > MAX_HISTORY_ARCHIVE_BYTES) throw new Error('请选择不超过768MB的完整备份。');
  // A File is an immutable Blob snapshot; read in bounded chunks on each pass.
  const source = async function* () {
    for (let offset = 0; offset < selected.size; offset += 65_536) {
      if (signal.aborted) throw new Error('恢复已取消。');
      yield new Uint8Array(await selected.slice(offset, offset + 65_536).arrayBuffer());
    }
  };
  return repairSessionId ? repository.restoreQuestion(source, repairSessionId, signal, progress) : repository.importHistory(source, signal, progress);
}
