import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ available: vi.fn(async () => true), share: vi.fn(async () => {}), write: vi.fn(), remove: vi.fn(), copy: vi.fn(async () => {}), list: vi.fn<() => object[]>(() => []) }));
vi.mock('expo-sharing', () => ({ isAvailableAsync: mocks.available, shareAsync: mocks.share }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'fixture' }));
vi.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///cache/' } },
  Directory: class { create() {} list = mocks.list; },
  File: class {
    uri = 'file:///cache/shared-questions/question-fixture.jpg'; exists = true; type = 'image/jpeg'; size = 3; modificationTime = Date.now();
    constructor(source: unknown) { if (typeof source === 'string') this.uri = source; }
    write = mocks.write; delete = mocks.remove; copy = mocks.copy;
  },
}));
import { File } from 'expo-file-system';
import { shareImage } from './share-image.native';
import { shareImage as webShare } from './share-image.web';
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });
it('writes image bytes to private cache and shares a file with its MIME type', async () => {
  await shareImage('data:image/jpeg;base64,YWJj');
  expect(mocks.write).toHaveBeenCalledWith('YWJj', { encoding: 'base64' });
  expect(mocks.share).toHaveBeenCalledWith('file:///cache/shared-questions/question-fixture.jpg', { mimeType: 'image/jpeg', dialogTitle: '分享题目图片' });
  expect(mocks.remove).not.toHaveBeenCalled(); // Receiver may still be opening the file.
});
it('rejects URLs and oversized images without fetching or sharing them', async () => {
  for (const uri of ['https://example.com/private.jpg', 'file:///secret', 'file:///cache/../secret', 'data:text/html;base64,YWJj', `data:image/jpeg;base64,${'a'.repeat(5_592_433)}`]) await expect(shareImage(uri)).rejects.toThrow();
  expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.share).not.toHaveBeenCalled();
});
it('copies fresh cached camera photos before sharing and bounds retained share files', async () => {
  mocks.list.mockReturnValueOnce(Array.from({ length: 8 }, (_, i) => new File(`file:///cache/shared-questions/${i}.jpg`)));
  await shareImage('file:///cache/camera.jpg');
  expect(mocks.copy).toHaveBeenCalledOnce(); expect(mocks.write).not.toHaveBeenCalled();
  expect(mocks.remove).toHaveBeenCalledOnce(); expect(mocks.share).toHaveBeenCalledOnce();
});
it('serializes duplicate native shares and releases the lock after failure', async () => {
  let reject!: (cause: Error) => void;
  mocks.share.mockImplementationOnce(() => new Promise<void>((_, no) => { reject = no; }));
  const first = shareImage('data:image/jpeg;base64,YWJj');
  await vi.waitFor(() => expect(mocks.share).toHaveBeenCalledOnce());
  await shareImage('data:image/jpeg;base64,YWJj'); expect(mocks.share).toHaveBeenCalledOnce();
  reject(new Error('cancelled')); await expect(first).rejects.toThrow('cancelled'); expect(mocks.remove).toHaveBeenCalledOnce();
  await shareImage('data:image/jpeg;base64,YWJj'); expect(mocks.share).toHaveBeenCalledTimes(2);
});
it('web shares the file itself, handles cancellation and reports unsupported browsers', async () => {
  const share = vi.fn(async (_data: ShareData) => {});
  vi.stubGlobal('navigator', { canShare: () => true, share });
  await webShare('data:image/jpeg;base64,YWJj');
  const file = share.mock.calls[0]![0].files![0]!;
  expect(file.type).toBe('image/jpeg'); expect(await file.text()).toBe('abc');
  share.mockRejectedValueOnce(new DOMException('Cancelled', 'AbortError'));
  await expect(webShare('data:image/jpeg;base64,YWJj')).resolves.toBeUndefined();
  vi.stubGlobal('navigator', {}); await expect(webShare('data:image/jpeg;base64,YWJj')).rejects.toThrow('不支持');
});
