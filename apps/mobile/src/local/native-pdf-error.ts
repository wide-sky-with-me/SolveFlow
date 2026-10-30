import { clientError } from '@solveflow/client/presentation';

/** Local export validation/runtime failures must not be mislabeled as model network errors. */
export function nativePdfError(cause: unknown): string {
  if (cause instanceof Error && cause.name === 'ZodError') return '导出配置或本地题目数据无效，请重新打开导出检查。';
  if (!(cause instanceof Error) || ['TypeError', 'TimeoutError', 'AbortError'].includes(cause.name)) return '本地PDF或文件操作失败，请重试。';
  return clientError(cause);
}
