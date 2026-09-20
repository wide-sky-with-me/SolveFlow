import type { ProblemStatement } from './learning-content.js';
/** Serialize explicit fields for text-only editing and bounded conversation context. No parsing. */
export function problemText(problem: ProblemStatement): string {
  return problem.options?.length ? `${problem.text}\n\n${problem.options.map(option => `${option.label}. ${option.text}`).join('\n\n')}` : problem.text;
}
export function answerText(candidate: { answer: string; selectedOptions?: string[] | undefined }): string {
  return candidate.selectedOptions ? `答案：${candidate.selectedOptions.join('、')}\n\n${candidate.answer}` : candidate.answer;
}
