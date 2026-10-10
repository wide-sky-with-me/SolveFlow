import { Directory, File, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import { imageShareData } from './image-share-data';

let sharing = false;
export async function shareImage(uri: string): Promise<void> {
  if (sharing) return;
  sharing = true;
  let file: File | undefined;
  try {
    const source = uri.startsWith(Paths.cache.uri) && !decodeURIComponent(uri).split('/').includes('..') ? new File(uri) : null;
    const data = source ? { mimeType: source.type, extension: source.type === 'image/jpeg' ? 'jpg' : source.type.slice(6) } : imageShareData(uri);
    if (source && (!source.exists || source.size > 4 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(data.mimeType))) throw new Error('无法分享这张题图，请先裁切或重新选择。');
    if (!await isAvailableAsync()) throw new Error('此设备暂不支持图片分享。');
    const directory = new Directory(Paths.cache, 'shared-questions');
    directory.create({ intermediates: true, idempotent: true });
    // A chooser can resolve before the receiving app finishes reading. Keep up
    // to eight immutable cache files; expire old ones on the next explicit share.
    const files = directory.list().filter((entry): entry is File => entry instanceof File).sort((a, b) => (b.modificationTime ?? 0) - (a.modificationTime ?? 0));
    for (const [index, entry] of files.entries()) {
      if (index >= 7 || Date.now() - (entry.modificationTime ?? 0) > 86_400_000) entry.delete();
    }
    file = new File(directory, `question-${randomUUID()}.${data.extension}`);
    if (source) await source.copy(file);
    else if ('base64' in data) file.write(data.base64, { encoding: 'base64' });
    await shareAsync(file.uri, { mimeType: data.mimeType, dialogTitle: '分享题目图片' });
  } catch (cause) {
    if (file?.exists) file.delete();
    throw cause;
  } finally { sharing = false; }
}
