import type { BatchImportSlot } from './batch-import-placement';

export type BatchImportDropTarget = { key: string; side: 'before' | 'after' };
export type BatchImportDragRequest = { photoIds: readonly number[]; target: BatchImportDropTarget };
export type BatchImportDragPlan = { orderedIds: number[]; placements: Map<number, string | null> };
export const batchImportSlotKey = (row: BatchImportSlot) => row.kind === 'existing' ? `record:${row.id}` : `new:${row.photoId}`;

/** A drag changes only the pending draft; stable existing records never move. */
export function moveBatchImportPhotos(photos: readonly { id: number }[], layout: readonly BatchImportSlot[], movingIds: readonly number[], target: BatchImportDropTarget): BatchImportDragPlan | null {
  const pending = new Set(photos.map(row => row.id)); const moving = new Set(movingIds);
  const members = layout.filter(row => row.kind === 'new');
  if (!moving.size || moving.size !== movingIds.length || pending.size !== photos.length || members.length !== photos.length || new Set(layout.map(batchImportSlotKey)).size !== layout.length || members.some(row => !pending.has(row.photoId)) || movingIds.some(id => !pending.has(id))) throw new Error('待加入题图已变化，请重新选择拖动的题图。');
  const key = (row: BatchImportSlot) => batchImportSlotKey(row);
  const destination = target.key === 'end' ? undefined : layout.find(row => key(row) === target.key);
  if (target.key !== 'end' && !destination) throw new Error('拖动目标已变化，请重新选择位置。');
  if (destination?.kind === 'new' && moving.has(destination.photoId)) return null;
  const remaining = layout.filter(row => row.kind !== 'new' || !moving.has(row.photoId));
  const index = destination ? remaining.findIndex(row => key(row) === target.key) + (target.side === 'after' ? 1 : 0) : remaining.length;
  const byId = new Map(members.map(row => [row.photoId, row]));
  const incoming = photos.filter(row => moving.has(row.id)).map(row => { const slot = byId.get(row.id); if (!slot) throw new Error('拖动的题图已不存在。'); return slot; });
  const next = [...remaining.slice(0, index), ...incoming, ...remaining.slice(index)];
  const placements = new Map<number, string | null>(); let beforeId: string | null = null;
  for (const row of [...next].reverse()) { if (row.kind === 'existing') beforeId = row.id; else placements.set(row.photoId, beforeId); }
  return { orderedIds: next.flatMap(row => row.kind === 'new' ? [row.photoId] : []), placements };
}
