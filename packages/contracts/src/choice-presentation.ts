import { reactionLatex, type Chemistry } from './chemistry.js';
import type { Writing } from './writing.js';
import type { ProblemStatement } from './learning-content.js';
/** Serialize explicit fields for text-only editing and bounded conversation context. No parsing. */
export function problemText(problem: ProblemStatement): string {
  return problem.options?.length ? `${problem.text}\n\n${problem.options.map(option => `${option.label}. ${option.text}`).join('\n\n')}` : problem.text;
}
export function answerText(candidate: { answer: string; writing?: Writing | undefined; chemistry?: Chemistry | undefined; selectedOptions?: string[] | undefined; responseValue?: string | undefined; parts?: { label: string; answer: string }[] | undefined }): string {
  const body = [candidate.responseValue ? `可填答案：${candidate.responseValue}` : '', candidate.writing?.title ?? '', candidate.answer, ...(candidate.chemistry?.reactions ?? []).map(reactionLatex), ...(candidate.writing?.feedback ?? []).map(note => `${note.paragraph ? `第 ${note.paragraph} 段：` : '点评：'}${note.comment}`), ...(candidate.parts ?? []).map(part => `${part.label}\n${part.answer}`)].filter(Boolean).join('\n\n');
  return candidate.selectedOptions ? `答案：${candidate.selectedOptions.join('、')}\n\n${body}` : body;
}
