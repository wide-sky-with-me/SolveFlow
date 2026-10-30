import { expect, it } from 'vitest';
import { NativePdfTransfer } from './native-pdf-transfer';

it('rejects foreign, oversized and out-of-order chunks; cancellation drops late bytes', () => {
  const transfer = new NativePdfTransfer('job', 'source');
  expect(() => transfer.read('other', 0)).toThrow();
  expect(() => transfer.read('job', 2)).toThrow();
  expect(transfer.read('job', 0)).toBe('source');
  transfer.begin('job', { name: 'test.pdf', mimeType: 'application/pdf', bytes: 6 });
  expect(() => transfer.append('job', 1, 'JVBERi0K')).toThrow();
  transfer.append('job', 0, 'JVBERi0K');
  expect(transfer.finish('job').data).toEqual(new TextEncoder().encode('%PDF-\n'));
  transfer.dispose();
  expect(() => transfer.append('job', 1, 'AA==')).toThrow();
});

it('does not return truncated files or allocate from unvalidated metadata', () => {
  const transfer = new NativePdfTransfer('job', '');
  expect(() => transfer.begin('job', { name: '../x.pdf', mimeType: 'application/pdf', bytes: 6 })).toThrow();
  transfer.begin('job', { name: 'test.zip', mimeType: 'application/zip', bytes: 6 });
  transfer.append('job', 0, 'UEs=');
  expect(() => transfer.finish('job')).toThrow();
  expect(() => transfer.append('job', 1, 'invalid!')).toThrow();
});
