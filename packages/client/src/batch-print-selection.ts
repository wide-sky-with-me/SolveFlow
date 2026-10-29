import type { BatchPrintQuestion } from '@solveflow/contracts/local';

// Decision: .agents/notes/implemented/storage/2026-10-21-export-error-distribution.md
// This is a local complexity estimate, not an independently calibrated difficulty grade.
function complexity(question: BatchPrintQuestion): number | null {
  const candidate = question.candidate;
  if (!candidate) return null;
  const text = candidate.problem.text;
  return Math.min(text.length, 4000) / 80 + Math.min(candidate.steps.length, 20) * 2
    + Math.min(candidate.knowledgePoints.length, 10) + Math.min((text.match(/\\(?:frac|sqrt|int|sum|log)|[=∫∑]/g) ?? []).length, 20);
}
function random(seed: number) {
  let state = seed >>> 0;
  return () => { state = (state + 0x6d2b79f5) >>> 0; let value = Math.imul(state ^ state >>> 15, 1 | state); value ^= value + Math.imul(value ^ value >>> 7, 61 | value); return ((value ^ value >>> 14) >>> 0) / 0x100000000; };
}

/** Bounded stratified search: positions first, complexity balance and previous-copy reuse second. */
export function selectPrintErrors(questions: BatchPrintQuestion[], count: number, seed: number, usage: Map<string, number>, previous: Set<string>): Set<string> {
  if (!count) return new Set();
  const next = random(seed);
  const ordered = [...questions].sort((a, b) => a.ordinal - b.ordinal);
  const scores = ordered.map(question => ({ key: question.key, score: complexity(question) }));
  const known = scores.flatMap(item => item.score === null ? [] : [item.score]).sort((a, b) => a - b);
  const low = known[Math.floor((known.length - 1) / 3)] ?? 0;
  const high = known[Math.floor((known.length - 1) * 2 / 3)] ?? 0;
  const tiers = new Map(scores.map(item => [item.key, item.score === null ? null : item.score <= low ? 0 : item.score <= high ? 1 : 2]));
  const available = [...new Set([...tiers.values()].filter((tier): tier is number => tier !== null))];
  let best: BatchPrintQuestion[] = []; let minimum = Infinity;
  // Each positional stratum contributes its share even when nearly every question is selected.
  const strata = Math.min(count, 8);
  for (let trial = 0; trial < 64; trial++) {
    const selected: BatchPrintQuestion[] = [];
    const extraStart = Math.floor(next() * strata);
    for (let bin = 0; bin < strata; bin++) {
      const start = Math.floor(bin * ordered.length / strata); const end = Math.floor((bin + 1) * ordered.length / strata);
      const needed = Math.floor(count / strata) + ((bin - extraStart + strata) % strata < count % strata ? 1 : 0);
      const pool = ordered.slice(start, end).map(question => ({ question, rank: next() + (usage.get(question.key) ?? 0) * 0.08 })).sort((a, b) => a.rank - b.rank);
      selected.push(...pool.slice(0, needed).map(item => item.question));
    }
    // Unequal stratum sizes can leave one slot; fill from remaining questions without retries.
    const keys = new Set(selected.map(question => question.key));
    for (const item of ordered.map(question => ({ question, rank: next() })).sort((a, b) => a.rank - b.rank)) {
      if (selected.length >= count) break;
      if (!keys.has(item.question.key)) { keys.add(item.question.key); selected.push(item.question); }
    }
    selected.sort((a, b) => a.ordinal - b.ordinal);
    const signature = selected.map(question => question.key).join('|');
    const tierCounts = available.map(tier => selected.filter(question => tiers.get(question.key) === tier).length);
    const graded = tierCounts.reduce((sum, value) => sum + value, 0);
    const balance = tierCounts.reduce((sum, value) => sum + (value - graded / available.length) ** 2, 0);
    const adjacent = selected.reduce((sum, question, index) => sum + (index && question.ordinal - (selected[index - 1]?.ordinal ?? 0) === 1 ? 1 : 0), 0);
    const reuse = selected.reduce((sum, question) => sum + (usage.get(question.key) ?? 0), 0);
    const penalty = (previous.has(signature) ? 10000 : 0) + balance * 30 + adjacent * 8 + reuse * 3 + next();
    if (penalty < minimum) { minimum = penalty; best = selected; }
  }
  previous.add(best.map(question => question.key).join('|'));
  for (const question of best) usage.set(question.key, (usage.get(question.key) ?? 0) + 1);
  return new Set(best.map(question => question.key));
}
