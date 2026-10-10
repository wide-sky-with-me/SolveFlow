import { expect, test } from '@playwright/test';
import { configureLocalModel } from './local-fixture.js';

test('reopens history with an old false bookmark and an interrupted record whose photo is missing', async ({ page }) => {
  await page.goto('/'); await configureLocalModel(page);
  const image = await page.screenshot({ type: 'jpeg' });
  const ids = ['91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000002'];
  const now = new Date().toISOString();
  const records = ids.map((id, index) => ({
    schemaVersion: 2, exam: index ? 'tmua' : 'esat',
    session: { schemaVersion: 1, id, subject: 'math', createdAt: now,
      upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: image.length, width: 390, height: 844, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` },
      runs: [{ schemaVersion: 1, id, sessionId: id, status: 'solving', message: '恢复测试', createdAt: now, seq: 2, outcome: null }],
    },
  }));
  await page.evaluate(async ({ records, image }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('solveflow-local', 1); request.onsuccess = () => resolve(request.result); request.onerror = reject; });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('documents', 'readwrite'); const store = tx.objectStore('documents');
      for (const record of records) store.put(JSON.stringify(record), `record.${record.session.id}`);
      store.put(JSON.stringify({ schemaVersion: 1, favorite: false }), `favorite.${records[0]!.session.id}`);
      store.put(JSON.stringify({ schemaVersion: 1, image }), `image.${records[1]!.session.id}`);
      tx.oncomplete = () => resolve(); tx.onerror = reject;
    }); db.close();
  }, { records, image: `data:image/jpeg;base64,${image.toString('base64')}` });
  let requests = 0; page.on('request', request => { if (request.method() === 'POST') requests++; });
  await page.reload(); await expect(page.getByRole('button', { name: '拍照', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '我的', exact: true }).click();
  await expect(page.getByRole('button', { name: '查看历史题目', exact: true })).toContainText('2');
  const recovered = await page.evaluate(async ids => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('solveflow-local', 1); request.onsuccess = () => resolve(request.result); request.onerror = reject; });
    const result = await Promise.all(ids.map(id => new Promise<unknown>((resolve, reject) => {
      const request = db.transaction('documents', 'readonly').objectStore('documents').get(`record.${id}`);
      request.onsuccess = () => resolve(JSON.parse(request.result)); request.onerror = reject;
    }))); db.close(); return result;
  }, ids);
  expect(recovered).toEqual(records.map(record => expect.objectContaining({ exam: record.exam, session: expect.objectContaining({ runs: [expect.objectContaining({ status: 'failed', outcome: expect.objectContaining({ error: expect.objectContaining({ code: 'WORKER_LOST' }) }) })] }) })));
  expect(requests).toBe(0);
});
