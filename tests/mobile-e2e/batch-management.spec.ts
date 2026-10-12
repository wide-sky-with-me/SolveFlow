import { expect, test, type Page } from '@playwright/test';
import { SessionViewSchema } from '../../packages/contracts/src/http.js';
import { seedLocalSession } from './local-fixture.js';
const single = '92000000-0000-4000-8000-000000000001';
const batchId = '92000000-0000-4000-8000-000000000090';
const batchRows = [2, 3, 4].map(n => `92000000-0000-4000-8000-${String(n).padStart(12, '0')}`);
const other = '92000000-0000-4000-8000-000000000005';
async function seed(page: Page) {
  const image = await page.screenshot({ type: 'jpeg' }); const now = new Date().toISOString();
  const session = SessionViewSchema.parse({ schemaVersion: 1, id: single, subject: 'math', createdAt: now, runs: [], upload: { schemaVersion: 1, id: single, mimeType: 'image/jpeg', width: 390, height: 844, bytes: image.length, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${single}/image` } });
  await seedLocalSession(page, session, image);
  await page.evaluate(async ({ session, image, batchId, batchRows, other }) => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('solveflow-local', 1); request.onsuccess = () => resolve(request.result); });
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('documents', 'readwrite'); const store = tx.objectStore('documents');
      for (const [index, id] of [...batchRows, other].entries()) {
        store.put(JSON.stringify({ schemaVersion: 1, image, batch: { id: id === other ? other : batchId, title: id === other ? 'Other synthetic batch' : 'Editable synthetic batch', position: id === other ? 1 : index + 1, createdAt: session.createdAt, exam: 'general' }, session: { ...session, id, upload: { ...session.upload, id, previewUrl: `/api/v1/uploads/${id}/image` } } }), `record.${id}`);
      }
      store.put(JSON.stringify({ schemaVersion: 1, favorite: true }), `favorite.${batchRows[1]}`);
      tx.oncomplete = () => resolve(); tx.onerror = reject;
    }); db.close();
  }, { session, image: `data:image/jpeg;base64,${image.toString('base64')}`, batchId, batchRows, other });
  await page.reload();
}
async function records(page: Page) { return page.evaluate(async () => {
  const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('solveflow-local', 1); request.onsuccess = () => resolve(request.result); });
  const values = await new Promise<{ id: string; position?: number }[]>(resolve => { const tx = db.transaction('documents'); const request = tx.objectStore('documents').openCursor(); const rows: { id: string; position?: number }[] = []; request.onsuccess = () => { const cursor = request.result; if (!cursor) return; if (String(cursor.key).startsWith('record.')) { const value = JSON.parse(cursor.value); rows.push({ id: value.session.id, position: value.batch?.position }); } cursor.continue(); }; tx.oncomplete = () => resolve(rows); }); db.close(); return values.sort((a, b) => a.id.localeCompare(b.id));
}); }
async function openBatch(page: Page) {
  await page.getByRole('tab', { name: '历史题目', exact: true }).click(); await page.getByRole('tab', { name: '批量记录', exact: true }).click();
  await page.getByText('Editable synthetic batch', { exact: true }).click(); await expect(page.getByTestId('current-batch')).toBeVisible();
}
test('clearing single history preserves batch images and records across refresh', async ({ page }) => {
  await seed(page); await page.getByRole('tab', { name: '历史题目', exact: true }).click();
  await page.getByRole('button', { name: /^清空(?:单题)?历史$/ }).click();
  await page.getByRole('button', { name: /^确认清空(?:单题|全部)历史$/ }).click();
  await expect.poll(async () => (await records(page)).map(row => row.id)).toEqual([...batchRows, other].sort());
  await page.reload(); expect((await records(page)).map(row => row.id)).toEqual([...batchRows, other].sort());
});
test('second batch edit cancels safely, then reorders and removes only the confirmed pictures', async ({ page }) => {
  let calls = 0; page.on('request', request => { if (request.url().includes('/chat/completions') || request.url().includes('/responses')) calls++; });
  await seed(page); await openBatch(page);
  await page.getByRole('button', { name: '批次操作', exact: true }).click(); await page.getByRole('button', { name: '调整批次图片', exact: true }).click();
  await page.getByRole('button', { name: '移除第2张', exact: true }).click(); await page.getByRole('button', { name: '取消调整', exact: true }).click(); expect(await records(page)).toHaveLength(5);
  await page.getByRole('button', { name: '批次操作', exact: true }).click(); await page.getByRole('button', { name: '调整批次图片', exact: true }).click();
  await page.getByRole('button', { name: '移除第2张', exact: true }).click(); await page.getByRole('button', { name: '上移第2张', exact: true }).click();
  await page.getByRole('button', { name: '保存批次调整', exact: true }).click(); await page.getByRole('button', { name: '确认批次调整', exact: true }).click();
  await expect.poll(() => records(page)).toEqual([{ id: single }, { id: batchRows[0], position: 2 }, { id: batchRows[2], position: 1 }, { id: other, position: 1 }]);
  await page.reload(); expect(await records(page)).toHaveLength(4); expect(calls).toBe(0);
});
test('discarding a saved batch asks first and retains singles and another batch', async ({ page }) => {
  await seed(page); await openBatch(page); await page.getByRole('button', { name: '批次操作', exact: true }).click(); await page.getByRole('button', { name: '放弃本批', exact: true }).click();
  await page.getByRole('button', { name: '保留本批', exact: true }).click(); expect(await records(page)).toHaveLength(5);
  await page.getByRole('button', { name: '批次操作', exact: true }).click(); await page.getByRole('button', { name: '放弃本批', exact: true }).click(); await page.getByRole('button', { name: '确认放弃本批', exact: true }).click();
  await expect.poll(async () => (await records(page)).map(row => row.id)).toEqual([single, other].sort());
  await page.reload(); expect((await records(page)).map(row => row.id)).toEqual([single, other].sort());
});
