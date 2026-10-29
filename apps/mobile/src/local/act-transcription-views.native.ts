import type { SolverInput } from '@solveflow/contracts/agent';
export async function prepareActTranscriptionViews(_input: SolverInput, signal: AbortSignal): Promise<SolverInput['image'][]> {
  if (signal.aborted) throw new Error('CANCELLED'); return [];
}
