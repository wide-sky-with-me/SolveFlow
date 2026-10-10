import { z } from 'zod';

/** User-selected exam context; general preserves image-led discovery for older records. */
export const ExamTypeSchema = z.enum(['general', 'sat', 'act', 'ap', 'esat', 'tmua', 'tara']);
export type ExamType = z.infer<typeof ExamTypeSchema>;
export const EXAM_LABELS: Readonly<Record<ExamType, string>> = { general: '未指定', sat: 'SAT', act: 'ACT', ap: 'AP', esat: 'ESAT', tmua: 'TMUA', tara: 'TARA' };

export const EXAM_DESCRIPTIONS: Readonly<Record<ExamType, string>> = {
  general: '以原题说明为准，不预设考试专属规则。',
  sat: '阅读与写作、数学；关注材料证据、选项和填答格式。',
  act: '按题面科目处理英文、数学、阅读、科学与写作要求。',
  ap: '按具体学科处理选择题与自由作答，保留小问和必要论证。',
  esat: '数理科学应用；关注无计算器方法、单位和图表。',
  tmua: '数学应用与推理；关注必要充分条件、量词和证明。',
  tara: '论证分析、问题求解与写作；作文三选一，最多750词。',
};
