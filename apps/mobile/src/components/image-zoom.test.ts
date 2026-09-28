import { expect, it } from 'vitest';
import { boundImage, fitImage, INITIAL_IMAGE_TRANSFORM, moveImage } from './image-zoom';
const viewport = { width: 300, height: 400 };
const touch = (id: string, x: number, y: number) => ({ id, x, y });
it('fits both portrait and landscape without cropping', () => {
  expect(fitImage({ width: 1200, height: 600 }, viewport)).toEqual({ width: 300, height: 150 });
  expect(fitImage({ width: 600, height: 1200 }, viewport)).toEqual({ width: 200, height: 400 });
});
it('keeps the pinched image point under the moving midpoint', () => {
  const result = moveImage(INITIAL_IMAGE_TRANSFORM, [touch('a', 50, 180), touch('b', 150, 180)], [touch('a', 10, 190), touch('b', 210, 190)], viewport, viewport);
  expect(result).toEqual({ scale: 2, x: 60, y: 30 });
  expect(150 + (100 - 150) * result.scale + result.x).toBe(110);
  expect(200 + (180 - 200) * result.scale + result.y).toBe(190);
});
it('bounds scale and drag, recenters at minimum, and prevents blank margins on a fitted axis', () => {
  expect(boundImage({ scale: 20, x: 9000, y: -9000 }, viewport, viewport)).toEqual({ scale: 4, x: 450, y: -600 });
  expect(boundImage({ scale: 0.1, x: 120, y: 40 }, viewport, viewport)).toEqual(INITIAL_IMAGE_TRANSFORM);
  expect(boundImage({ scale: 2, x: 120, y: 40 }, { width: 300, height: 100 }, viewport)).toEqual({ scale: 2, x: 120, y: 0 });
});
it('rebases when fingers change and allows one-finger dragging after a pinch', () => {
  const zoom = { scale: 2, x: 0, y: 0 };
  expect(moveImage(zoom, [touch('a', 10, 10), touch('b', 90, 10)], [touch('b', 90, 10)], viewport, viewport)).toEqual(zoom);
  expect(moveImage(zoom, [touch('a', 10, 10)], [touch('b', 90, 10)], viewport, viewport)).toEqual(zoom);
  expect(moveImage(zoom, [touch('b', 90, 10)], [touch('b', 130, 30)], viewport, viewport)).toEqual({ scale: 2, x: 40, y: 20 });
});
