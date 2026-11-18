import type { QuestionAnswerState } from '@solveflow/contracts/http';
import type { QuestionOverviewTone } from '@solveflow/client/presentation';

export const questionStatusLabel: Record<QuestionAnswerState, string> = {
  verified: '校验通过',
  answered: '已答，待校验或未通过',
  failed: '答题失败或待补充',
  unanswered: '尚未作答',
};

export const questionOverviewLabel: Record<QuestionOverviewTone, string> = {
  verified: '校验通过',
  answered: '待核验',
  processing: '处理中',
  failed: '有疑点或出错',
  unanswered: '尚未作答',
};

export const questionStatusColors: Record<'light' | 'dark', Record<QuestionOverviewTone, { backgroundColor: string; color: string }>> = {
  light: {
    verified: { backgroundColor: '#dcfce7', color: '#166534' },
    answered: { backgroundColor: '#ffedd5', color: '#9a3412' },
    processing: { backgroundColor: '#dbeafe', color: '#1d4ed8' },
    failed: { backgroundColor: '#fee2e2', color: '#991b1b' },
    unanswered: { backgroundColor: '#e5e7eb', color: '#374151' },
  },
  dark: {
    verified: { backgroundColor: '#16432b', color: '#86efac' },
    answered: { backgroundColor: '#4a2c13', color: '#fdba74' },
    processing: { backgroundColor: '#1e3a5f', color: '#93c5fd' },
    failed: { backgroundColor: '#4b2025', color: '#fca5a5' },
    unanswered: { backgroundColor: '#283344', color: '#cbd5e1' },
  },
};
