import { expect, it } from 'vitest';
import { nativePdfError } from './native-pdf-error';

it('classifies local failures without reporting model connectivity or exposing raw runtime data', () => {
  expect(nativePdfError(new TypeError('PRIVATE_NATIVE_CANARY'))).toBe('本地PDF或文件操作失败，请重试。');
  const validation = new Error('PRIVATE_SOURCE_CANARY'); validation.name = 'ZodError';
  expect(nativePdfError(validation)).toBe('导出配置或本地题目数据无效，请重新打开导出检查。');
  expect(nativePdfError(new Error('导出缓存已满，请先保存并删除旧导出记录。'))).toContain('缓存已满');
});
