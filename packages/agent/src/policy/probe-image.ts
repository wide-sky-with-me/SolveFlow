import { deflateSync } from "node:zlib";

// Self-authored 5x7 glyphs. No external font, image license, EXIF or student data.
const glyphs: Record<string, readonly string[]> = {
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "x": ["00000", "00000", "10001", "01010", "00100", "01010", "10001"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
  "=": ["00000", "00000", "11111", "00000", "11111", "00000", "00000"],
};
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, bytes: Buffer): Buffer {
  const label = Buffer.from(type); const size = Buffer.alloc(4); size.writeUInt32BE(bytes.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([label, bytes])));
  return Buffer.concat([size, label, bytes, crc]);
}
/** Fixed, valid RGB PNG: 2x + 3 = 7. Ground truth is held by the parent evaluator. */
export function createProbeImage(): Uint8Array {
  const equation = "2x + 3 = 7"; const scale = 8; const padding = 24;
  const width = equation.length * 6 * scale + padding * 2; const height = 7 * scale + padding * 2;
  const stride = width * 3 + 1; const raw = Buffer.alloc(stride * height, 255);
  for (let y = 0; y < height; y++) raw[y * stride] = 0;
  for (let index = 0; index < equation.length; index++) {
    const glyph = glyphs[equation[index] ?? ""]; if (!glyph) continue;
    for (let row = 0; row < 7; row++) for (let col = 0; col < 5; col++) if (glyph[row]?.[col] === "1") {
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const offset = (padding + row * scale + dy) * stride + 1 + (padding + index * 6 * scale + col * scale + dx) * 3;
        raw.fill(0, offset, offset + 3);
      }
    }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
