export type Crop = { left: number; top: number; right: number; bottom: number };
export const fullCrop: Crop = { left: 0, top: 0, right: 100, bottom: 100 };
export type CropDragTarget = 'move' | keyof Crop | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
/** Gesture deltas are measured from the gesture start, in preview pixels. */
export function dragCrop(start: Crop, target: CropDragTarget, dx: number, dy: number, width: number, height: number): Crop {
  if (![dx, dy, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return start;
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  const x = dx / width * 100; const y = dy / height * 100;
  if (target === 'move') {
    const shiftX = clamp(x, -start.left, 100 - start.right); const shiftY = clamp(y, -start.top, 100 - start.bottom);
    return { left: start.left + shiftX, right: start.right + shiftX, top: start.top + shiftY, bottom: start.bottom + shiftY };
  }
  return {
    left: target.includes('left') ? clamp(start.left + x, 0, start.right - 2) : start.left,
    right: target.includes('right') ? clamp(start.right + x, start.left + 2, 100) : start.right,
    top: target.includes('top') ? clamp(start.top + y, 0, start.bottom - 2) : start.top,
    bottom: target.includes('bottom') ? clamp(start.bottom + y, start.top + 2, 100) : start.bottom,
  };
}
export function cropPixels(crop: Crop, width: number, height: number) {
  if (![width, height].every(value => Number.isInteger(value) && value > 0) || width * height > 20_000_000 || !Object.values(crop).every(Number.isFinite)
    || crop.left < 0 || crop.top < 0 || crop.right > 100 || crop.bottom > 100 || crop.right - crop.left < 2 || crop.bottom - crop.top < 2) throw new Error("请保留完整、足够大的题目区域。");
  const x = Math.floor(width * crop.left / 100); const y = Math.floor(height * crop.top / 100);
  return { originX: x, originY: y, width: Math.ceil(width * crop.right / 100) - x, height: Math.ceil(height * crop.bottom / 100) - y };
}
