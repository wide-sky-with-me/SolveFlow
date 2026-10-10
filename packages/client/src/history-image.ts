/** Validate JPEG dimensions before an imported image reaches a native decoder. */
export function checkHistoryImage(image: string, upload: { bytes: number; width: number; height: number }) {
  const encoded = image.slice(image.indexOf(',') + 1);
  const length = Math.floor(encoded.length * 3 / 4) - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
  if (encoded.length % 4 || length !== upload.bytes || length > 4 * 1024 * 1024) throw new Error('备份题图大小不一致。');
  const bytes = atob(encoded); const byte = (i: number) => bytes.charCodeAt(i);
  if (byte(0) !== 255 || byte(1) !== 216 || byte(length - 2) !== 255 || byte(length - 1) !== 217) throw new Error('备份题图不是完整JPEG。');
  let offset = 2; let dimensions = false;
  while (offset < length - 2) {
    if (byte(offset++) !== 255) break;
    while (byte(offset) === 255) offset++;
    const marker = byte(offset++);
    if (marker === 218) { if (dimensions) return; break; }
    const size = byte(offset) * 256 + byte(offset + 1);
    if (size < 2 || offset + size > length) break;
    if ([192, 193, 194].includes(marker)) {
      if (size < 8) break;
      const height = byte(offset + 3) * 256 + byte(offset + 4); const width = byte(offset + 5) * 256 + byte(offset + 6);
      if (height !== upload.height || width !== upload.width || height < 1 || width < 1 || height > 2048 || width > 2048) throw new Error('备份题图尺寸不一致或超限。');
      dimensions = true;
    } else if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) throw new Error('不支持此JPEG编码。');
    offset += size;
  }
  throw new Error('备份JPEG结构不完整。');
}
