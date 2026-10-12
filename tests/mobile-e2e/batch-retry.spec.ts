import { expect, test } from '@playwright/test';
import { SessionViewSchema } from '../../packages/contracts/src/http.js';
import { configureLocalModel, lastModelInput, modelPass, modelSse, seedLocalSession } from './local-fixture.js';

for (const action of ['重新尝试', '重试未完成']) test(`failed batch questions can ${action} while another verification runs`, async ({ page }) => {
  const id = '73000000-0000-4000-8000-000000000001'; const otherId = '73000000-0000-4000-8000-000000000002';
  const createdAt = new Date().toISOString(); const image = await page.screenshot({ type: 'jpeg' });
  const answer = { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
  const session = SessionViewSchema.parse({ schemaVersion: 1, id, subject: 'math', createdAt, upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: image.length, width: 390, height: 844, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` }, runs: [{ schemaVersion: 1, id, sessionId: id, createdAt, status: 'failed', message: '', seq: 1, outcome: { schemaVersion: 1, status: 'failed', verified: false, error: { code: 'MODEL_TIMEOUT', message: '模型响应超时，请稍后重试。', retryable: true, traceId: id } } }] });
  let releaseCheck = () => {}; const checkGate = new Promise<void>(resolve => { releaseCheck = resolve; });
  let checks = 0; let solves = 0;
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    const body: unknown = route.request().postDataJSON(); const input = lastModelInput(body);
    if (typeof input !== 'object' || input === null || !('role' in input)) throw new Error('INVALID_FIXTURE');
    if (input.role === 'verifier') {
      expect(body).toHaveProperty('stream', false);
      if (++checks === 1) await checkGate;
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 'chat_fixture', choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(modelPass) }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }) });
    }
    else { solves++; await route.fulfill({ contentType: 'text/event-stream', body: modelSse(answer, body) }); }
  });
  try {
    await seedLocalSession(page, session, image);
    await page.evaluate(async ({ id, otherId, createdAt, record }) => {
      const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('solveflow-local', 1); r.onsuccess = () => resolve(r.result); });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('documents', 'readwrite'); const store = tx.objectStore('documents'); const batch = { id: '73000000-0000-4000-8000-000000000010', title: '失败重试回归', createdAt, exam: 'general' };
        store.put(JSON.stringify({ ...record, batch: { ...batch, position: 1 } }), `record.${id}`);
        store.put(JSON.stringify({ ...record, batch: { ...batch, position: 2 }, session: { ...record.session, id: otherId, runs: [], upload: { ...record.session.upload, id: otherId, previewUrl: `/api/v1/uploads/${otherId}/image` } } }), `record.${otherId}`);
        store.delete(`summary.${id}`); tx.oncomplete = () => resolve(); tx.onerror = reject;
      }); db.close();
    }, { id, otherId, createdAt, record: { schemaVersion: 1, session, image: `data:image/jpeg;base64,${image.toString('base64')}` } });
    await page.reload(); await configureLocalModel(page);
    await page.getByRole('tab', { name: '历史题目', exact: true }).click(); await page.getByRole('tab', { name: '批量记录', exact: true }).click(); await page.getByRole('button', { name: '打开批量', exact: true }).click();
    await page.getByRole('button', { name: '批次操作', exact: true }).click(); await page.getByRole('button', { name: '继续待解题', exact: true }).click();
    await expect.poll(() => checks).toBe(1); expect(solves).toBe(1);
    const first = page.getByTestId('question-page-1');
    if (action === '重试未完成') await page.getByRole('button', { name: '批次操作', exact: true }).click();
    const retry = action === '重新尝试' ? first.getByRole('button', { name: action, exact: true }) : page.getByRole('button', { name: action, exact: true });
    await expect(retry).toBeEnabled(); await retry.click();
    await expect(first.locator('.final-answer')).toContainText('x=2');
    await expect.poll(() => checks).toBe(2); expect(solves).toBe(2);
    await expect(first.getByRole('button', { name: '校验通过', exact: true })).toBeVisible();
    await expect(page.getByText('后台处理中', { exact: false })).toBeVisible();
    releaseCheck(); await expect(page.getByText('后台处理中', { exact: false })).toHaveCount(0);
    await page.reload(); await expect(first.locator('.final-answer')).toContainText('x=2'); expect(solves).toBe(2); expect(checks).toBe(2);
  } finally { releaseCheck(); }
});
