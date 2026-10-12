import { expect, test } from '@playwright/test';
import { SessionViewSchema } from '../../packages/contracts/src/http.js';
import { seedLocalSession } from './local-fixture.js';
test('paginates summaries, cancels clearing, then atomically removes question data and retains preferences', async ({ page }, info) => {
  const id = '90000000-0000-4000-8000-000000000001'; const now = new Date().toISOString(); const image = await page.screenshot({ type: 'jpeg' });
  const session = SessionViewSchema.parse({ schemaVersion: 1, id, subject: 'math', createdAt: now, runs: [], upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', width: 390, height: 844, bytes: image.length, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` } });
  await seedLocalSession(page, session, image);
  await page.evaluate(async ({ session, image }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('solveflow-local', 1); r.onsuccess = () => resolve(r.result); r.onerror = reject; });
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('documents', 'readwrite'); const store = tx.objectStore('documents');
      for (let i = 2; i <= 45; i++) { const id = `90000000-0000-4000-8000-${String(i).padStart(12, '0')}`; store.put(JSON.stringify({ schemaVersion: 1, image, session: { ...session, id, upload: { ...session.upload, id, previewUrl: `/api/v1/uploads/${id}/image` } } }), `record.${id}`); }
      store.put(JSON.stringify({ schemaVersion: 1, favorite: true }), `favorite.${session.id}`); store.put('synthetic orphan diagnostic', 'diagnostic.90000000-0000-4000-8000-999999999999'); store.put('retain preference', 'test.preference');
      tx.oncomplete = () => resolve(); tx.onerror = reject;
    }); db.close();
  }, { session, image: `data:image/jpeg;base64,${image.toString('base64')}` });
  await page.reload(); await page.getByRole('tab', { name: '历史题目', exact: true }).click();
  await expect(page.getByText('45 条记录', { exact: true })).toBeVisible();
  await expect(page.locator('.history-entry')).toHaveCount(20);
  await expect(page.locator('.history-ordinal').first()).toHaveText('01');
  await expect(page.locator('.history-ordinal').last()).toHaveText('20');
  await expect(page.locator('.history-ordinal').first()).toHaveAttribute('aria-label', '序号 1');
  await expect(page.locator('.history-time').first()).toHaveAttribute('datetime', now);
  await expect(page.locator('.history-time').first()).toHaveText(/^保存于 \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  const viewport = page.locator('.history-viewport'); const bounds = await viewport.boundingBox(); if (!bounds) throw new Error('NO_HISTORY_VIEWPORT');
  if (info.project.name === 'mobile') {
    const cdp = await page.context().newCDPSession(page); const x = bounds.x + 100; const y = bounds.y + bounds.height - 60;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let dy = 20; dy <= 180; dy += 20) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 2, y: y - dy }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach();
  } else { await page.mouse.move(bounds.x + 100, bounds.y + 100); await page.mouse.wheel(0, 240); }
  await expect.poll(() => viewport.evaluate(node => node.scrollTop)).toBeGreaterThan(30);
  await expect(page.locator('.history-more[aria-expanded="true"]')).toHaveCount(0);
  await page.getByRole('button', { name: '下一页', exact: true }).click(); await expect(page.locator('.history-entry')).toHaveCount(20);
  await expect(page.locator('.history-ordinal').first()).toHaveText('21');
  await expect(page.locator('.history-ordinal').last()).toHaveText('40');
  await expect(page.locator('.history-entry').first()).toBeInViewport();
  await expect.poll(() => viewport.evaluate(node => node.scrollTop)).toBe(0);
  await page.getByRole('tab', { name: '当前题目', exact: true }).click(); await page.getByRole('tab', { name: '历史题目', exact: true }).click();
  await expect(page.getByText('第 2 / 3 页', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '搜索历史题目', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索关键词', exact: true }).fill('已保存');
  await expect(page.getByText('第 1 / 3 页', { exact: true })).toBeVisible();
  await expect(page.locator('.history-entry')).toHaveCount(20);
  await expect(page.locator('.history-ordinal').first()).toHaveText('01');
  await page.getByRole('button', { name: '收起搜索', exact: true }).click();
  await page.getByRole('button', { name: '清空单题历史', exact: true }).click();
  await expect(page.getByText('清空 45 道单题记录？', { exact: true })).toBeVisible();
  const confirm = page.getByRole('button', { name: '确认清空单题历史', exact: true });
  expect(await confirm.evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(197, 43, 43)');
  expect(await confirm.evaluate(node => getComputedStyle(node.firstElementChild!).color)).toBe('rgb(255, 255, 255)');
  await page.getByRole('button', { name: '保留题目', exact: true }).click(); await expect(page.getByText('45 条记录', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清空单题历史', exact: true }).click(); await confirm.click(); await expect(page.getByTestId('empty-history')).toBeVisible();
  await page.getByRole('tab', { name: '当前题目', exact: true }).click();
  await expect(page.getByRole('button', { name: '拍一张', exact: true })).toBeVisible();
  await expect(page.getByText('本地题目不存在。', { exact: true })).toHaveCount(0);
  await page.goBack(); await page.goBack(); // Original restored question was deleted too.
  await expect(page.getByRole('button', { name: '拍一张', exact: true })).toBeVisible();
  await page.reload(); await page.getByRole('tab', { name: '历史题目', exact: true }).click(); await expect(page.getByTestId('empty-history')).toBeVisible();
  const remaining = await page.evaluate(async () => { const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('solveflow-local', 1); r.onsuccess = () => resolve(r.result); }); const keys = await new Promise<IDBValidKey[]>(resolve => { const r = db.transaction('documents').objectStore('documents').getAllKeys(); r.onsuccess = () => resolve(r.result); }); db.close(); return keys; });
  expect(remaining).toEqual(['diagnostic.90000000-0000-4000-8000-999999999999', 'test.preference']); // Unknown ownership is preserved by scoped clearing.
});

test('short diagonal swipe opens actions, right swipe closes them and vertical scrolling never deletes', async ({ page }, info) => {
  const id = '90000000-0000-4000-8000-000000000031'; const image = await page.screenshot({ type: 'jpeg' }); const now = new Date().toISOString();
  const session = SessionViewSchema.parse({ schemaVersion: 1, id, subject: 'math', createdAt: now, runs: [], upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', width: 390, height: 844, bytes: image.length, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` } });
  await seedLocalSession(page, session, image); await page.getByRole('tab', { name: '历史题目', exact: true }).click();
  const row = page.locator('.history-entry'); const box = await row.boundingBox(); if (!box) throw new Error('NO_ROW');
  async function swipe(dx: number, dy: number) {
    const x = box!.x + 90; const y = box!.y + 22;
    if (info.project.name === 'mobile') { const cdp = await page.context().newCDPSession(page); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx, y: y + dy }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach(); }
    else { await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y + dy, { steps: 2 }); await page.mouse.up(); }
  }
  await swipe(-24, 18); await expect(row.getByRole('button', { name: '题目操作', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await swipe(24, 18); await expect(row.getByRole('button', { name: '题目操作', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await swipe(3, 50); await expect(row.getByRole('button', { name: '题目操作', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('tab', { name: '历史题目', exact: true })).toHaveAttribute('aria-selected', 'true');
});


test('single question returns to history and a favorite returns to favorites without leaving the app', async ({ page }) => {
  const id = '90000000-0000-4000-8000-000000000071'; const image = await page.screenshot({ type: 'jpeg' }); const now = new Date().toISOString();
  const session = SessionViewSchema.parse({ schemaVersion: 1, id, subject: 'math', createdAt: now, runs: [], upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', width: 390, height: 844, bytes: image.length, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` } });
  await seedLocalSession(page, session, image); await page.getByRole('tab', { name: '历史题目', exact: true }).click();
  const open = page.getByRole('button', { name: `打开数学题目 ${id}`, exact: true });
  await open.click(); await expect(page.getByRole('tab', { name: '当前题目', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.goBack(); await expect(page.getByRole('tab', { name: '历史题目', exact: true })).toHaveAttribute('aria-selected', 'true'); await expect(open).toBeVisible();
  await page.getByRole('button', { name: '题目操作', exact: true }).click(); await page.getByRole('button', { name: '收藏', exact: true }).click();
  await page.getByRole('tab', { name: '我的', exact: true }).click(); await page.getByRole('button', { name: '收藏的题目', exact: true }).click();
  await page.getByRole('button', { name: `打开数学题目 ${id}`, exact: true }).click(); await expect(page.getByRole('tab', { name: '当前题目', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.goBack(); await expect(page.getByText('收藏的题目', { exact: true })).toBeVisible();
  await page.goBack(); await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible();
});
