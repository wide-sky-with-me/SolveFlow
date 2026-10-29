import { isAuxiliaryContext } from '@solveflow/contracts/http';
import { clientError } from '@solveflow/client/presentation';
import type { Runtime } from './runtime';

type BatchTaskRuntime = Pick<Runtime, 'batch' | 'enqueueBatch'> & { repository: Pick<Runtime['repository'], 'listHistory' | 'readMetadata'> };
export async function resumeBatchTasks(runtime: BatchTaskRuntime, batchId: string, retry = false, proceed: () => boolean = () => true): Promise<string[]> {
  const failures: string[] = [];
  let stopped = false;
  const checkStop = () => { const state = runtime.batch.getSnapshot(); if (state.stoppingAll || state.stoppingBatchIds.includes(batchId)) stopped = true; };
  const off = runtime.batch.subscribe(checkStop); checkStop();
  try {
    const rows = (await runtime.repository.listHistory({ cached: true })).filter(row => row.batch?.id === batchId).sort((a, b) => a.batch!.position - b.batch!.position);
    for (const row of rows) {
      if (stopped || !proceed()) break;
      try {
        const record = await runtime.repository.readMetadata(row.id);
        if (stopped || !proceed()) break;
        const last = record.session.runs.at(-1);
        if (!last || (retry && ['failed', 'cancelled'].includes(last.status) && !isAuxiliaryContext(last.context?.kind))) await runtime.enqueueBatch(row.id, retry);
      } catch (cause) { if (!stopped) failures.push(clientError(cause)); }
    }
    return [...new Set(failures)];
  } finally { off(); }
}
