/** Keep the default 4:3 field of view and at least the saved 2048px long edge. */
export function batchPictureSize(sizes: readonly string[]): string | undefined {
  return sizes.flatMap(size => {
    if (!/^\d+x\d+$/.test(size)) return [];
    const [width = 0, height = 0] = size.split('x').map(Number);
    const long = Math.max(width, height); const short = Math.min(width, height);
    if (!Number.isSafeInteger(long) || long > 20000 || long < 2048 || short < 1536 || long * 3 !== short * 4) return [];
    return [{ size, pixels: width * height }];
  }).sort((a, b) => a.pixels - b.pixels)[0]?.size;
}
