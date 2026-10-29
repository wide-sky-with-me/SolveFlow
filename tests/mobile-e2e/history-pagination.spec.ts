import { expect, test } from '@playwright/test';
import { SessionViewSchema } from '../../packages/contracts/src/http.js';
import { chooseSyntheticPhoto, seedLocalSession } from './local-fixture.js';

test('deleting the last page and saving a new question does not restore the obsolete page index', async ({ page }) => {
  const image = await page.screenshot({ type: 'jpeg' }), createdAt = new Date().toISOString();
  const id = '90000000-0000-4000-8000-000000000081';
  const session = SessionViewSchema.parse({ schemaVersion: 1, id, subject: 'math', createdAt, runs: [], upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: image.length, width: 390, height: 844, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` } });
  await seedLocalSession(page, session, image);
  await page.evaluate(({ session, image }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('solveflow-local'); request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('documents', 'readwrite'), store = tx.objectStore('documents');
      for (let i = 1; i <= 20; i++) {
        const id = `90000000-0000-4000-8000-${String(100 + i).padStart(12, '0')}`;
        store.put(JSON.stringify({ schemaVersion: 1, image, session: { ...session, id, upload: { ...session.upload, id, previewUrl: `/api/v1/uploads/${id}/image` } } }), `record.${id}`);
      }
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }), { session, image: `data:image/jpeg;base64,${image.toString('base64')}` });
  let modelCalls = 0; await page.route('**/__solveflow/web-env/model/**', route => { modelCalls++; return route.abort(); });
  await page.reload(); await page.getByRole('tab', { name: '历史题目', exact: true }).click();
  await expect(page.getByText('21 条记录', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '下一页', exact: true }).click(); await expect(page.locator('.history-entry')).toHaveCount(1);
  await page.getByRole('button', { name: '题目操作', exact: true }).click(); await page.getByRole('button', { name: '移除', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click(); await expect(page.getByText('20 条记录', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '当前题目', exact: true }).click();
  const replace = page.getByRole('button', { name: '换一道题', exact: true }); if (await replace.isVisible()) await replace.click();
  await chooseSyntheticPhoto(page); await page.getByRole('button', { name: '先保存题图以补充材料', exact: true }).click();
  await page.getByRole('tab', { name: '历史题目', exact: true }).click();
  await expect(page.getByText('21 条记录', { exact: true })).toBeVisible();
  await expect(page.getByText('第 1 / 2 页', { exact: true })).toBeVisible();
  await expect(page.locator('.history-entry')).toHaveCount(20); expect(modelCalls).toBe(0);
});
