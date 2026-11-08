import { randomUUID } from 'node:crypto';
import { solveOnDevice } from '@solveflow/agent/mobile';
import { SolverInputSchema } from '@solveflow/contracts/agent';
import { WebStoredModelsSchema } from '@solveflow/contracts/local';
import { z } from 'zod';
import type { PracticeSolve } from './practice.js';
import { prepareActViews, solverImage } from './images.js';

export function practiceSolver(source: z.infer<typeof WebStoredModelsSchema> | ((request: Parameters<PracticeSolve>[0]) => Promise<z.infer<typeof WebStoredModelsSchema>>), claim: (user: string) => Promise<void>, network: typeof fetch = fetch): PracticeSolve {
  if (typeof source !== 'function' && !source.keys.solver) throw new Error('SOLVER_REQUIRED');
  return async (request, signal, report, authorize) => {
    const models = typeof source === 'function' ? await source(request) : source, solver = models.keys.solver;
    if (!solver) throw new Error('SOLVER_REQUIRED');
    let calls = 0;
    const transport: typeof fetch = async (url, init) => {
      signal.throwIfAborted();
      if (++calls > 24) throw new Error('PRACTICE_CALL_LIMIT');
      await authorize();
      await claim(request.ownerId);
      signal.throwIfAborted();
      return network(url, { ...init, signal: AbortSignal.any([signal, ...init?.signal ? [init.signal] : []]) });
    };
    const input = SolverInputSchema.parse({ schemaVersion: 1, role: 'solver', identity: { ownerId: request.ownerId, sessionId: randomUUID(), runId: request.requestId }, exam: request.exam, answerMode: 'brief', verificationMode: 'automatic', message: '', evidence: [], image: { bytes: await solverImage(request.image.bytes), mimeType: request.image.mimeType } });
    return solveOnDevice(input, { ...models.models, schemaVersion: 1 }, { ...models.keys, solver }, transport, signal, report, undefined, undefined, undefined, prepareActViews);
  };
}
