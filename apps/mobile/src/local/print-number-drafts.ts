import { PrintImageAdjustmentSchema, type PrintImageAdjustment } from '@solveflow/contracts/local';

export const printCropSides = ['left', 'top', 'right', 'bottom'] as const;
export type PrintNumberField = 'rotation' | typeof printCropSides[number];
export type PrintNumberDrafts = Partial<Record<PrintNumberField, string>>;

export function printNumberText(value: PrintImageAdjustment, field: PrintNumberField) {
  return field === 'rotation' ? String(value.rotation) : String(Math.round(value.crop[field] * 100_000_000) / 1_000_000);
}

export function parsePrintNumberDrafts(value: PrintImageAdjustment, drafts: PrintNumberDrafts): { adjustment: PrintImageAdjustment | null; error: string; invalid: PrintNumberField[] } {
  function read(field: PrintNumberField, fallback: number, scale = 1) {
    const text = drafts[field];
    if (text === undefined) return fallback;
    return /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(text.trim()) ? Number(text) / scale : NaN;
  }
  // Unedited fields keep full stored precision rather than round-tripping display text.
  const parsed = PrintImageAdjustmentSchema.safeParse({ ...value, rotation: read('rotation', value.rotation), crop: { left: read('left', value.crop.left, 100), top: read('top', value.crop.top, 100), right: read('right', value.crop.right, 100), bottom: read('bottom', value.crop.bottom, 100) } });
  if (parsed.success) return { adjustment: parsed.data, error: '', invalid: [] };
  const rotation = parsed.error.issues.some(issue => issue.path[0] === 'rotation');
  return { adjustment: null, error: rotation ? '旋转角度需为 -15° 至 15° 的完整数字。' : '裁切边界需为 0% 至 100% 的完整数字，宽高至少保留 5%。', invalid: rotation ? ['rotation'] : [...printCropSides] };
}
