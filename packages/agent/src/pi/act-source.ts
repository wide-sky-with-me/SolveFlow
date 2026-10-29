import { z } from 'zod';
import { actProblem, ProblemStatementSchema, type ActTranscript } from '@solveflow/contracts/agent';

/** Capture and solving use separate contexts; only this projection owns source text. */
export function bindActSource(value: unknown, source: ActTranscript): unknown {
  if (!value || typeof value !== 'object' || !('kind' in value) || !['answer', 'clarification'].includes(String(value.kind))) return value;
  if ('refusalReason' in value && value.refusalReason) return value;
  const problemFor = (index: number, previous: unknown) => {
    const problem = actProblem(source, index);
    const metadata = previous && typeof previous === 'object' ? previous : {};
    const uncertainties = 'uncertainties' in metadata && Array.isArray(metadata.uncertainties) ? metadata.uncertainties.filter((note: unknown): note is string => typeof note === 'string') : [];
    // Decision: .agents/notes/implemented/agent/2026-10-26-act-material-source-isolation.md
    // Capture owns text; solver-located, schema-checked crops still need independent review.
    return ProblemStatementSchema.parse({ ...problem, ...(!problem.response && 'response' in metadata ? { response: metadata.response } : {}), ...('illustrations' in metadata ? { illustrations: metadata.illustrations } : {}), uncertainties: [...new Set([...problem.uncertainties, ...uncertainties])] });
  };
  const mismatch = () => new z.ZodError([{ code: 'custom', path: ['questions'], message: '作答必须恰好对应已转录的当前题号；不能把段落编号或其他划线当成额外题目' }]);
  if (source.questions.length === 1) {
    if ('questions' in value && value.questions !== undefined) throw mismatch();
    return { ...value, problem: problemFor(0, 'problem' in value ? value.problem : undefined) };
  }
  const full = [...source.blocks.map(block => block.text), ...source.questions.map(question => question.text)].join('\n\n');
  const problem = { text: ProblemStatementSchema.shape.text.safeParse(full).success ? full : `已转录${source.questions.length}道指定题，完整可见题面分别保存在各题中。`, subject: source.subject, exam: source.exam ?? 'act', ...(!source.exam || source.exam === 'act' ? { transcriptionScope: 'act-visible' } : {}), uncertainties: source.uncertainties };
  if (value.kind === 'clarification') return { ...value, problem };
  if (!('questions' in value) || !Array.isArray(value.questions) || value.questions.length !== source.questions.length) throw mismatch();
  const numbers = new Set<number>();
  const questions = value.questions.map((item: unknown) => {
    if (!item || typeof item !== 'object' || !('number' in item) || typeof item.number !== 'number' || numbers.has(item.number)) throw mismatch();
    numbers.add(item.number);
    const index = source.questions.findIndex(question => question.number === item.number);
    if (index < 0) throw mismatch();
    return { ...item, problem: problemFor(index, 'problem' in item ? item.problem : undefined) };
  });
  return { ...value, problem, questions };
}
