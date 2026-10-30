import { BatchPrintSnapshotSchema } from '../packages/contracts/dist/local.js';

export function nativePdfFixture(image: string, supplement = image) {
  const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const at = '2026-10-30T01:00:00.000Z';
  const batch = { id: id(999), title: 'Native PDF synthetic', exam: 'act', createdAt: at };
  const bytes = Math.floor((image.length - image.indexOf(',') - 1) * .75);
  return BatchPrintSnapshotSchema.parse({ schemaVersion: 1, batch, exportedAt: at, records: Array.from({ length: 6 }, (_, index) => ({
    schemaVersion: 1, image, batch: { ...batch, position: index + 1 },
    ...(index === 0 ? { materials: [{ id: id(200), image: supplement, width: 600, height: 300, bytes: Math.floor((supplement.length - supplement.indexOf(',') - 1) * .75) }], activeImageIds: [id(20), id(200)] } : {}),
    session: { schemaVersion: 1, id: id(index + 1), subject: 'english', createdAt: at,
      upload: { schemaVersion: 1, id: id(index + 20), mimeType: 'image/jpeg', bytes, width: 600, height: 300, expiresAt: at, previewUrl: `/api/v1/uploads/${id(index + 20)}/image` },
      runs: [{ schemaVersion: 1, id: id(index + 40), sessionId: id(index + 1), status: 'completed', message: '', seq: 1, createdAt: at, outcome: {
        schemaVersion: 1, status: 'completed', verified: false, warning: null, verification: null, verificationStatus: 'not_requested',
        candidate: { schemaVersion: 1, kind: 'answer', problem: { text: `Synthetic item ${index + 1}: keep every word. Supplement is part of source evidence.\n${'Long original paragraph for pagination. '.repeat(index === 5 ? 150 : 1)}`, sourceNumber: String(index + 11), subject: 'english', uncertainties: [], optionsComplete: true, options: ['A', 'B', 'C', 'D'].map(label => ({ label, text: `${label} original option` })), response: { type: 'single-choice' } }, answer: 'ANSWER_CANARY choice B with saved explanation.', selectedOptions: ['B'], steps: [], knowledgePoints: [], clarificationQuestions: [], citationIds: [] },
      } }],
    },
  })) });
}
