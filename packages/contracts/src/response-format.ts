import { z } from 'zod';

export const MAX_ANSWER_CHARACTERS = 8000;
export const MAX_USER_MESSAGE_CHARACTERS = 8000;
export const ResponseFormatSchema = z.strictObject({
  type: z.enum(['single-choice', 'multiple-choice', 'numeric', 'short-answer', 'essay', 'multipart', 'drawing']),
  wordLimit: z.number().int().min(1).max(10000).optional(),
  parts: z.array(z.string().trim().min(1).max(40)).min(2).max(12).refine(parts => new Set(parts).size === parts.length, '小问标签不能重复').optional(),
  numericFormat: z.literal('sat-spr').optional(),
});
export const ResponsePartsSchema = z.array(z.strictObject({
  label: z.string().trim().min(1).max(40), answer: z.string().trim().min(1).max(MAX_ANSWER_CHARACTERS),
})).min(2).max(12).refine(parts => new Set(parts.map(part => part.label)).size === parts.length && parts.reduce((length, part) => length + part.answer.length, 0) <= MAX_ANSWER_CHARACTERS, '小问标签须唯一，正文总长不能超限');
/** A reproducible local aid, not the official exam software's counting algorithm. */
export function responseWordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/u).length : 0;
}
export function validSatResponse(value: string): boolean {
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+|\d+\/\d+)$/.test(value)) return false;
  if (value.length > (value.startsWith('-') ? 6 : 5)) return false;
  return !value.includes('/') || Number(value.split('/')[1]) !== 0;
}
