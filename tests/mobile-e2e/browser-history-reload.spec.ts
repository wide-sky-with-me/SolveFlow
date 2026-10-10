import { expect, test } from '@playwright/test';

test('browser back and forward restore section routes across reload without key collisions', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.getByTestId('launch-screen')).toBeHidden();
  await page.getByRole('tab', { name: '历史题目', exact: true }).click();
  await expect(page.getByTestId('empty-history')).toBeVisible();
  await page.getByRole('tab', { name: '我的', exact: true }).click();
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('launch-screen')).toBeHidden();
  await page.goBack();
  await expect(page.getByTestId('empty-history')).toBeVisible();
  await expect(page.getByRole('tab', { name: '历史题目', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.goForward();
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '收藏的题目', exact: true }).click();
  await expect(page.getByTestId('empty-favorites')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('empty-favorites')).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('empty-history')).toBeVisible();
  await page.screenshot({ path: info.outputPath('history-after-reload.png') });
});

test('a reloaded profile retains its current question and browser history without model requests', async ({ page }) => {
  const { SessionViewSchema } = await import('../../packages/contracts/src/http.js');
  const { seedLocalSession } = await import('./local-fixture.js');
  const id = '96000000-0000-4000-8000-000000000003';
  const image = await page.screenshot({ type: 'jpeg' });
  const session = SessionViewSchema.parse({ schemaVersion: 1, id, subject: 'math', createdAt: '2026-10-07T00:00:00.000Z', runs: [], upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: image.length, width: 600, height: 300, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` } });
  let posts = 0; page.on('request', request => { if (request.method() === 'POST') posts++; });
  await seedLocalSession(page, session, image);
  await page.getByRole('tab', { name: '历史题目', exact: true }).click();
  await page.getByRole('tab', { name: '我的', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('button', { name: `打开数学题目 ${id}`, exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '题目', exact: true }).click();
  await expect(page.getByRole('button', { name: '查看题目图片', exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('session')).toBe(id);
  expect(posts).toBe(0);
});

test('deleted question targets stay cleared when returning to browser entries from an earlier reload', async ({ page }) => {
  const { SessionViewSchema } = await import('../../packages/contracts/src/http.js');
  const { seedLocalSession } = await import('./local-fixture.js');
  const id = '96000000-0000-4000-8000-000000000004';
  const image = await page.screenshot({ type: 'jpeg' });
  const session = SessionViewSchema.parse({ schemaVersion: 1, id, subject: 'math', createdAt: '2026-10-07T00:00:00.000Z', runs: [], upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: image.length, width: 600, height: 300, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` } });
  let posts = 0; page.on('request', request => { if (request.method() === 'POST') posts++; });
  await seedLocalSession(page, session, image);
  await page.getByRole('tab', { name: '我的', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: '查看历史题目', exact: true }).click();
  await page.getByRole('button', { name: '题目操作', exact: true }).click();
  await page.getByRole('button', { name: '移除', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.getByTestId('empty-history')).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('empty-camera')).toBeVisible();
  await expect(page.getByText('本地题目不存在或已删除。', { exact: true })).toHaveCount(0);
  await page.reload(); await expect(page.getByTestId('empty-camera')).toBeVisible();
  expect(posts).toBe(0);
});

test('returning to profile and reloading keeps the latest current question consistent', async ({ page }) => {
  const { SessionViewSchema } = await import('../../packages/contracts/src/http.js');
  const { seedLocalSession } = await import('./local-fixture.js');
  const id = '96000000-0000-4000-8000-000000000005';
  const otherId = '96000000-0000-4000-8000-000000000006';
  const image = await page.screenshot({ type: 'jpeg' });
  const session = SessionViewSchema.parse({ schemaVersion: 1, id, subject: 'math', createdAt: '2026-10-07T00:00:00.000Z', runs: [], upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: image.length, width: 600, height: 300, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` } });
  await seedLocalSession(page, session, image);
  await page.evaluate(async ({ session, otherId, image }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const open = indexedDB.open('solveflow-local', 1); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
    try { await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('documents', 'readwrite');
      tx.objectStore('documents').put(JSON.stringify({ schemaVersion: 1, exam: 'tmua', image, session: { ...session, id: otherId, upload: { ...session.upload, id: otherId, previewUrl: `/api/v1/uploads/${otherId}/image` } } }), `record.${otherId}`);
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    }); } finally { db.close(); }
  }, { session, otherId, image: `data:image/jpeg;base64,${image.toString('base64')}` });
  let posts = 0; page.on('request', request => { if (request.method() === 'POST') posts++; });
  await page.getByRole('tab', { name: '我的', exact: true }).click();
  await page.getByRole('button', { name: '查看历史题目', exact: true }).click();
  await page.getByRole('button', { name: `打开数学题目 ${otherId}`, exact: true }).click();
  await expect(page.getByTestId('current-exam')).toContainText('TMUA');
  await page.goBack();
  await expect(page.getByRole('tab', { name: '历史题目', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.goBack();
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '题目', exact: true }).click();
  await expect(page.getByTestId('current-exam')).toContainText('TMUA');
  expect(new URL(page.url()).searchParams.get('session')).toBe(otherId);
  expect(posts).toBe(0);
});
