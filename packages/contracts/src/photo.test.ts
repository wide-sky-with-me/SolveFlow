import { describe, expect, it } from 'vitest';
import { PhotoLoginSchema, PhotoSolveRequestSchema } from './photo.js';
const input = { schemaVersion: 1, requestId: '4ade1fd6-3657-4312-a88b-1ee9c39dd711', sessionId: 'fb60765a-a778-4b81-a16d-a0df7d15ebf9', exam: 'act', image: 'data:image/jpeg;base64,/9j/2Q==' };
describe('public photo requests', () => {
  it('accepts supported exams and refuses hidden model controls or multiple images', () => {
    expect(PhotoSolveRequestSchema.parse(input).exam).toBe('act');
    for (const extra of [{ model: 'other' }, { materials: [] }, { baseURL: 'https://other.invalid' }, { verificationMode: 'automatic' }]) expect(PhotoSolveRequestSchema.safeParse({ ...input, ...extra }).success).toBe(false);
    expect(PhotoSolveRequestSchema.safeParse({ ...input, image: 'https://other.invalid/photo.jpg' }).success).toBe(false);
  });
  it('bounds access keys and rejects non-key login fields', () => {
    expect(PhotoLoginSchema.safeParse({ key: 'too-short' }).success).toBe(false);
    expect(PhotoLoginSchema.safeParse({ key: 'x'.repeat(40), role: 'admin' }).success).toBe(false);
  });
});
