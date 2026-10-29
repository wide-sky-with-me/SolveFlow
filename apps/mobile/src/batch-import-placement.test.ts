import { describe, expect, it } from 'vitest';
import { batchImportLayout, numberBatchImportLayout } from './batch-import-placement';

const existing = ['a', 'b', 'c'].map((id, index) => ({ id, position: index + 1 }));
const photos = [{ id: 1 }, { id: 2 }, { id: 3 }];
const ids = (items: ReturnType<typeof batchImportLayout>) => items.map(item => item.kind === 'existing' ? item.id : item.photoId);

describe('new batch image workbench', () => {
  it('defaults both single and multiple new images to the end', () => {
    expect(ids(batchImportLayout(existing, photos.slice(0, 1), new Map()))).toEqual(['a', 'b', 'c', 1]);
    expect(ids(batchImportLayout(existing, photos, new Map()))).toEqual(['a', 'b', 'c', 1, 2, 3]);
  });
  it('places new images independently and retains the existing relative order', () => {
    const result = batchImportLayout(existing, photos, new Map([[1, 'b'], [2, 'c'], [3, 'b']]));
    expect(ids(result)).toEqual(['a', 1, 3, 'b', 2, 'c']);
    expect(result.filter(item => item.kind === 'new').map(item => item.beforeId)).toEqual(['b', 'b', 'c']);
  });
  it('keeps assignments attached to image IDs when the incoming group is reordered', () => {
    expect(ids(batchImportLayout(existing, [...photos].reverse(), new Map([[1, 'a'], [3, 'a']])))).toEqual([3, 1, 'a', 'b', 'c', 2]);
  });
  it('uses the menu anchor initially while allowing explicit append overrides', () => {
    expect(ids(batchImportLayout(existing, photos, new Map([[2, null]]), 'b'))).toEqual(['a', 1, 3, 'b', 'c', 2]);
  });
  it('handles removed pending images, gaps and an empty initial batch', () => {
    expect(ids(batchImportLayout(existing.map(row => ({ ...row, position: row.position * 2 })), photos.slice(1), new Map([[1, 'a'], [2, 'c']])))).toEqual(['a', 'b', 2, 'c', 3]);
    expect(ids(batchImportLayout([], photos, new Map()))).toEqual([1, 2, 3]);
  });
  it('rejects deleted anchors and duplicate membership instead of silently appending', () => {
    expect(() => batchImportLayout(existing, photos, new Map([[2, 'deleted']]))).toThrow();
    expect(() => batchImportLayout([...existing, existing[0]!], photos, new Map())).toThrow();
    expect(() => batchImportLayout(existing, [...photos, photos[0]!], new Map())).toThrow();
  });
  it('shows the new and shifted record numbers from the final order', () => {
    const layout = batchImportLayout(existing, photos, new Map([[1, 'b'], [2, 'a']]));
    const numbered = numberBatchImportLayout(existing, layout);
    expect(numbered.map(row => row.position)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(numbered.filter(row => row.kind === 'existing').map(row => [row.id, row.position])).toEqual([['a', 2], ['b', 4], ['c', 5]]);
    expect(numbered.filter(row => row.kind === 'new').map(row => [row.photoId, row.position])).toEqual([[2, 1], [1, 3], [3, 6]]);
    expect(existing.map(row => row.position)).toEqual([1, 2, 3]);
  });
  it('keeps saved gaps for append and normalizes them only for targeted insertion', () => {
    const gapped = [{ id: 'a', position: 2 }, { id: 'b', position: 5 }];
    const incoming = photos.slice(0, 1);
    expect(numberBatchImportLayout(gapped, batchImportLayout(gapped, incoming, new Map())).map(row => row.position)).toEqual([2, 5, 6]);
    expect(numberBatchImportLayout(gapped, batchImportLayout(gapped, incoming, new Map([[1, 'b']]))).map(row => row.position)).toEqual([1, 2, 3]);
    expect(numberBatchImportLayout(gapped, batchImportLayout(gapped, incoming, new Map([[1, null]]))).map(row => row.position)).toEqual([2, 5, 6]);
  });
  it('updates destinations when the selected new image moves between stable targets', () => {
    const incoming = photos.slice(0, 1);
    const at = (beforeId: string | null) => numberBatchImportLayout(existing, batchImportLayout(existing, incoming, new Map([[1, beforeId]])));
    expect(at('b').filter(row => row.kind === 'new').map(row => row.position)).toEqual([2]);
    expect(at('c').filter(row => row.kind === 'new').map(row => row.position)).toEqual([3]);
    expect(at(null).filter(row => row.kind === 'new').map(row => row.position)).toEqual([4]);
  });
});
