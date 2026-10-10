import { z } from 'zod';
// Decision: .agents/notes/implemented/storage/2026-10-09-correction-image-selection.md
export const MAX_MATERIAL_IMAGES = 7;
export const MAX_QUESTION_IMAGE_BYTES = 8 * 1024 * 1024;
/** Historical evidence is bounded separately from the eight images in a request. */
export const MAX_STORED_MATERIAL_IMAGES = 63;
export const MAX_STORED_IMAGE_BYTES = 32 * 1024 * 1024;
export const QuestionImageIdsSchema = z.array(z.uuid()).min(1).max(MAX_MATERIAL_IMAGES + 1).refine(ids => new Set(ids).size === ids.length, '题目图片不能重复');
export const MaterialIdsSchema = z.array(z.uuid()).max(MAX_MATERIAL_IMAGES).refine(ids => new Set(ids).size === ids.length, '材料图片不能重复');
export const MaterialInfoSchema = z.strictObject({ id: z.uuid(), width: z.number().int().positive().max(2048), height: z.number().int().positive().max(2048), bytes: z.number().int().positive().max(4 * 1024 * 1024) });
export const LocalImageDataSchema = z.string().max(5_592_432).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/);
export const LocalMaterialSchema = MaterialInfoSchema.extend({ image: LocalImageDataSchema });
/** A local correction draft, never a model input or a persisted run context. */
export const LocalImageEditSchema = z.strictObject({ imageIds: QuestionImageIdsSchema, additions: z.array(LocalMaterialSchema).max(MAX_MATERIAL_IMAGES + 1) });
export type LocalImageEdit = z.infer<typeof LocalImageEditSchema>;
export type LocalMaterial = z.infer<typeof LocalMaterialSchema>;
