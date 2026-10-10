import { LocalImageEditSchema, LocalRecordSchema, type LocalImageEdit, type LocalRecord } from '@solveflow/contracts/local';
import { checkHistoryImage } from './history-image.js';
// Decision: .agents/notes/implemented/storage/2026-10-09-correction-image-selection.md

/** Active selection can change; the archived bytes used by older runs cannot. */
export function currentImageIds(record: LocalRecord): string[] {
  return record.activeImageIds ?? [record.session.upload.id, ...(record.materials ?? []).map(item => item.id)];
}

export function applyImageEdit(record: LocalRecord, edit: LocalImageEdit): LocalRecord {
  const parsed = LocalImageEditSchema.parse(edit);
  const known = new Set([record.session.upload.id, ...(record.materials ?? []).map(item => item.id)]);
  for (const material of parsed.additions) {
    if (known.has(material.id) || !parsed.imageIds.includes(material.id)) throw new Error('新增图片重复或未选入本次解答。');
    known.add(material.id);
    checkHistoryImage(material.image, material);
  }
  return LocalRecordSchema.parse({ ...record, activeImageIds: parsed.imageIds, materials: [...(record.materials ?? []), ...parsed.additions] });
}
