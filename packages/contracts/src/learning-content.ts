import { z } from "zod";
const text = (max: number) => z.string().trim().min(1).max(max);
/** Coordinates refer only to the authorized, normalized source image. */
export const OriginalIllustrationSchema = z.strictObject({
  id: text(64).regex(/^[A-Za-z][A-Za-z0-9_-]*$/), alt: text(300),
  x: z.number().finite().min(0).max(1), y: z.number().finite().min(0).max(1),
  width: z.number().finite().min(.01).max(1), height: z.number().finite().min(.01).max(1),
}).superRefine((value, ctx) => { if (value.x + value.width > 1.000001 || value.y + value.height > 1.000001) ctx.addIssue({ code: "custom", message: "原题图区域超出图片范围" }); });
export const ChoiceOptionsSchema = z.array(z.strictObject({ label: text(1).regex(/^[A-Z]$/), text: text(2000) })).min(2).max(10).refine(items => new Set(items.map(item => item.label)).size === items.length, "选项标签不能重复");
export const ProblemStatementSchema = z.strictObject({ sourceNumber: text(40).optional(), text: text(8000), subject: text(40), options: ChoiceOptionsSchema.optional(), uncertainties: z.array(text(500)).max(8), illustrations: z.array(OriginalIllustrationSchema).max(3).refine(items => new Set(items.map(item => item.id)).size === items.length, "原题图标识符不能重复").optional() });
export const KnowledgeDetailSchema = z.strictObject({ name: text(120), explanation: text(500), application: text(400), pitfall: text(300).optional() });
export const KnowledgeDetailsSchema = z.array(KnowledgeDetailSchema).max(8).refine(items => new Set(items.map(item => item.name)).size === items.length, "知识点名称不能重复");
export type ProblemStatement = z.infer<typeof ProblemStatementSchema>;
export type KnowledgeDetail = z.infer<typeof KnowledgeDetailSchema>;
/** Shared by display and verifier: preserve nearby labels around a model's tight box. */
export function originalIllustrationBounds(crop: { x: number; y: number; width: number; height: number }) {
  const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
  const x = round(Math.max(0, crop.x - .03)); const y = round(Math.max(0, crop.y - .03));
  return { x, y, width: round(Math.min(1, crop.x + crop.width + .03) - x), height: round(Math.min(1, crop.y + crop.height + .03) - y) };
}
