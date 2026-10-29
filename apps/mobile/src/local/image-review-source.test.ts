import { expect, it } from 'vitest';
import type { SolverInput } from '@solveflow/contracts/agent';
import { imageReviewPixels, imageReviewSource } from './image-review-source';

const input: SolverInput = { schemaVersion: 1, role: 'solver', identity: { ownerId: 'local', sessionId: 'session', runId: 'run' }, message: '', evidence: [], image: { bytes: Uint8Array.of(1, 2, 3), mimeType: 'image/jpeg' }, materials: [{ id: '00000000-0000-4000-8000-000000000002', image: { bytes: Uint8Array.of(4, 5, 6), mimeType: 'image/jpeg' } }] };
const region = { imageIndex: 1, x: .2, y: .3, width: .4, height: .1 };
it('reads the selected supplement rather than the main image or any remote address', () => {
  expect(imageReviewSource(input, region)).toBe('data:image/jpeg;base64,BAUG');
  expect(imageReviewSource(input, { ...region, imageIndex: 0 })).toBe('data:image/jpeg;base64,AQID');
  expect(() => imageReviewSource(input, { ...region, imageIndex: 2 })).toThrow();
});
it('preserves bounds, enlarges only the selected pixels and caps output dimensions', () => {
  expect(imageReviewPixels({ ...region, x: .2, y: .25, width: .4, height: .125 }, 1000, 800)).toEqual({ crop: { originX: 200, originY: 200, width: 400, height: 100 }, size: { width: 1200, height: 300 } });
  expect(imageReviewPixels({ ...region, x: 0, y: 0, width: 1, height: 1 }, 2048, 2048).size).toEqual({ width: 2048, height: 2048 });
  expect(imageReviewPixels({ ...region, x: .99, y: .99, width: .01, height: .01 }, 100, 100).crop).toEqual({ originX: 99, originY: 99, width: 1, height: 1 });
  expect(() => imageReviewPixels({ ...region, x: .9 }, 1000, 800)).toThrow();
  expect(() => imageReviewPixels(region, 0, 800)).toThrow();
});
