import { expect, it } from 'vitest';
import { stableDocumentHeight } from './document-height';
it('settles fractional resize feedback while allowing expansion, collapse and rejecting invalid sizes', () => {
  let height = 80;
  for (const value of [350.2, 350.8, 351.1, 350.2]) height = stableDocumentHeight(height, value);
  expect(height).toBe(351);
  expect(stableDocumentHeight(height, 2100.4)).toBe(2101);
  expect(stableDocumentHeight(2101, 350.2)).toBe(351);
  for (const value of [0, -1, NaN, Infinity, 120001]) expect(stableDocumentHeight(height, value)).toBe(height);
});
