import type { LocalBatch, LocalBatchQueueSnapshot, LocalHistorySummary } from '@solveflow/contracts/local';

export type BatchTaskSummary = {
  batch: Omit<LocalBatch, 'position'>;
  answersReady: number; cancelled: number; needsClarification: number;
  total: number; verified: number; answered: number; failed: number; unanswered: number;
  waiting: number; solving: number; verifying: number; preparing: number;
  active: boolean; stopping: boolean; error: string | null;
};

/** Metadata only: viewing task progress must not decode every batch's photos. */
export function summarizeBatchTasks(rows: readonly LocalHistorySummary[], queue: LocalBatchQueueSnapshot): BatchTaskSummary[] {
  const phases = new Map(queue.tasks.map(row => [row.sessionId, row]));
  const groups = new Map<string, BatchTaskSummary>();
  for (const row of rows) {
    if (!row.batch) continue;
    const { position: _position, ...batch } = row.batch;
    let group = groups.get(batch.id);
    if (!group) {
      group = { batch, answersReady: 0, cancelled: 0, needsClarification: 0, total: 0, verified: 0, answered: 0, failed: 0, unanswered: 0, waiting: 0, solving: 0, verifying: 0, preparing: 0, active: false, stopping: queue.stoppingAll || queue.stoppingBatchIds.includes(batch.id), error: queue.globalError ?? queue.errors[batch.id] ?? null };
      groups.set(batch.id, group);
    }
    group.total++;
    if (row.answerReady ?? (row.answerState === 'answered' || row.answerState === 'verified')) group.answersReady++;
    const task = phases.get(row.id);
    if (task?.batchId === batch.id) group[task.phase]++;
    else if (row.pending) group.preparing++;
    else if (row.taskState === 'cancelled') group.cancelled++;
    else if (row.taskState === 'needs_clarification') group.needsClarification++;
    else group[row.answerState ?? 'unanswered']++;
  }
  for (const group of groups.values()) group.active = group.stopping || group.waiting + group.solving + group.verifying + group.preparing > 0;
  return [...groups.values()].sort((a, b) => Number(b.active) - Number(a.active) || b.batch.createdAt.localeCompare(a.batch.createdAt) || a.batch.id.localeCompare(b.batch.id));
}
