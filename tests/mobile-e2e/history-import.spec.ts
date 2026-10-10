import { expect, test } from '@playwright/test';
import { configureLocalModel } from './local-fixture.js';

for (const damagedNeighbor of [false, true]) test(`restores a backup${damagedNeighbor ? ' beside damaged metadata' : ''}, skips duplicates, rejects truncation and never calls a model`, async ({ page }) => {
  await page.goto('/'); await configureLocalModel(page);
  const id = '89000000-0000-4000-8000-000000000001'; const now = new Date().toISOString(); const image = await page.screenshot({ type: 'jpeg' });
  const record = { schemaVersion: 1, image: `data:image/jpeg;base64,${image.toString('base64')}`, session: { schemaVersion: 1, id, subject: 'math', createdAt: now, runs: [], upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: image.length, width: page.viewportSize()!.width, height: page.viewportSize()!.height, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` } } };
  const rows = [{ schemaVersion: 1, kind: 'header', format: 'solveflow-history', createdAt: now, count: 1 }, { schemaVersion: 1, kind: 'question', record, favorite: true, diagnostics: [] }, { schemaVersion: 1, kind: 'complete', count: 1 }];
  const damagedId = '89000000-0000-4000-8000-000000000002';
  if (damagedNeighbor) await page.evaluate(async id => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const open = indexedDB.open('solveflow-local', 1); open.onsuccess = () => resolve(open.result); open.onerror = reject; });
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('documents', 'readwrite'); tx.objectStore('documents').put('{broken', `record.${id}`); tx.oncomplete = () => resolve(); tx.onerror = reject; }); db.close();
  }, damagedId);
  let calls = 0; page.on('request', request => { if (request.method() === 'POST') calls++; });
  await page.getByRole('tab', { name: '我的', exact: true }).click(); await page.getByRole('button', { name: '恢复本地记录', exact: true }).click();
  async function restore(text: string) {
    const picker = page.waitForEvent('filechooser'); await page.getByRole('button', { name: '选择备份并恢复' }).click();
    await (await picker).setFiles({ name: 'backup.ndjson', mimeType: 'application/x-ndjson', buffer: Buffer.from(text) });
  }
  const text = rows.map(row => JSON.stringify(row)).join('\n');
  await restore(rows.slice(0, 2).map(row => JSON.stringify(row)).join('\n'));
  await expect(page.getByText('备份不完整，缺少结束标记。')).toBeVisible();
  await restore(text); await expect(page.getByText('已恢复 1 道题，跳过 0 道已有题目。')).toBeVisible();
  await restore(text); await expect(page.getByText('已恢复 0 道题，跳过 1 道已有题目。')).toBeVisible();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page.getByRole('button', { name: '查看历史题目', exact: true })).toContainText('1');
  await expect(page.getByRole('button', { name: '收藏的题目', exact: true })).toContainText('1');
  expect(calls).toBe(0);
  if (damagedNeighbor) {
    const raw = await page.evaluate(async id => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const open = indexedDB.open('solveflow-local', 1); open.onsuccess = () => resolve(open.result); open.onerror = reject; });
      try { return await new Promise<unknown>((resolve, reject) => { const get = db.transaction('documents').objectStore('documents').get(`record.${id}`); get.onsuccess = () => resolve(get.result); get.onerror = reject; }); } finally { db.close(); }
    }, damagedId);
    expect(raw).toBe('{broken');
    await expect(page.getByRole('button', { name: '查看记录维护', exact: true })).toBeVisible();
  }
});
