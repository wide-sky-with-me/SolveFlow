/** Keep selectors explicit: desktop browsers may report an empty HEIC MIME type. */
export const IMAGE_INPUT_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,image/heic-sequence,image/heif-sequence,.heic,.heif';
const brands = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);
export function hasHeifHeader(bytes: Uint8Array): boolean {
  if (bytes.length < 16 || String.fromCharCode(...bytes.subarray(4, 8)) !== 'ftyp') return false;
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (size < 16 || size > 4096 || size % 4) return false;
  const identifiers: string[] = [];
  for (let offset = 8; offset + 4 <= Math.min(size, bytes.length); offset += 4) if (offset !== 12) identifiers.push(String.fromCharCode(...bytes.subarray(offset, offset + 4)));
  if (identifiers.some(brand => brand === 'avif' || brand === 'avis')) return false;
  return identifiers.some(brand => brands.has(brand));
}

// Decision: .agents/notes/implemented/rendering/2026-11-05-main-camera-input.md
export const MAX_SOURCE_IMAGE_BYTES = 32 * 1024 * 1024;
export const MAX_SOURCE_IMAGE_PIXELS = 64_000_000;
export const MAX_IMAGE_PREVIEW_EDGE = 4096;
/** Source decoding may accept a camera original; crop/storage contracts still receive a bounded preview. */
export function imagePreviewSize(width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > MAX_SOURCE_IMAGE_PIXELS) throw new Error('图片分辨率超过6400万像素，请先缩小。');
  const scale = Math.min(1, MAX_IMAGE_PREVIEW_EDGE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
export function rasterSize(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && bytes[0] === 137 && String.fromCharCode(...bytes.subarray(1, 4)) === 'PNG') return { width: view.getUint32(16), height: view.getUint32(20) };
  if (bytes.length >= 30 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') {
    const kind = String.fromCharCode(...bytes.subarray(12, 16));
    const uint24 = (offset: number) => bytes[offset]! + bytes[offset + 1]! * 256 + bytes[offset + 2]! * 65536;
    if (kind === 'VP8X') return { width: uint24(24) + 1, height: uint24(27) + 1 };
    if (kind === 'VP8 ' && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) return { width: view.getUint16(26, true) & 16383, height: view.getUint16(28, true) & 16383 };
    if (kind === 'VP8L' && bytes[20] === 47) return { width: 1 + (view.getUint32(21, true) & 16383), height: 1 + ((view.getUint32(21, true) >>> 14) & 16383) };
  }
  for (const { marker, offset, size } of jpegSegments(bytes)) if ([192, 193, 194].includes(marker) && size >= 8) return { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) };
  return null;
}
function* jpegSegments(bytes: Uint8Array) {
  if (bytes[0] !== 255 || bytes[1] !== 216) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 2; offset + 4 <= bytes.length;) {
    if (bytes[offset++] !== 255) return;
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++]; if (marker === undefined || marker === 218 || marker === 217) return;
    const size = offset + 2 <= bytes.length ? view.getUint16(offset) : 0;
    if (size < 2 || offset + size > bytes.length) return;
    yield { marker, offset, size }; offset += size;
  }
}
function exifOrientation(bytes: Uint8Array, start: number, end: number): number {
  if (String.fromCharCode(...bytes.subarray(start, start + 6)) === 'Exif\0\0') start += 6;
  if (start + 8 > end) return 1;
  const order = String.fromCharCode(...bytes.subarray(start, start + 2)); if (order !== 'II' && order !== 'MM') return 1;
  const little = order === 'II', view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(start + 2, little) !== 42) return 1;
  const offset = view.getUint32(start + 4, little), directory = start + offset;
  if (offset < 8 || directory + 2 > end) return 1;
  const count = view.getUint16(directory, little); if (count > 4096 || directory + 2 + count * 12 > end) return 1;
  for (let index = 0; index < count; index++) {
    const entry = directory + 2 + index * 12;
    if (view.getUint16(entry, little) !== 274 || view.getUint16(entry + 2, little) !== 3 || view.getUint32(entry + 4, little) !== 1) continue;
    const orientation = view.getUint16(entry + 8, little); return orientation >= 1 && orientation <= 8 ? orientation : 1;
  }
  return 1;
}
/** Only IFD0 orientation is read; offsets and entries stay within the bounded input header. */
export function rasterOrientation(bytes: Uint8Array): number {
  for (const { marker, offset, size } of jpegSegments(bytes)) if (marker === 225 && String.fromCharCode(...bytes.subarray(offset + 2, offset + 8)) === 'Exif\0\0') return exifOrientation(bytes, offset + 2, offset + size);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] === 137 && String.fromCharCode(...bytes.subarray(1, 4)) === 'PNG') {
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const size = view.getUint32(offset); if (size > bytes.length - offset - 12) return 1;
      if (String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) === 'eXIf') return exifOrientation(bytes, offset + 8, offset + 8 + size);
      offset += size + 12;
    }
  }
  if (String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') {
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const size = view.getUint32(offset + 4, true); if (size > bytes.length - offset - 8) return 1;
      if (String.fromCharCode(...bytes.subarray(offset, offset + 4)) === 'EXIF') return exifOrientation(bytes, offset + 8, offset + 8 + size);
      offset += 8 + size + size % 2;
    }
  }
  return 1;
}
