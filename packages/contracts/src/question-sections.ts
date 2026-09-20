import type { AnswerCandidate, ProblemStatement, KnowledgeDetail } from "./agent.js";
import type { Figure } from "./figure.js";

type Step = AnswerCandidate["steps"][number];
export interface QuestionSection { number: number; answer: string; selectedOptions?: string[] | undefined; steps: Step[]; figures: Figure[]; problem?: ProblemStatement | undefined; knowledgeDetails?: KnowledgeDetail[] | undefined }

// Legacy records have no ownership metadata. Only unambiguous, fully numbered
// content is regrouped; this view never changes persisted answers or verification.
const numeral = "[0-9一二三四五六七八九十]{1,3}";
function questionNumber(value: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  const digit = (part: string) => "一二三四五六七八九".indexOf(part) + 1;
  const parts = value.split("十");
  return parts.length === 2 ? (parts[0] ? digit(parts[0]) : 1) * 10 + (parts[1] ? digit(parts[1]) : 0) : digit(value);
}
function prefix(text: string): { number: number; rest: string } | null {
  const match = new RegExp(`^第(${numeral})题[\\s：:、.—-]*`).exec(text);
  if (!match) return null;
  const number = questionNumber(match[1]!);
  return number > 0 && number <= 999 ? { number, rest: text.slice(match[0].length) } : null;
}
function cleanStep(step: Step, number: number): Step {
  const match = prefix(step.title);
  return match?.number === number && match.rest ? { ...step, title: match.rest } : step;
}
function legacyAnswers(text: string): Map<number, string> | null {
  const headers = [...text.matchAll(new RegExp(`^(?:#{1,6}\\s+)?(\\*\\*)?第(${numeral})题[\\s：:、.—-]*`, "gm"))];
  if (headers.length < 2 || text.slice(0, headers[0]!.index).trim()) return null;
  const answers = new Map<number, string>();
  for (const [index, header] of headers.entries()) {
    const number = questionNumber(header[2]!);
    const rest = text.slice(header.index + header[0].length, headers[index + 1]?.index ?? text.length).trim();
    if (!rest || answers.has(number)) return null;
    answers.set(number, `${header[1] ?? ""}${rest}`);
  }
  return answers;
}
export function questionSections(candidate: AnswerCandidate): QuestionSection[] | null {
  if (candidate.questions) {
    const steps = new Map(candidate.steps.map(step => [step.id, step]));
    const figures = new Map((candidate.figures ?? []).map(figure => [figure.id, figure]));
    // Candidate is schema-validated at the HTTP/SSE boundary.
    return candidate.questions.map(question => ({ number: question.number, answer: question.answer, selectedOptions: question.selectedOptions,
      steps: question.stepIds.map(id => cleanStep(steps.get(id)!, question.number)),
      figures: question.figureIds.map(id => figures.get(id)!), problem: question.problem, knowledgeDetails: question.knowledgeDetails,
    }));
  }
  const answers = legacyAnswers(candidate.answer);
  if (!answers || answers.size > 4) return null;
  const groups = new Map<number, QuestionSection>();
  for (const [number, answer] of answers) groups.set(number, { number, answer, steps: [], figures: [] });
  for (const step of candidate.steps) {
    const match = prefix(step.title); const group = match && groups.get(match.number);
    if (!group) return null;
    group.steps.push(cleanStep(step, group.number));
  }
  for (const figure of candidate.figures ?? []) {
    const match = prefix(figure.title); const group = match && groups.get(match.number);
    if (!group) return null;
    group.figures.push(figure);
  }
  if ([...groups.values()].some(group => !group.steps.length)) return null;
  return [...groups.values()];
}
