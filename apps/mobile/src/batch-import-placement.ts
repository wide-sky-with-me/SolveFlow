export type ExistingBatchImage = { id: string; position: number; text?: string };
export type BatchImportSlot = { kind: 'existing'; id: string } | { kind: 'new'; photoId: number; beforeId: string | null };

/** Existing image IDs anchor the draft; only confirmation admits new records. */
// Decision: .agents/notes/implemented/storage/2026-10-27-batch-import-workbench.md
export function batchImportLayout(existing: readonly ExistingBatchImage[], photos: readonly { id: number }[], placements: ReadonlyMap<number, string | null>, fallback: string | null = null): BatchImportSlot[] {
  const ids = new Set(existing.map(row => row.id));
  if (ids.size !== existing.length || new Set(photos.map(row => row.id)).size !== photos.length) throw new Error('题图列表重复，请重新打开导入。');
  const groups = new Map<string | null, BatchImportSlot[]>();
  for (const photo of photos) {
    const beforeId = placements.has(photo.id) ? placements.get(photo.id) ?? null : fallback;
    if (beforeId !== null && !ids.has(beforeId)) throw new Error('插入位置已不存在，请重新选择。');
    const group = groups.get(beforeId) ?? [];
    group.push({ kind: 'new', photoId: photo.id, beforeId }); groups.set(beforeId, group);
  }
  return [...existing.flatMap(row => [...groups.get(row.id) ?? [], { kind: 'existing' as const, id: row.id }]), ...groups.get(null) ?? []];
}

/** Targeted insertion renumbers siblings; ordinary append keeps stored gaps. */
export function numberBatchImportLayout(existing: readonly ExistingBatchImage[], layout: readonly BatchImportSlot[]): (BatchImportSlot & { position: number })[] {
  const positions = new Map(existing.map(row => [row.id, row.position]));
  const normalize = layout.some(row => row.kind === 'new' && row.beforeId !== null);
  let last = Math.max(0, ...positions.values());
  return layout.map((row, index) => {
    const position = normalize ? index + 1 : row.kind === 'new' ? ++last : positions.get(row.id);
    if (position === undefined) throw new Error('预览题图已不存在，请重新打开导入。');
    return { ...row, position };
  });
}
