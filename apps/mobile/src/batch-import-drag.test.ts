import { describe, expect, it } from 'vitest';
import { batchImportLayout } from './batch-import-placement';
import { moveBatchImportPhotos } from './batch-import-drag';

const existing = ['a', 'b', 'c'].map((id, index) => ({ id, position: index + 1 }));
const photos = [{ id: 1 }, { id: 2 }, { id: 3 }];
const layout = batchImportLayout(existing, photos, new Map());
const finalIds = (plan: NonNullable<ReturnType<typeof moveBatchImportPhotos>>) => batchImportLayout(existing, plan.orderedIds.map(id => ({ id })), plan.placements).map(row => row.kind === 'existing' ? row.id : row.photoId);

describe('dragging pending batch images', () => {
  it('moves one pending image before or after an existing record', () => {
    const before = moveBatchImportPhotos(photos, layout, [2], { key: 'record:b', side: 'before' });
    const after = moveBatchImportPhotos(photos, layout, [2], { key: 'record:b', side: 'after' });
    expect(before && finalIds(before)).toEqual(['a', 2, 'b', 'c', 1, 3]);
    expect(after && finalIds(after)).toEqual(['a', 'b', 2, 'c', 1, 3]);
    expect(photos.map(row => row.id)).toEqual([1, 2, 3]);
    expect(layout).toEqual(batchImportLayout(existing, photos, new Map()));
  });
  it('reorders peers sharing one insertion anchor', () => {
    const plan = moveBatchImportPhotos(photos, layout, [3], { key: 'new:1', side: 'before' });
    expect(plan?.orderedIds).toEqual([3, 1, 2]);
    expect(plan && finalIds(plan)).toEqual(['a', 'b', 'c', 3, 1, 2]);
    const middle = moveBatchImportPhotos(photos, layout, [3], { key: 'new:1', side: 'after' });
    expect(middle && finalIds(middle)).toEqual(['a', 'b', 'c', 1, 3, 2]);
  });
  it('gathers a group in confirmed incoming order while keeping existing records in place', () => {
    const scattered = batchImportLayout(existing, photos, new Map([[1, 'c'], [2, 'a']]));
    const plan = moveBatchImportPhotos(photos, scattered, [1, 2, 3], { key: 'record:b', side: 'before' });
    expect(plan && finalIds(plan)).toEqual(['a', 1, 2, 3, 'b', 'c']);
  });
  it('moves a previously inserted image back to the end', () => {
    const inserted = batchImportLayout(existing, photos, new Map([[1, 'a'], [2, 'c']]));
    const plan = moveBatchImportPhotos(photos, inserted, [1], { key: 'end', side: 'before' });
    expect(plan && finalIds(plan)).toEqual(['a', 'b', 2, 'c', 3, 1]);
  });
  it('leaves the draft untouched when dropped on a moving member', () => {
    expect(moveBatchImportPhotos(photos, layout, [1, 2], { key: 'new:2', side: 'before' })).toBeNull();
  });
  it('rejects stale, duplicate and foreign membership instead of silently moving other records', () => {
    expect(() => moveBatchImportPhotos(photos, layout, [9], { key: 'record:a', side: 'before' })).toThrow();
    expect(() => moveBatchImportPhotos(photos, layout, [1, 1], { key: 'record:a', side: 'before' })).toThrow();
    expect(() => moveBatchImportPhotos(photos, layout, [1], { key: 'record:foreign', side: 'before' })).toThrow();
    expect(() => moveBatchImportPhotos(photos, layout.slice(0, -1), [1], { key: 'end', side: 'before' })).toThrow();
  });
});
