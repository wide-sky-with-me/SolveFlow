'use dom';
// Decision: .agents/notes/implemented/storage/2026-10-30-native-quick-pdf.md
import { useEffect } from 'react';
import { MAX_BATCH_PRINT_BYTES, NATIVE_PDF_CHUNK_CHARACTERS } from '@solveflow/contracts/local';
import { ExportTaskFailure } from '@solveflow/client/local';
import { nativePdfItems } from '../local/native-pdf-input';
import { buildDirectBatchPdfs } from '../local/direct-batch-pdf.web';
import { formatBatchPdfProgress } from '../local/download-batch-pdfs.web';

export default function NativePdfDocument({ id, onRead, onProgress, onHeader, onChunk, onComplete, onFailure }: {
  id: string; dom?: import('expo/dom').DOMProps;
  onRead: (id: string, offset: number) => Promise<string>;
  onProgress: (id: string, value: string) => Promise<void>;
  onHeader: (id: string, value: unknown) => Promise<void>;
  onChunk: (id: string, index: number, value: string) => Promise<void>;
  onComplete: (id: string) => Promise<void>;
  onFailure: (id: string, message: string) => Promise<void>;
}) {
  useEffect(() => {
    const operation = new AbortController();
    void (async () => {
      const chunks: string[] = []; let offset = 0;
      while (true) {
        operation.signal.throwIfAborted();
        const chunk = await onRead(id, offset);
        if (!chunk) break;
        if (chunk.length > NATIVE_PDF_CHUNK_CHARACTERS || offset + chunk.length > MAX_BATCH_PRINT_BYTES) throw new Error('INVALID_PDF_INPUT');
        chunks.push(chunk); offset += chunk.length;
      }
      operation.signal.throwIfAborted();
      const value: unknown = JSON.parse(chunks.join('')); chunks.length = 0;
      const { items, archiveName } = nativePdfItems(value);
      const artifact = await buildDirectBatchPdfs(items, archiveName, operation.signal, value => { void onProgress(id, formatBatchPdfProgress(value)).catch(() => {}); }, value => { void onProgress(id, value).catch(() => {}); });
      operation.signal.throwIfAborted();
      await onHeader(id, { name: artifact.name, mimeType: artifact.mimeType, bytes: artifact.data.byteLength });
      const bytesPerChunk = NATIVE_PDF_CHUNK_CHARACTERS / 4 * 3;
      for (let offset = 0, index = 0; offset < artifact.data.length; offset += bytesPerChunk, index++) {
        operation.signal.throwIfAborted();
        const bytes = artifact.data.subarray(offset, offset + bytesPerChunk);
        let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
        await onChunk(id, index, btoa(binary));
      }
      operation.signal.throwIfAborted(); await onComplete(id);
    })().catch(async (cause: unknown) => {
      if (!operation.signal.aborted) await onFailure(id, cause instanceof ExportTaskFailure ? cause.message : 'PDF生成失败，请核对已保存题干和补图后重试。');
    });
    return () => operation.abort();
  }, [id]);
  return <div data-testid="native-pdf-renderer" aria-hidden="true" />;
}
