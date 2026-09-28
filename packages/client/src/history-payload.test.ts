import { expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { z } from 'zod';
import { SessionViewSchema } from '@solveflow/contracts/http';
import { encodeHistoryDocument, decodeHistoryDocument, formatHistoryTime } from './history-payload.js';
const id = '20000000-0000-4000-8000-000000000001';
const text = '求解 $x^{2}+2=6$。'.repeat(10) + '\\[\\frac{1}{2}\\]\n` ${globalThis.executed = true} </script>';
const session = SessionViewSchema.parse({ schemaVersion: 1, id, subject: 'math', createdAt: '2026-09-16T00:00:00.000Z', upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: 1, width: 1, height: 1, previewUrl: `/api/v1/uploads/${id}/image`, expiresAt: '9999-12-31T00:00:00.000Z' }, runs: [{ schemaVersion: 1, id, sessionId: id, createdAt: '2026-09-16T00:00:00.000Z', message: '', seq: 1, status: 'needs_clarification', outcome: { schemaVersion: 1, status: 'needs_clarification', verified: false, candidate: { schemaVersion: 1, kind: 'clarification', problem: { text, subject: 'physics', uncertainties: [] }, answer: null, steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: ['请补充条件。'] } } }] });
it('preserves complete history math through the real Android template-literal boundary', () => {
  const encoded = encodeHistoryDocument([session], id, false);
  const injected: unknown = runInNewContext('JSON.parse(`' + JSON.stringify({ historyPayload: encoded }) + '`)', {}, { timeout: 100 });
  const result = decodeHistoryDocument(z.object({ historyPayload: z.string() }).parse(injected).historyPayload);
  expect(result.entries[0]?.text).toBe(text);
  expect(result.entries[0]?.subject).toBe('physics');
  expect(result.currentId).toBe(id);
});
it('supports unsolved records and rejects malformed, oversized or over-capacity history', () => {
  expect(decodeHistoryDocument(encodeHistoryDocument([{ ...session, runs: [] }], null, true)).entries[0]?.text).toBe('已保存的题目');
  expect(() => encodeHistoryDocument(Array.from({ length: 101 }, () => session), null, false)).toThrow();
  for (const value of ['%', '%7B', encodeURIComponent(JSON.stringify({ schemaVersion: 99 })), 'a'.repeat(10_000_001)]) expect(() => decodeHistoryDocument(value)).toThrow();
});
it('carries page offsets without altering timestamps and accepts older documents', () => {
  const result = decodeHistoryDocument(encodeHistoryDocument([session], null, false, 20));
  expect(result.offset).toBe(20);
  expect(result.entries[0]?.createdAt).toBe(session.createdAt);
  const { offset: _offset, ...legacy } = result;
  expect(decodeHistoryDocument(encodeURIComponent(JSON.stringify(legacy))).offset).toBe(0);
  expect(() => encodeHistoryDocument([session], null, false, -1)).toThrow();
  expect(() => encodeHistoryDocument([session], null, false, 0.5)).toThrow();
});
it('shows local calendar date and zero-padded hours, minutes and seconds', () => {
  expect(formatHistoryTime(new Date(2026, 8, 20, 8, 3, 7).toISOString())).toBe('2026-09-20 08:03:07');
  expect(formatHistoryTime(new Date(2026, 0, 2, 0, 0, 0).toISOString())).toBe('2026-01-02 00:00:00');
});
