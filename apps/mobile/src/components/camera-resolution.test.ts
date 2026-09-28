import { expect, it } from 'vitest';
import { batchPictureSize } from './camera-resolution';
it('selects the smallest supported 4:3 capture that preserves the saved 2048px long edge', () => {
  expect(batchPictureSize(['4096x3072', '1920x1080', '2560x1920', '2048x1536', '1280x960'])).toBe('2048x1536');
  expect(batchPictureSize(['4096x3072', '1920x1440', '2304x1728'])).toBe('2304x1728');
  expect(batchPictureSize(['1536x2048', '3072x4096'])).toBe('1536x2048');
});
it('retains the SDK default rather than choosing an undersized or cropped stream', () => {
  for (const sizes of [[], ['1920x1440', '1920x1080'], ['3840x2160'], ['invalid', '0x0', '-2048x1536', '2048x1536junk']]) expect(batchPictureSize(sizes)).toBeUndefined();
});
