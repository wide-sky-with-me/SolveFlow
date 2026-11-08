import { z } from 'zod';
import { LocalKeySchema, LocalModelProfileSchema } from './local.js';

export const ExamModelServiceCodeSchema = z.enum(['primary', 'backup']);
export type ExamModelServiceCode = z.infer<typeof ExamModelServiceCodeSchema>;
export const ExamModelServiceRefSchema = z.strictObject({ code: ExamModelServiceCodeSchema, version: z.number().int().positive() });
export type ExamModelServiceRef = z.infer<typeof ExamModelServiceRefSchema>;
export const ExamServiceModelsSchema = z.strictObject({ solver: LocalModelProfileSchema, verifier: LocalModelProfileSchema, backup: LocalModelProfileSchema.nullable() });
export const ExamServiceKeysSchema = z.strictObject({ solver: LocalKeySchema.nullable(), verifier: LocalKeySchema.nullable(), backup: LocalKeySchema.nullable() });
export const ExamModelServiceChoiceSchema = z.strictObject({
    code: ExamModelServiceCodeSchema, name: z.string().trim().min(1).max(40), available: z.boolean(),
});
/** Public projection deliberately contains no model profiles, endpoints or credential hints. */
export const ExamModelServiceSelectionSchema = z.strictObject({
    selected: ExamModelServiceCodeSchema, version: z.number().int().nonnegative(), services: z.array(ExamModelServiceChoiceSchema).length(2),
});
export type ExamModelServiceSelection = z.infer<typeof ExamModelServiceSelectionSchema>;
export const ExamModelServiceSelectSchema = z.strictObject({ code: ExamModelServiceCodeSchema, expectedVersion: z.number().int().nonnegative() });
export const ExamModelServiceAdminSchema = z.strictObject({
    code: ExamModelServiceCodeSchema, name: ExamModelServiceChoiceSchema.shape.name,
    enabled: z.boolean(), version: z.number().int().positive(), models: ExamServiceModelsSchema.nullable(),
    hasKeys: z.strictObject({ solver: z.boolean(), verifier: z.boolean(), backup: z.boolean() }),
});
export type ExamModelServiceAdmin = z.infer<typeof ExamModelServiceAdminSchema>;
export const ExamModelServicesAdminSchema = z.array(ExamModelServiceAdminSchema).length(2);
export const ExamModelServiceUpdateSchema = z.strictObject({
    expectedVersion: z.number().int().positive(), name: ExamModelServiceChoiceSchema.shape.name,
    enabled: z.boolean(), models: ExamServiceModelsSchema.nullable(), keys: ExamServiceKeysSchema,
}).refine(value => !value.enabled || !!value.models, '启用服务前请填写模型配置');
export type ExamModelServiceUpdate = z.infer<typeof ExamModelServiceUpdateSchema>;
export const ExamModelServiceCheckSchema = z.strictObject({
    expectedVersion: z.number().int().positive(), role: z.enum(['solver', 'verifier', 'backup']),
    profile: LocalModelProfileSchema, key: LocalKeySchema.nullable(),
});
export const ExamModelServiceCheckResultSchema = z.strictObject({ reachable: z.literal(true), modelListed: z.boolean() });
