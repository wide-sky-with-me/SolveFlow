import { releasePhoto, transformPhoto } from './platform';
import type { Photo } from './platform.types';

type Prepared = { ok: true; photo: Photo } | { ok: false; cause: unknown };
interface Entry { result: Promise<Prepared>; claimed: boolean; released: boolean }

/** Only normalization overlaps; callers retain serial durable saves and admissions. */
// Decision: .agents/notes/implemented/storage/2026-10-23-batch-import-preparation.md
export function prepareBatchPhotos(photos: readonly Photo[]) {
  const pending = new Map<number, Entry>();
  let closed = false;
  let closing: Promise<void> | null = null;
  async function discard(index: number) {
    const entry = pending.get(index); if (!entry) return;
    const result = await entry.result;
    try { if (result.ok && !entry.claimed && !entry.released) { entry.released = true; releasePhoto(result.photo); } }
    finally { pending.delete(index); }
  }
  return {
    get(index: number): () => Promise<Photo> {
      if (closed || !Number.isInteger(index) || index < 0 || index >= photos.length) throw new Error('批量导入已关闭。');
      for (let next = index; next < Math.min(photos.length, index + 2); next++) {
        const photo = photos[next];
        if (photo && !pending.has(next)) {
          if (pending.size >= 2) throw new Error('请先完成当前图片保存。');
          pending.set(next, { claimed: false, released: false, result: Promise.resolve().then(() => transformPhoto(photo)).then<Prepared, Prepared>(value => ({ ok: true, photo: value }), (cause: unknown) => ({ ok: false, cause })) });
        }
      }
      const entry = pending.get(index); if (!entry) throw new Error('待导入图片不存在。');
      return async () => {
        if (closed || entry.claimed) throw new Error('图片预处理已结束。');
        entry.claimed = true;
        const result = await entry.result; if (!result.ok) throw result.cause;
        // Ownership transfers only when saveBatchPhoto actually requests this image.
        return result.photo;
      };
    },
    discard,
    dispose() {
      closed = true;
      // Retain raw inputs until every native decode has settled, including late results.
      closing ??= (async () => {
        const results = await Promise.allSettled([...pending.keys()].map(discard));
        const failures: unknown[] = [];
        for (const result of results) if (result.status === 'rejected') { const cause: unknown = result.reason; failures.push(cause); }
        if (failures.length) throw new AggregateError(failures, '图片预处理资源释放失败。');
      })();
      return closing;
    },
  };
}
