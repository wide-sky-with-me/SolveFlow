import { z } from 'zod';

/** User-selected exam context; general preserves image-led discovery for older records. */
export const ExamTypeSchema = z.enum(['general', 'sat', 'act', 'ap']);
export type ExamType = z.infer<typeof ExamTypeSchema>;
export const EXAM_LABELS: Readonly<Record<ExamType, string>> = { general: '未指定', sat: 'SAT', act: 'ACT', ap: 'AP' };
