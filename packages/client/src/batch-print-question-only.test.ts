import { expect, it } from 'vitest';
import { BatchPrintSnapshotSchema } from '@solveflow/contracts/local';
import { questionsForBatchQuestionPrint } from './batch-print-variants.js';

const id = '00000000-0000-4000-8000-000000000001';
const at = '2026-10-13T01:00:00.000Z';
function snapshot() {
  return BatchPrintSnapshotSchema.parse({ schemaVersion: 1, exportedAt: at,
    batch: { id, title: 'Question paper', exam: 'general', createdAt: at },
    records: [{ schemaVersion: 1, image: 'data:image/jpeg;base64,AQID', batch: { id, title: 'Question paper', exam: 'general', createdAt: at, position: 1 },
      session: { schemaVersion: 1, id, subject: 'math', createdAt: at,
        upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: 3, width: 30, height: 20, expiresAt: at, previewUrl: `/api/v1/uploads/${id}/image` },
        runs: [] } }] });
}
it('projects unanswered source questions without requiring or inventing an answer', () => {
  const source = snapshot(); const before = JSON.stringify(source);
  expect(questionsForBatchQuestionPrint(source)).toEqual([{ key: `${id}/unanswered`, ordinal: 1, recordId: id, problem: null }]);
  expect(JSON.stringify(source)).toBe(before);
});
it('question-only projection exposes problem content but strips all answer and verification fields', () => {
  const source = snapshot();
  source.records[0]!.session.runs.push({ schemaVersion: 1, id, sessionId: id, status: 'completed', message: '', seq: 1, createdAt: at,
    outcome: { schemaVersion: 1, status: 'completed', verified: false, verification: null, warning: null, verificationStatus: 'not_requested',
      candidate: { schemaVersion: 1, kind: 'answer', problem: { text: 'x + 1 = 3', subject: 'math', uncertainties: [] }, answer: 'PRIVATE_ANSWER', steps: [], knowledgePoints: [], clarificationQuestions: [], citationIds: [] } } });
  const output = questionsForBatchQuestionPrint(source);
  expect(output[0]?.problem?.text).toBe('x + 1 = 3');
  expect(JSON.stringify(output)).not.toContain('PRIVATE_ANSWER');
  expect(output[0]).not.toHaveProperty('candidate'); expect(output[0]).not.toHaveProperty('baselineWrong');
});
