import { expect, it } from 'vitest';
import { fileNameTime, movePhoto, orderPhotos, type ImportPhoto } from './batch-photo-order';

const photo = { uri: 'fixture', width: 1, height: 1 };
const rows: ImportPhoto[] = [{ id: 0, photo, fileName: '题10.jpg', timestamp: 30 }, { id: 1, photo, fileName: '题2.jpg', timestamp: 10 }, { id: 2, photo, fileName: '题1.jpg' }];
it('sorts names naturally without mutating selection, and keeps duplicates stable', () => {
  expect(orderPhotos(rows, 'filename').map(row => row.fileName)).toEqual(['题1.jpg', '题2.jpg', '题10.jpg']);
  expect(rows.map(row => row.id)).toEqual([0, 1, 2]);
  expect(orderPhotos([{ ...rows[0]!, fileName: 'same' }, { ...rows[1]!, fileName: 'same' }], 'filename').map(row => row.id)).toEqual([0, 1]);
});
it('sorts known times oldest first and puts unavailable times after known ones', () => {
  expect(orderPhotos(rows, 'time').map(row => row.id)).toEqual([1, 0, 2]);
});
it('preserves all image identities when moved and ignores out-of-range moves', () => {
  expect(movePhoto(rows, 2, -1).map(row => row.id)).toEqual([0, 2, 1]);
  expect(movePhoto(rows, 0, -1)).toEqual(rows);
});
it('does not manufacture timestamps for malformed or nonexistent dates', () => {
  expect(fileNameTime('IMG_20261008_123456.jpg')).toBe(new Date(2026, 9, 8, 12, 34, 56).getTime());
  for (const name of ['IMG_20260230_123456.jpg', 'IMG_20261008_253456.jpg', 'question-1.jpg']) expect(fileNameTime(name)).toBeUndefined();
});
