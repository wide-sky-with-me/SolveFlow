import { imageShareData } from './image-share-data';

export async function shareImage(uri: string): Promise<void> {
  let blob: Blob;
  if (uri.startsWith('blob:')) blob = await (await fetch(uri, { signal: AbortSignal.timeout(10_000) })).blob();
  else {
    const data = imageShareData(uri);
    const bytes = Uint8Array.from(atob(data.base64), character => character.charCodeAt(0));
    blob = new Blob([bytes], { type: data.mimeType });
  }
  if (blob.size > 4 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(blob.type)) throw new Error('无法分享这张题图，请先裁切或重新选择。');
  const file = new File([blob], `solveflow-question.${blob.type === 'image/jpeg' ? 'jpg' : blob.type.slice(6)}`, { type: blob.type });
  if (!navigator.share || !navigator.canShare?.({ files: [file] })) throw new Error('此浏览器暂不支持图片分享，请使用手机 App 或支持系统分享的浏览器。');
  try { await navigator.share({ files: [file], title: '题目图片' }); }
  catch (cause) { if (!(cause instanceof Error && cause.name === 'AbortError')) throw cause; }
}
