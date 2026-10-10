import { expect, test, type Page } from '@playwright/test';
import { LocalRecordSchema } from '../../packages/contracts/src/local.js';

async function seedBatch(page: Page, count: number) {
  await page.goto('/'); await expect(page.getByRole('button', { name: '拍照', exact: true })).toBeVisible();
  const image = `data:image/jpeg;base64,${(await page.screenshot({ type: 'jpeg' })).toString('base64')}`;
  const now = '2026-09-29T02:00:00.000Z'; const batchId = '71000000-0000-4000-8000-000000000100';
  const records = Array.from({ length: count }, (_, i) => {
    const id = `71000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
    return LocalRecordSchema.parse({ schemaVersion: 1, image, batch: { id: batchId, title: '导航布局回归', createdAt: now, exam: 'sat', position: i + 1 }, session: { schemaVersion: 1, id, subject: 'math', createdAt: now, runs: [], upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', width: 390, height: 844, bytes: 100, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` } } });
  });
  await page.evaluate(async records => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('solveflow-local', 1); r.onsuccess = () => resolve(r.result); r.onerror = reject; });
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('documents', 'readwrite'); for (const record of records) tx.objectStore('documents').put(JSON.stringify(record), `record.${record.session.id}`); tx.oncomplete = () => resolve(); tx.onerror = reject; }); db.close();
  }, records);
  await page.goto(`/?session=${records[0]!.session.id}`);
  await expect(page.getByText(`${count} 张题图`, { exact: true })).toBeVisible();
}
for (const count of [1, 2, 3, 4, 5, 9]) test(`${count} batch photos fill each four-item navigation page evenly`, async ({ page }) => {
  let posts = 0; page.on('request', r => { if (r.method() === 'POST') posts++; });
  await seedBatch(page, count);
  const track = page.getByLabel('题号导航', { exact: true });
  const tab = (n: number) => track.getByRole('tab', { name: `跳转第${n}题`, exact: true });
  async function filled(first: number, last: number) {
    await expect(tab(first)).toBeInViewport(); await expect(tab(last)).toBeInViewport();
    await expect.poll(async () => {
      const outer = (await track.boundingBox())!; const left = (await tab(first).boundingBox())!; const right = (await tab(last).boundingBox())!;
      return Math.abs(left.x - outer.x - 4) < 2 && Math.abs(right.x + right.width - outer.x - outer.width + 4) < 2 && Math.abs(left.width - right.width) < 1;
    }).toBe(true);
  }
  await filled(1, Math.min(count, 4));
  if (count > 4) {
    await expect(tab(5)).not.toBeInViewport();
    for (let i = 2; i <= 5; i++) await page.getByRole('button', { name: '下一道题', exact: true }).click();
    await expect(tab(5)).toHaveAttribute('aria-selected', 'true'); await filled(5, Math.min(count, 8));
    if (count > 8) { for (let i = 6; i <= 9; i++) await page.getByRole('button', { name: '下一道题', exact: true }).click(); await filled(9, 9); }
    await page.getByRole('button', { name: '上一道题', exact: true }).click();
    const selected = count > 8 ? 8 : 4; await expect(tab(selected)).toHaveAttribute('aria-selected', 'true');
    await filled(count > 8 ? 5 : 1, selected);
  }
  await page.setViewportSize({ width: 320, height: 750 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (count <= 4) await filled(1, count);
  expect(posts).toBe(0);
});
test('batch-only history hides empty single-history count and clear action', async ({ page }) => {
  await seedBatch(page, 3);
  await page.getByRole('tab', { name: '历史题目', exact: true }).click();
  await page.getByRole('tab', { name: '单题记录', exact: true }).click();
  await expect(page.getByText('还没有解题记录', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '清空历史', exact: true })).toHaveCount(0);
  await expect(page.getByText('0 条记录', { exact: true })).toHaveCount(0);
  await expect(page.getByText('还没有历史题目', { exact: false })).toHaveCount(0);
  await page.getByRole('tab', { name: '批量记录', exact: true }).click();
  await expect(page.getByRole('button', { name: '打开批量', exact: true })).toBeVisible();
});
