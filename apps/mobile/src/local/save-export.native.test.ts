import { beforeEach, expect, it, vi } from 'vitest';
import { MAX_EXPORT_STORED_BYTES } from '@solveflow/contracts/local';

const state = vi.hoisted(() => ({ files: new Map<string, Uint8Array>(), folders: new Set<string>(), sizes: new Map<string, number>(), share: vi.fn(async (_uri: string) => {}), picker: vi.fn(async () => {}), unavailableSize: false, truncateWrites: false }));
vi.mock('expo-sharing', () => ({ isAvailableAsync: async () => true, shareAsync: state.share }));
vi.mock('expo-file-system', () => {
  const uri = (parts: (string | { uri: string })[]) => parts.map(part => typeof part === 'string' ? part : part.uri).join('/');
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) { this.uri = uri(parts); }
    get name() { return this.uri.split('/').at(-1)!; }
    get exists() { return state.files.has(this.uri); }
    get size() { return state.unavailableSize ? null : state.files.get(this.uri)?.length ?? 0; }
    info() { return { exists: this.exists, size: state.files.get(this.uri)?.length ?? 0 }; }
    create() { state.files.set(this.uri, new Uint8Array()); }
    write(input: string | Uint8Array, options?: { append: boolean }) {
      const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
      const old = options?.append ? state.files.get(this.uri) ?? new Uint8Array() : new Uint8Array();
      state.files.set(this.uri, Uint8Array.from([...old, ...data.subarray(0, state.truncateWrites ? 1 : data.length)]));
    }
    async text() { return new TextDecoder().decode(state.files.get(this.uri)); }
    delete() { state.files.delete(this.uri); }
    async move(target: File) { await new Promise<void>(resolve => setTimeout(resolve, 1)); const bytes = state.files.get(this.uri); if (!bytes) throw new Error('Missing staging file'); state.files.set(target.uri, bytes); state.files.delete(this.uri); this.uri = target.uri; }
  }
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) { this.uri = uri(parts); }
    get name() { return this.uri.split('/').at(-1)!; }
    create() { state.folders.add(this.uri); }
    static async pickDirectoryAsync() { await state.picker(); return new Directory('picked'); }
    createFile(name: string) { const file = new File(this, name); file.create(); return file; }
    get size() { return state.sizes.get(this.uri) ?? [...state.files].filter(([key]) => key.startsWith(this.uri + '/')).reduce((sum, [, value]) => sum + value.length, 0); }
    info() { return { exists: true, size: this.size }; }
    list() {
      const direct = (key: string) => key.startsWith(this.uri + '/') && !key.slice(this.uri.length + 1).includes('/');
      return [...[...state.folders].filter(direct).map(key => new Directory(key)), ...[...state.files.keys()].filter(direct).map(key => new File(key))];
    }
    delete() { for (const key of state.files.keys()) if (key.startsWith(this.uri + '/')) state.files.delete(key); state.folders.delete(this.uri); }
  }
  return { File, Directory, Paths: { cache: new Directory('cache') } };
});
import { saveNativeExport, shareNativeExport } from './save-export.native';
const first = '10000000-0000-4000-8000-000000000001'; const second = '10000000-0000-4000-8000-000000000002';
const artifact = { name: 'remark.pdf', mimeType: 'application/pdf' as const, data: new TextEncoder().encode('%PDF-1.3\nbody') };
beforeEach(() => { state.files.clear(); state.folders.clear(); state.sizes.clear(); state.share.mockClear(); state.picker.mockReset(); state.unavailableSize = false; state.truncateWrites = false; });

it.each(['ERR_PICKER_CANCELLED', 'ERR_FILE_PICKING_CANCELLED'])('treats %s as directory picker cancellation without writing or claiming success', async code => {
  state.picker.mockRejectedValueOnce(Object.assign(new Error('Cancelled'), { code }));
  await expect(saveNativeExport(artifact, new AbortController().signal)).resolves.toBeNull();
  expect(state.files.size).toBe(0); expect(state.share).not.toHaveBeenCalled();
});

it('keeps complete share bytes after the chooser returns and reuses an immutable task copy', async () => {
  await shareNativeExport(artifact, new AbortController().signal, first);
  const shared = state.share.mock.calls[0]![0];
  expect(state.files.get(shared)).toEqual(artifact.data);
  expect(shared.endsWith('/remark.pdf')).toBe(true);
  expect([...state.files.keys()].some(key => key.endsWith('/.partial'))).toBe(false);
  const original = state.files.get(shared);
  await shareNativeExport(artifact, new AbortController().signal, first);
  expect(state.files.get(shared)).toBe(original);
});
it('refuses a full recent cache without deleting its files, then expires only old owned copies', async () => {
  await shareNativeExport(artifact, new AbortController().signal, first);
  const folder = `cache/pdf-share-v1/${first}`; state.sizes.set(folder, MAX_EXPORT_STORED_BYTES);
  await expect(shareNativeExport(artifact, new AbortController().signal, second)).rejects.toThrow('分享缓存已满');
  expect(state.share).toHaveBeenCalledTimes(1); expect(state.files.get(`${folder}/remark.pdf`)).toEqual(artifact.data);
  state.files.set(`${folder}/shared-at`, new TextEncoder().encode(String(Date.now() - 25 * 60 * 60 * 1000)));
  await shareNativeExport(artifact, new AbortController().signal, second);
  expect(state.files.has(`${folder}/remark.pdf`)).toBe(false); expect(state.share).toHaveBeenCalledTimes(2);
});
it('pre-cancellation performs no write or system handoff', async () => {
  const controller = new AbortController(); controller.abort();
  await expect(shareNativeExport(artifact, controller.signal, first)).rejects.toThrow();
  expect(state.files.size).toBe(0); expect(state.share).not.toHaveBeenCalled();
});
it('checks fresh native file info when the optional size property is unavailable', async () => {
  state.unavailableSize = true;
  await shareNativeExport(artifact, new AbortController().signal, first);
  expect(state.files.get(state.share.mock.calls[0]![0])).toEqual(artifact.data);
});
it('never reports a truncated directory save as complete and removes the incomplete file', async () => {
  state.truncateWrites = true;
  await expect(saveNativeExport(artifact, new AbortController().signal)).rejects.toThrow('保存文件失败');
  expect([...state.files.keys()].some(key => key.startsWith('picked/'))).toBe(false);
});
