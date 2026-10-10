import { expect, test } from '@playwright/test';
import { SessionViewSchema } from '../../packages/contracts/src/http.js';
import { configureLocalModel, lastModelInput, modelPass, modelSse, seedLocalSession } from './local-fixture.js';

test('completed batch answers support steps and knowledge while another verification remains pending', async ({ page }) => {
  const id = '72000000-0000-4000-8000-000000000001'; const otherId = '72000000-0000-4000-8000-000000000002';
  const createdAt = new Date().toISOString(); const image = await page.screenshot({ type: 'jpeg' });
  const answer = { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
  const session = SessionViewSchema.parse({ schemaVersion: 1, id, subject: 'math', createdAt, upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: image.length, width: 390, height: 844, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` }, runs: [{ schemaVersion: 1, id, sessionId: id, createdAt, status: 'completed', message: '', seq: 1, outcome: { schemaVersion: 1, status: 'completed', verified: true, warning: null, verification: modelPass, candidate: answer } }] });
  let releaseCheck = () => {}; let releaseLearning = () => {}; const checkGate = new Promise<void>(resolve => { releaseCheck = resolve; }); const learningGate = new Promise<void>(resolve => { releaseLearning = resolve; });
  let checks = 0; const learning: string[] = []; let solves = 0;
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    const body: unknown = route.request().postDataJSON(); const input = lastModelInput(body);
    if (typeof input !== 'object' || input === null || !('role' in input)) throw new Error('INVALID_FIXTURE');
    if (input.role === 'verifier') { checks++; await checkGate; await route.fulfill({ contentType: 'text/event-stream', body: modelSse(modelPass, body) }); return; }
    const focus = 'focus' in input ? input.focus : null;
    const kind = typeof focus === 'object' && focus !== null && 'kind' in focus ? focus.kind : null;
    if (kind === 'explanation' || kind === 'knowledge-list') {
      learning.push(kind); await learningGate;
      const result = kind === 'explanation' ? { ...answer, steps: [{ id: 's1', title: '两边减1', explanation: 'x=3-1=2' }] } : { ...answer, knowledgePoints: ['等式性质'], knowledgeDetails: [{ name: '等式性质', explanation: '等式两边同减相等的数', application: '两边减1' }] };
      await route.fulfill({ contentType: 'text/event-stream', body: modelSse(result, body) }); return;
    }
    solves++; await route.fulfill({ contentType: 'text/event-stream', body: modelSse(answer, body) });
  });
  try {
    await seedLocalSession(page, session, image); await configureLocalModel(page);
    await page.evaluate(async ({ id, otherId, createdAt, record }) => {
      const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('solveflow-local', 1); r.onsuccess = () => resolve(r.result); });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('documents', 'readwrite'); const store = tx.objectStore('documents'); const batch = { id: '72000000-0000-4000-8000-000000000010', title: '批量学习回归', createdAt, exam: 'general' };
        store.put(JSON.stringify({ ...record, batch: { ...batch, position: 1 } }), `record.${id}`);
        store.put(JSON.stringify({ ...record, batch: { ...batch, position: 2 }, session: { ...record.session, id: otherId, runs: [], upload: { ...record.session.upload, id: otherId, previewUrl: `/api/v1/uploads/${otherId}/image` } } }), `record.${otherId}`);
        store.delete(`summary.${id}`); tx.oncomplete = () => resolve(); tx.onerror = reject;
      }); db.close();
    }, { id, otherId, createdAt, record: { schemaVersion: 1, session, image: `data:image/jpeg;base64,${image.toString('base64')}` } });
    await page.reload(); await configureLocalModel(page); await page.getByRole('tab', { name: '历史题目', exact: true }).click(); await page.getByRole('tab', { name: '批量记录', exact: true }).click(); await page.getByRole('button', { name: '打开批量', exact: true }).click();
    await page.getByRole('button', { name: '批次操作', exact: true }).click(); await page.getByRole('button', { name: '继续待解题', exact: true }).click();
    await expect.poll(() => checks).toBe(1);
    const first = page.getByTestId('question-page-1');
    await first.locator('.step-details>summary').click(); await expect.poll(() => learning).toEqual(['explanation']);
    await first.locator('.knowledge-toggle>summary').click(); await expect.poll(() => learning).toEqual(['explanation', 'knowledge-list']);
    await expect(first.locator('.final-answer')).toContainText('x=2');
    releaseLearning(); await expect(first.locator('.teaching-steps')).toContainText('两边减1'); await expect(first.locator('.knowledge-panel')).toContainText('等式性质');
    expect(checks).toBe(1); expect(solves).toBe(1);
    releaseCheck(); await expect(page.getByText('后台处理中', { exact: false })).toHaveCount(0);
    await page.reload(); await first.locator('.step-details>summary').click(); await expect(first.locator('.teaching-steps')).toContainText('两边减1'); await expect(first.locator('.knowledge-panel')).toContainText('等式性质');
    expect(learning).toEqual(['explanation', 'knowledge-list']);
  } finally { releaseCheck(); releaseLearning(); }
});
