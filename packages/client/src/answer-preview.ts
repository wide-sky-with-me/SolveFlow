import { isAuxiliaryContext, questionAnswerState, terminal, type QuestionAnswerState, type RunView } from '@solveflow/contracts/http';
import type { AnswerCandidate } from '@solveflow/contracts/agent';

type ValueSource = { answer: string; selectedOptions?: readonly string[] | null | undefined; responseValue?: string | undefined };

const label = '(最终(?:答案|结果)|final\\s+(?:answer|result)|答案|结果|answer|result)';
const markedLine = new RegExp('^' + label + '\\s*[:：]\\s*(.+)$', 'i');
const markedBold = new RegExp('\\*\\*\\s*' + label + '\\s*[:：]\\s*(.+?)\\*\\*', 'gi');

function compact(value: string) {
  const text = value.trim().replace(/^(?:\*\*|__)\s*/, '').replace(/(?:\*\*|__)$/, '').trim();
  return text && text.length <= 80 && !/[\r\n]/.test(text) ? text : null;
}

/** Prefer structured responseValue; only summarize prose when explicitly labelled or already short. */
export function answerValue(source: ValueSource): string | null {
  if (source.selectedOptions?.length) return null;
  if (source.responseValue) return compact(source.responseValue);
  const marked: { final: boolean; value: string }[] = [];
  function add(match: RegExpMatchArray) {
    const value = compact(match[2] ?? '');
    if (value) marked.push({ final: /^(?:最终|final)/i.test(match[1] ?? ''), value });
  }
  for (const line of source.answer.split(/\r?\n/)) {
    const match = line.trim().replace(/^#{1,6}\s+/, '').replace(/^(?:\*\*|__)/, '').match(markedLine);
    if (match) add(match);
  }
  for (const match of source.answer.matchAll(markedBold)) add(match);
  if (marked.length) {
    const finals = marked.filter(item => item.final);
    const values = new Set((finals.length ? finals : marked).map(item => item.value));
    return values.size === 1 ? [...values][0] ?? null : null;
  }
  const whole = compact(source.answer);
  if (!whole) return null;
  if (/^[+−-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+−-]?\d+)?(?:\/[+−-]?\d+)?(?:\s*(?:%|°|[a-zA-Z]{1,8}(?:[²³]|\^\d)?))?$/u.test(whole)) return whole;
  if (/^\$[^$]+\$$/.test(whole) || /^\\\([\s\S]+\\\)$/.test(whole)) return whole;
  if (whole.length <= 48 && /^[a-zA-Z0-9]+(?:[ -][a-zA-Z0-9]+){0,4}$/.test(whole) && !/^(?:because|since|therefore|thus|the answer|we |by |given )/i.test(whole)) return whole;
  if (whole.length <= 12 && /^[\p{Script=Han}]+$/u.test(whole) && !/^(?:因为|所以|因此|根据|数据|计算|由)/.test(whole)) return whole;
  return null;
}

function cleanPlainValue(raw: string): string {
  const unwrapped = raw.replace(/^\$([^$]+)\$$/, '$1').replace(/^\\\(([\s\S]+)\\\)$/, '$1').trim();
  return unwrapped || raw.trim();
}

function singleCandidatePreview(source: { answer: string; selectedOptions?: readonly string[] | undefined; responseValue?: string | undefined; parts?: readonly { label: string; answer: string }[] | undefined }): { text: string; excerpt: boolean } | null {
  if (source.selectedOptions?.length) return { text: source.selectedOptions.join('、'), excerpt: false };
  const direct = answerValue(source);
  if (direct) {
    const cleaned = cleanPlainValue(direct);
    const chars = Array.from(cleaned);
    return { text: chars.length > 24 ? chars.slice(0, 24).join('') + '…' : cleaned, excerpt: false };
  }
  const body = (source.answer || source.parts?.map(part => `${part.label} ${part.answer}`).join(' ') || '')
    .replace(/[#*_`~>\[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!body) return null;
  const chars = Array.from(body);
  if (chars.length <= 16) return { text: body, excerpt: false };
  return { text: chars.length > 28 ? chars.slice(0, 28).join('') + '…' : body, excerpt: true };
}

export function candidateAnswerPreview(candidate: AnswerCandidate): { text: string; excerpt: boolean } | null {
  if (candidate.questions?.length) {
    const items = candidate.questions.map(question => {
      const part = singleCandidatePreview(question);
      return part ? `${question.number}:${part.text}` : `${question.number}:-`;
    });
    const joined = items.join(' ');
    const chars = Array.from(joined);
    return { text: chars.length > 30 ? chars.slice(0, 30).join('') + '…' : joined, excerpt: chars.length > 18 };
  }
  return singleCandidatePreview(candidate);
}

export type QuestionOverviewTone = QuestionAnswerState | 'processing';

export type QuestionOverviewItem = {
  state: QuestionAnswerState;
  tone: QuestionOverviewTone;
  phaseLabel: string;
  answer: string | null;
  excerpt: boolean;
};

/** Derives both compact answer text and fine-grained verification status for question overviews. */
export function questionOverviewItem(runs: readonly RunView[], queued = false): QuestionOverviewItem {
  const state = questionAnswerState(runs);
  const answerRuns = runs.filter(run => !isAuxiliaryContext(run.context?.kind));
  const activeVerify = runs.some(run => run.context?.kind === 'verification' && !terminal(run.status));
  const latestAnswer = answerRuns.at(-1);
  const activeAnswer = latestAnswer && !terminal(latestAnswer.status) ? latestAnswer : null;
  const completed = [...answerRuns].reverse().find(run => run.outcome?.status === 'completed');
  const preview = completed?.outcome?.status === 'completed' ? candidateAnswerPreview(completed.outcome.candidate) : null;

  if (state === 'verified') {
    return { state, tone: 'verified', phaseLabel: '通过', answer: preview?.text ?? null, excerpt: preview?.excerpt ?? false };
  }
  if (state === 'answered' && completed?.outcome?.status === 'completed') {
    if (completed.outcome.verification?.verdict === 'fail') {
      return { state, tone: 'failed', phaseLabel: '有疑点', answer: preview?.text ?? null, excerpt: preview?.excerpt ?? false };
    }
    const verifying = activeVerify || (!!activeAnswer && activeAnswer.id === completed.id) || completed.outcome.verificationStatus === 'pending';
    return {
      state,
      tone: 'answered',
      phaseLabel: verifying ? '校验中' : '待核验',
      answer: preview?.text ?? null,
      excerpt: preview?.excerpt ?? false,
    };
  }
  if (activeAnswer || queued) {
    return { state, tone: 'processing', phaseLabel: activeAnswer ? '答题中' : '等待中', answer: preview?.text ?? null, excerpt: preview?.excerpt ?? false };
  }
  if (state === 'failed') {
    const needsClarification = latestAnswer?.outcome?.status === 'needs_clarification';
    return { state, tone: 'failed', phaseLabel: needsClarification ? '需补充' : '出错', answer: null, excerpt: false };
  }
  return { state: 'unanswered', tone: 'unanswered', phaseLabel: '未答', answer: null, excerpt: false };
}
