export type ImageSize = { width: number; height: number };
export type ImageTransform = { scale: number; x: number; y: number };
export type ImageTouch = { id: string; x: number; y: number };
export const MIN_IMAGE_SCALE = 1;
export const MAX_IMAGE_SCALE = 4;
export const INITIAL_IMAGE_TRANSFORM: ImageTransform = { scale: 1, x: 0, y: 0 };
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function fitImage(image: ImageSize, viewport: ImageSize): ImageSize {
  const ratio = Math.min(viewport.width / image.width, viewport.height / image.height);
  return { width: image.width * ratio, height: image.height * ratio };
}

export function boundImage(transform: ImageTransform, image: ImageSize, viewport: ImageSize): ImageTransform {
  const scale = clamp(transform.scale, MIN_IMAGE_SCALE, MAX_IMAGE_SCALE);
  const limitX = Math.max(0, (image.width * scale - viewport.width) / 2);
  const limitY = Math.max(0, (image.height * scale - viewport.height) / 2);
  return { scale, x: clamp(transform.x, -limitX, limitX), y: clamp(transform.y, -limitY, limitY) };
}

/** Touch coordinates are relative to the untransformed viewport, not the image. */
export function moveImage(transform: ImageTransform, before: ImageTouch[], after: ImageTouch[], image: ImageSize, viewport: ImageSize): ImageTransform {
  const a = before[0]; const b = after[0];
  if (!a || !b || before.length !== after.length || before.some((touch, i) => touch.id !== after[i]?.id)) return transform;
  const a2 = before[1]; const b2 = after[1];
  if (!a2 || !b2) return boundImage({ ...transform, x: transform.x + b.x - a.x, y: transform.y + b.y - a.y }, image, viewport);
  const distance = Math.hypot(a2.x - a.x, a2.y - a.y);
  if (distance < 2) return transform;
  const scale = clamp(transform.scale * Math.hypot(b2.x - b.x, b2.y - b.y) / distance, MIN_IMAGE_SCALE, MAX_IMAGE_SCALE);
  const ratio = scale / transform.scale;
  const anchorX = (a.x + a2.x - viewport.width) / 2;
  const anchorY = (a.y + a2.y - viewport.height) / 2;
  return boundImage({ scale,
    x: (b.x + b2.x - viewport.width) / 2 - (anchorX - transform.x) * ratio,
    y: (b.y + b2.y - viewport.height) / 2 - (anchorY - transform.y) * ratio,
  }, image, viewport);
}
