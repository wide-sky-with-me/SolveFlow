/** Only generated model output uses this compatibility step; stored contracts stay strict.
 * Decision: .agents/notes/implemented/agent/2026-10-06-skill-paths-and-source-number.md */
function normalizeProblem(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('sourceNumber' in value)) return value;
  const { sourceNumber, ...fields } = value;
  if (sourceNumber === null || typeof sourceNumber === 'string' && !sourceNumber.trim()) return fields;
  if (typeof sourceNumber === 'number' && Number.isSafeInteger(sourceNumber) && sourceNumber >= 0) {
    return { ...fields, sourceNumber: String(sourceNumber) };
  }
  return value;
}

/** Do not coerce answer values, options, question identities, evidence or verification. */
export function normalizeGeneratedCandidate(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('kind' in value) || value.kind !== 'answer' && value.kind !== 'clarification') return value;
  const candidate = { ...value, ...('problem' in value ? { problem: normalizeProblem(value.problem) } : {}) };
  if (!('questions' in value) || !Array.isArray(value.questions) || value.questions.length > 4) return candidate;
  return { ...candidate, questions: value.questions.map((question: unknown) => {
    if (!question || typeof question !== 'object' || Array.isArray(question) || !('problem' in question)) return question;
    return { ...question, problem: normalizeProblem(question.problem) };
  }) };
}
