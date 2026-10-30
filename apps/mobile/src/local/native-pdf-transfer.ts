import { ExportTaskFileSchema, MAX_BATCH_PRINT_BYTES, NATIVE_PDF_CHUNK_CHARACTERS } from '@solveflow/contracts/local';
import type { ExportArtifact } from '@solveflow/client/local';

/** Ordered, acknowledged chunks bound bridge messages and reject stale renderer callbacks. */
export class NativePdfTransfer {
  private offset = 0;
  private sequence = 0;
  private written = 0;
  private file: Omit<ExportArtifact, 'data'> | null = null;
  private data: Uint8Array | null = null;
  private disposed = false;
  constructor(readonly id: string, private payload: string) {
    if (payload.length > MAX_BATCH_PRINT_BYTES) throw new Error('等待导出的内容超过128MiB。');
  }
  private check(id: string) { if (this.disposed || id !== this.id) throw new Error('导出已取消或渲染任务不匹配。'); }
  read(id: string, offset: number) {
    this.check(id);
    if (!Number.isSafeInteger(offset) || offset !== this.offset) throw new Error('导出输入顺序不一致。');
    const chunk = this.payload.slice(offset, offset + NATIVE_PDF_CHUNK_CHARACTERS);
    this.offset += chunk.length;
    if (!chunk) this.payload = '';
    return chunk;
  }
  begin(id: string, value: unknown) {
    this.check(id);
    if (this.data) throw new Error('重复的导出文件。');
    const file = ExportTaskFileSchema.parse(value);
    this.file = { name: file.name, mimeType: file.mimeType };
    this.data = new Uint8Array(file.bytes);
  }
  append(id: string, index: number, text: string) {
    this.check(id);
    if (!this.data || index !== this.sequence || !Number.isSafeInteger(index) || !text.length || text.length > NATIVE_PDF_CHUNK_CHARACTERS || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) throw new Error('导出文件分块无效。');
    const binary = atob(text);
    if (this.written + binary.length > this.data.length) throw new Error('导出文件分块超出范围。');
    for (let index = 0; index < binary.length; index++) this.data[this.written + index] = binary.charCodeAt(index);
    this.written += binary.length; this.sequence++;
  }
  finish(id: string): ExportArtifact {
    this.check(id);
    if (!this.data || !this.file || this.written !== this.data.length) throw new Error('导出文件尚未完整传输。');
    const pdf = this.file.mimeType === 'application/pdf';
    const signature = [...this.data.subarray(0, pdf ? 5 : 2)];
    if (signature.join() !== (pdf ? [37, 80, 68, 70, 45] : [80, 75]).join()) throw new Error('导出文件格式无效。');
    const file = { ...this.file, data: this.data };
    this.dispose(); return file;
  }
  dispose() { this.disposed = true; this.payload = ''; this.data = null; this.file = null; }
}
