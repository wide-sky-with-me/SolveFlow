import { MAX_CONVERSATION_RUNS, isAuxiliaryContext, terminal, type RunContext } from '@solveflow/contracts/http';
import type { LocalRecordMetadata } from '@solveflow/contracts/local';
import { resolveLearningContext } from './learning-history.js';
import { questionConversations, regenerationContext } from './question-conversations.js';

/** A batch recipient is a saved photo, including every question originally present on it. */
export function batchMaterialRequests(record: LocalRecordMetadata, allowActive = false): { message: string; context?: RunContext }[] {
  const runs = record.session.runs;
  if (!allowActive && runs.some(run => !terminal(run.status))) throw new Error('请先结束收到补图的题目任务。');
  const settled = allowActive ? runs.filter(run => terminal(run.status)) : runs;
  const contexts = questionConversations(settled).flatMap(thread => { const context = regenerationContext(thread); return context ? [context] : []; });
  const requested = contexts.length ? contexts : [undefined];
  if (runs.filter(run => !isAuxiliaryContext(run.context?.kind)).length + requested.length > MAX_CONVERSATION_RUNS) throw new Error('收到补图的题目已达到对话次数上限，请新建题目。');
  return requested.map(context => {
    resolveLearningContext(settled, context ?? null);
    return { message: '请结合原题图和本轮全部补图，从头重新完整解答本题；补图仅补充本题材料，不把补图中的其他题目新增为题目。请实际检查补图，不沿用旧的缺图判断。', ...(context ? { context } : {}) };
  });
}
