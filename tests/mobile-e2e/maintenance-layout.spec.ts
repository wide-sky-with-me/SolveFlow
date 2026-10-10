import { expect, test } from '@playwright/test';
import { configureLocalModel } from './local-fixture.js';
test.use({ reducedMotion: 'reduce' });
test('legacy errors stay readable and genuine damage has compact aligned maintenance actions', async ({ page }, info) => {
  let modelRequests = 0;
  await page.route('https://fixture-model.invalid/**', route => { modelRequests++; return route.abort(); });
  await page.goto('/'); await configureLocalModel(page);
  const before = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('solveflow-local', 1); r.onsuccess = () => resolve(r.result); r.onerror = reject; });
    const createdAt = '2026-10-08T08:00:00.000Z'; const entries: [string, string][] = [];
    const canvas = document.createElement('canvas'); canvas.width = 30; canvas.height = 20; const image = canvas.toDataURL('image/jpeg');
    for (let position = 1; position <= 3; position++) {
      const id = `79000000-0000-4000-8000-${String(position).padStart(12, '0')}`;
      const batch = { id: '79000000-0000-4000-8000-000000000004', title: '记录读取回归', createdAt, exam: 'general', position };
      const runs = position === 1 ? [{ schemaVersion: 1, id: '79000000-0000-4000-8000-000000000005', sessionId: id, status: 'failed', createdAt, message: '', seq: 2, outcome: { schemaVersion: 1, status: 'failed', verified: false, error: { code: 'MODEL_UNAVAILABLE', message: '指定模型暂不可用，请检查服务端配置。', retryable: false, traceId: 'legacy-trace' } } }] : [];
      const session = { schemaVersion: 1, id, subject: 'math', createdAt, upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: 1000, width: 30, height: 20, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` }, runs };
      entries.push([`record.${id}`, JSON.stringify({ schemaVersion: 2, session, batch })]);
      entries.push([`summary.${id}`, JSON.stringify({ schemaVersion: 1, id, subject: 'math', createdAt, text: '已保存的题目', pending: false, batch })]);
      if (position !== 2) entries.push([`image.${id}`, JSON.stringify({ schemaVersion: 1, image })]);
    }
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('documents', 'readwrite'); for (const [key, raw] of entries) tx.objectStore('documents').put(raw, key); tx.oncomplete = () => resolve(); tx.onerror = reject; });
    db.close(); return entries;
  });
  await page.getByRole('tab', { name: '历史题目', exact: true }).click(); await page.getByRole('tab', { name: '批量记录', exact: true }).click(); await page.getByRole('button', { name: '打开批量', exact: true }).click();
  await expect(page.getByText('模型服务暂时无法完成请求，请检查连接或模型配置。', { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('batch-read-error')).toHaveCount(0);
  await page.getByRole('tab', { name: '跳转第2题', exact: true }).click();
  const error = page.getByTestId('batch-read-error'); const notice = page.getByTestId('storage-maintenance-notice');
  await expect(error).toBeVisible(); await expect(notice).toContainText('1 处本地记录需要处理');
  const widths = info.project.name === 'desktop' ? [1280, 1600, 1920] : [390];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    const banner = await notice.boundingBox(); const action = await notice.getByRole('button').boundingBox(); const card = await error.boundingBox(); const header = await page.getByTestId('batch-header').boundingBox();
    if (!banner || !action || !card || !header) throw new Error('LAYOUT');
    if (width >= 1100) { expect(banner.width).toBeLessThanOrEqual(1120); expect(banner.height).toBeLessThanOrEqual(60); expect(action.width).toBeLessThan(180); expect(card.x).toBeCloseTo(header.x, 0); expect(card.width).toBeCloseTo(header.width, 0); expect(banner.x).toBeCloseTo(header.x, 0); }
    await expect(notice.getByRole('button')).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole('button', { name: '重新读取题目', exact: true }).click(); await expect(error).toBeVisible();
  await page.screenshot({ path: info.outputPath('maintenance-layout.png') });
  await page.getByRole('button', { name: '查看记录维护', exact: true }).click(); await expect(page.getByRole('heading', { name: '记录维护', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('tab', { name: '跳转第3题', exact: true }).click(); await expect(page.getByLabel('批量待解题原图', { exact: true })).toBeVisible();
  const after = await page.evaluate(async entries => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('solveflow-local', 1); r.onsuccess = () => resolve(r.result); r.onerror = reject; });
    const actual = await Promise.all(entries.map(([key]) => new Promise<[string, unknown]>((resolve, reject) => { const r = db.transaction('documents', 'readonly').objectStore('documents').get(key!); r.onsuccess = () => resolve([key!, r.result]); r.onerror = reject; })));
    db.close(); return actual;
  }, before);
  expect(after).toEqual(before); expect(modelRequests).toBe(0);
});
