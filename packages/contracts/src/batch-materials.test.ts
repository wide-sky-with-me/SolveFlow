import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { LocalBatchMaterialsSchema } from './local.js';
const image = { image: 'data:image/jpeg;base64,AQID', width: 2, height: 2 };
const batchId = randomUUID(); const a = randomUUID(); const b = randomUUID();
it('allows the same image to serve several recipients and several images to serve one recipient', () => {
  expect(LocalBatchMaterialsSchema.parse({ batchId, images: [{ ...image, sessionIds: [a, b] }, { ...image, sessionIds: [b] }] }).images).toHaveLength(2);
});
it.each([[], [a, a], ['not-an-id']].map(sessionIds => ({ sessionIds })))('rejects empty, duplicate or malformed recipients: $sessionIds', ({ sessionIds }) => {
  expect(LocalBatchMaterialsSchema.safeParse({ batchId, images: [{ ...image, sessionIds }] }).success).toBe(false);
});
it('enforces the per-question addition limit across images', () => {
  expect(LocalBatchMaterialsSchema.safeParse({ batchId, images: Array.from({ length: 8 }, () => ({ ...image, sessionIds: [a] })) }).success).toBe(false);
});
it('bounds actual fan-out bytes rather than charging a reused image only once', () => {
  const large = { ...image, image: `data:image/jpeg;base64,${'AAAA'.repeat(1024 * 1024)}` };
  expect(LocalBatchMaterialsSchema.safeParse({ batchId, images: [{ ...large, sessionIds: Array.from({ length: 50 }, () => randomUUID()) }] }).success).toBe(false);
});
