import { expect, test } from '@playwright/test';
import { SessionViewSchema } from '../../packages/contracts/src/http.js';
import { chooseSyntheticPhoto, configureLocalModel, lastModelInput, modelPass, modelSse, seedLocalSession } from './local-fixture.js';

const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const answer = { schemaVersion: 1, kind: 'answer', problem: { text: '求 x+1=3 的解。', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };

for (const batch of [false, true]) for (const first of ['knowledge-list', 'explanation'] as const) {
  const second = first === 'knowledge-list' ? 'explanation' : 'knowledge-list';
  test(`${batch ? 'batch' : 'single'} starts ${second} while ${first} runs and cancels only the requested task`, async ({ page }) => {
    const pending = new Map<string, () => void>();
    await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
      const body: unknown = route.request().postDataJSON();
      const input = lastModelInput(body);
      if (typeof input === 'object' && input !== null && 'role' in input && input.role === 'verifier') {
        await new Promise<void>(resolve => pending.set('verification', resolve));
        await route.fulfill({ contentType: 'text/event-stream', body: modelSse(modelPass) }); return;
      }
      if (typeof input !== 'object' || input === null || !('focus' in input) || typeof input.focus !== 'object' || input.focus === null || !('kind' in input.focus) || typeof input.focus.kind !== 'string') throw new Error('Expected focused request');
      const kind = input.focus.kind;
      await new Promise<void>(resolve => pending.set(kind, resolve));
      const candidate = kind === 'explanation'
        ? { ...answer, steps: [{ id: 'subtract', title: '两边减1', explanation: 'x=3-1=2' }] }
        : { ...answer, knowledgePoints: ['等式性质'], knowledgeDetails: [{ name: '等式性质', explanation: '等式两边同减一个数仍相等。', application: '两边减1。', pitfall: '注意符号。' }] };
      await route.fulfill({ contentType: 'text/event-stream', body: modelSse(candidate, body) });
    });
    try {
      const now = new Date().toISOString();
      const image = await page.screenshot({ type: 'jpeg' });
      const session = SessionViewSchema.parse({ schemaVersion: 1, id: id(1), subject: 'math', createdAt: now, upload: { schemaVersion: 1, id: id(2), mimeType: 'image/jpeg', bytes: image.length, width: 600, height: 300, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id(2)}/image` }, runs: [{ schemaVersion: 1, id: id(3), sessionId: id(1), status: 'completed', message: '', createdAt: now, seq: 1, outcome: { schemaVersion: 1, status: 'completed', verified: false, verificationStatus: 'not_requested', warning: null, verification: null, candidate: answer } }] });
      await seedLocalSession(page, session, image);
      if (batch) {
        await page.evaluate(async ({ recordId, batchId, createdAt }) => {
          const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('solveflow-local', 1); request.onsuccess = () => resolve(request.result); request.onerror = reject; });
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction('documents', 'readwrite'); const store = tx.objectStore('documents'); const request = store.get(`record.${recordId}`);
            request.onsuccess = () => { const record = JSON.parse(request.result); record.batch = { id: batchId, title: '并发回归批次', createdAt, exam: 'tmua', position: 1 }; record.exam = 'tmua'; store.put(JSON.stringify(record), `record.${recordId}`); store.delete(`summary.${recordId}`); };
            tx.oncomplete = () => resolve(); tx.onerror = reject;
          }); db.close();
        }, { recordId: id(1), batchId: id(4), createdAt: now });
        await page.reload();
      }
      await configureLocalModel(page);
      if (batch) {
        await page.getByRole('tab', { name: '历史题目', exact: true }).click();
        await page.getByRole('tab', { name: '批量记录', exact: true }).click();
        await page.getByRole('button', { name: '打开批量', exact: true }).click();
        await expect(page.getByTestId('current-batch')).toBeVisible();
      }
      const panel = (kind: string) => page.locator(kind === 'explanation' ? '.step-details' : '.knowledge-toggle');
      await expect(page.locator('.final-answer')).toContainText('x=2');
      await panel(first).locator('summary').click();
      await expect.poll(() => pending.has(first)).toBe(true);
      await panel(second).locator('summary').click();
      await expect.poll(() => pending.has(second)).toBe(true);
      await page.locator('.final-answer').getByRole('button', { name: '校验', exact: true }).click();
      await expect.poll(() => pending.has('verification')).toBe(true);
      await panel(second).getByRole('button', { name: '取消', exact: true }).click();
      await expect(panel(second).getByRole('button', { name: second === 'explanation' ? '重新生成步骤' : '重新生成知识点' })).toBeEnabled();
      await expect(panel(first).locator('.steps-wait')).toBeVisible();
      await expect(page.locator('.final-answer').getByRole('button', { name: '校验中', exact: true })).toBeVisible();
      pending.get(first)!();
      await expect(page.locator(first === 'explanation' ? '.teaching-steps' : '.knowledge-panel')).toContainText(first === 'explanation' ? '两边减1' : '等式性质');
      pending.get('verification')!();
      await expect(page.locator('.final-answer').getByRole('button', { name: '校验通过', exact: true })).toBeVisible();
      await expect(page.locator('.final-answer')).toContainText('x=2');
    } finally { for (const release of pending.values()) release(); }
  });
}

test('saved steps can be verified while knowledge points are still generating', async ({ page }) => {
  let knowledgeStarted = false; let verified = false; let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    const body: unknown = route.request().postDataJSON(); const input = lastModelInput(body);
    if (typeof input !== 'object' || input === null || !('role' in input)) throw new Error('Missing request role');
    if (input.role === 'verifier') {
      verified = true;
      await route.fulfill({ contentType: 'text/event-stream', body: modelSse(modelPass) }); return;
    }
    const kind = 'focus' in input && typeof input.focus === 'object' && input.focus !== null && 'kind' in input.focus ? input.focus.kind : undefined;
    if (kind === 'knowledge-list') { knowledgeStarted = true; await gate; }
    const candidate = kind === 'knowledge-list'
      ? { ...answer, knowledgePoints: ['等式性质'], knowledgeDetails: [{ name: '等式性质', explanation: '等式两边同减一个数仍相等。', application: '两边减1。', pitfall: '注意符号。' }] }
      : { ...answer, steps: [{ id: 'subtract', title: '两边减1', explanation: 'x=3-1=2' }] };
    await route.fulfill({ contentType: 'text/event-stream', body: modelSse(candidate, body) });
  });
  try {
    await page.goto('/'); await configureLocalModel(page); await chooseSyntheticPhoto(page);
    await page.getByRole('button', { name: '开始解题', exact: true }).click();
    await expect(page.locator('.final-answer')).toContainText('x=2');
    await page.locator('.step-details>summary').click();
    await expect(page.locator('.teaching-steps')).toContainText('两边减1');
    await page.locator('.knowledge-toggle>summary').click();
    await expect.poll(() => knowledgeStarted).toBe(true);
    await page.locator('.step-details').getByRole('button', { name: '校验步骤', exact: true }).click();
    await expect.poll(() => verified).toBe(true);
    await expect(page.locator('.step-details').getByRole('button', { name: '校验通过', exact: true })).toBeVisible();
    await expect(page.locator('.knowledge-toggle .steps-wait')).toBeVisible();
    release(); await expect(page.locator('.knowledge-panel')).toContainText('等式性质');
  } finally { release(); }
});
