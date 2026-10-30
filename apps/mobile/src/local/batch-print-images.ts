import type { LocalRecord } from '@solveflow/contracts/local';

export type PrintImages = Record<string, string>;
export function printImageKey(recordId: string, imageId: string) { return `${recordId}/${imageId}`; }
export function recordPrintImages(record: LocalRecord, scope: 'current' | 'history' = 'current') {
  const images = [{ id: record.session.upload.id, image: record.image }, ...(record.materials ?? []).map(item => ({ id: item.id, image: item.image }))];
  if (scope === 'history' || !record.activeImageIds) return images;
  return record.activeImageIds.flatMap(id => { const source = images.find(source => source.id === id); return source ? [source] : []; });
}
