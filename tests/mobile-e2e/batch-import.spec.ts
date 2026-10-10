import { expect, test, type Page } from '@playwright/test';
import { configureLocalModel, lastModelInput, modelPass, modelSse } from './local-fixture.js';
import { StoredLocalRecordSchema, StoredLocalImageSchema } from '../../packages/contracts/src/local.js';

test.use({ launchOptions: { executablePath: process.env.SOLVEFLOW_TEST_CHROME ?? '/usr/bin/google-chrome', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });
async function selectBatch(page: Page) {
  await page.getByRole('button', { name: '拍照', exact: true }).click(); await page.getByRole('button', { name: '批量解题', exact: true }).click();
  await page.getByRole('button', { name: '允许使用相机' }).evaluateAll(nodes => { for (const node of nodes) if (node instanceof HTMLElement) node.click(); });
  await selectFiles(page, '从相册选择');
}
async function selectFiles(page: Page, button: string) {
  const images = await page.evaluate(() => [10, 2, 1].map(n => { const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 200; const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('CANVAS'); ctx.fillStyle = `rgb(${n * 10},40,60)`; ctx.fillRect(0, 0, 300, 200); return canvas.toDataURL('image/jpeg').split(',')[1]!; }));
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('dialog').getByRole('button', { name: button, exact: true }).click();
  const picker = await chooser; expect(picker.isMultiple()).toBe(true);
  await picker.setFiles([10, 2, 1].map((n, index) => ({ name: `question-${n}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from(images[index]!, 'base64') })));
  await expect(page.getByRole('heading', { name: '确认图片顺序', exact: true })).toBeVisible();
}
async function savedPhotos(page: Page) {
  const documents = await page.evaluate(() => new Promise<Record<string, string>>((resolve, reject) => {
    const opening = indexedDB.open('solveflow-local', 1); opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => { const db = opening.result; const tx = db.transaction('documents'); const documents: Record<string, string> = {}; const request = tx.objectStore('documents').openCursor();
      request.onsuccess = () => { const cursor = request.result; if (!cursor) return; if (typeof cursor.key === 'string' && typeof cursor.value === 'string' && /^(record|image)\./.test(cursor.key)) documents[cursor.key] = cursor.value; cursor.continue(); };
      tx.oncomplete = () => { db.close(); resolve(documents); }; tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
  const records = Object.entries(documents).filter(([key]) => key.startsWith('record.')).map(([, value]) => StoredLocalRecordSchema.parse(JSON.parse(value))).sort((a, b) => (a.batch?.position ?? 0) - (b.batch?.position ?? 0));
  const images = records.map(record => StoredLocalImageSchema.parse(JSON.parse(documents[`image.${record.session.id}`]!)).image);
  const red = await page.evaluate(async images => Promise.all(images.map(async source => {
    const img = new Image(); img.src = source; await img.decode(); const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1; const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('CANVAS'); ctx.drawImage(img, 0, 0); return ctx.getImageData(0, 0, 1, 1).data[0]!;
  })), images);
  return { records, red };
}
test('multi-select previews natural names, known times and manual moves before making any requests', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(File.prototype, 'lastModified', { get(this: File) { return this.name.includes('-10.') ? 1000 : this.name.includes('-2.') ? 2000 : 3000; } }));
  let calls = 0;
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => { calls++; const body = route.request().postDataJSON(); const input = lastModelInput(body); const verifier = typeof input === 'object' && input !== null && 'role' in input && input.role === 'verifier'; await route.fulfill({ contentType: 'text/event-stream', body: modelSse(verifier ? modelPass : { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] }, body) }); });
  await page.goto('/'); await configureLocalModel(page); await selectBatch(page);
  const rows = page.getByTestId('import-photo-row');
  await expect(rows.nth(0)).toContainText('question-1.jpg'); await expect(rows.nth(1)).toContainText('question-2.jpg'); await expect(rows.nth(2)).toContainText('question-10.jpg');
  expect(calls).toBe(0); await page.getByRole('button', { name: '按时间排序', exact: true }).click();
  await expect(rows.nth(0)).toContainText('question-10.jpg');
  await page.getByRole('button', { name: '上移第3张', exact: true }).click();
  await expect(rows.nth(1)).toContainText('question-1.jpg'); await expect(page.getByText('自定义排序 · 剩余 3 张', { exact: true })).toBeVisible(); expect(calls).toBe(0);
  await page.getByRole('button', { name: '导入并解题（3张）', exact: true }).click();
  await expect(page.getByRole('heading', { name: '确认图片顺序', exact: true })).toHaveCount(0); await expect(page.getByText('已保存 3 张', { exact: true })).toBeVisible();
  await expect.poll(() => calls).toBe(6); await page.getByRole('button', { name: '完成拍摄', exact: true }).click();
  await expect(page.getByTestId('current-batch')).toBeVisible(); await expect(page.getByText('3 张题图', { exact: true })).toBeVisible();
  const saved = await savedPhotos(page); expect(saved.records.map(row => row.batch?.position)).toEqual([1, 2, 3]);
  [100, 10, 20].forEach((value, index) => expect(Math.abs(saved.red[index]! - value)).toBeLessThan(4));
});

test('retry after a partial storage failure imports only the remaining images without duplicate records', async ({ page }) => {
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.put; let creations = 0;
    IDBObjectStore.prototype.put = function(value: unknown, key?: IDBValidKey) {
      if (typeof key === 'string' && key.startsWith('record.') && typeof value === 'string') {
        const data: unknown = JSON.parse(value);
        if (typeof data === 'object' && data !== null && 'session' in data && typeof data.session === 'object' && data.session !== null && 'runs' in data.session && Array.isArray(data.session.runs) && data.session.runs.length === 0 && ++creations === 2) throw new DOMException('Synthetic storage failure', 'QuotaExceededError');
      }
      return original.call(this, value, key);
    };
  });
  let calls = 0;
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => { calls++; const body = route.request().postDataJSON(); const input = lastModelInput(body); const verifier = typeof input === 'object' && input !== null && 'role' in input && input.role === 'verifier'; await route.fulfill({ contentType: 'text/event-stream', body: modelSse(verifier ? modelPass : { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] }, body) }); });
  await page.goto('/'); await configureLocalModel(page); await selectBatch(page);
  await page.getByRole('button', { name: '导入并解题（3张）', exact: true }).click();
  await expect(page.getByText('本地保存失败，请检查可用存储空间。', { exact: true })).toBeVisible();
  await expect(page.getByTestId('import-photo-row')).toHaveCount(2); expect((await savedPhotos(page)).records).toHaveLength(1);
  await page.getByRole('button', { name: '导入并解题（2张）', exact: true }).click();
  await expect(page.getByRole('heading', { name: '确认图片顺序', exact: true })).toHaveCount(0); await expect.poll(() => calls).toBe(6);
  const saved = await savedPhotos(page); expect(saved.records.map(row => row.batch?.position)).toEqual([1, 2, 3]);
  [10, 20, 100].forEach((value, index) => expect(Math.abs(saved.red[index]! - value)).toBeLessThan(4));
});

test('cancelling selection preview saves no records and makes no model requests', async ({ page }) => {
  let calls = 0; await page.route('https://fixture-model.invalid/v1/chat/completions', route => { calls++; return route.abort(); });
  await page.goto('/'); await configureLocalModel(page); await selectBatch(page);
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page.getByRole('heading', { name: '确认图片顺序', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '完成拍摄', exact: true }).click(); expect(calls).toBe(0);
  await page.getByRole('tab', { name: '历史题目', exact: true }).click(); await page.getByRole('tab', { name: '批量记录', exact: true }).click();
  await expect(page.getByText('还没有批量解题记录。', { exact: true })).toBeVisible();
});

test('an existing batch appends confirmed photos and an abandoned save never dispatches after returning', async ({ page }) => {
  let calls = 0;
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => { calls++; const body = route.request().postDataJSON(); const input = lastModelInput(body); const verifier = typeof input === 'object' && input !== null && 'role' in input && input.role === 'verifier'; await route.fulfill({ contentType: 'text/event-stream', body: modelSse(verifier ? modelPass : { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] }, body) }); });
  await page.goto('/'); await configureLocalModel(page); await selectBatch(page);
  await page.getByRole('button', { name: '导入并解题（3张）', exact: true }).click(); await expect.poll(() => calls).toBe(6);
  await page.getByRole('button', { name: '完成拍摄', exact: true }).click();
  await page.getByRole('tab', { name: '历史题目', exact: true }).click(); await page.getByRole('tab', { name: '批量记录', exact: true }).click();
  await page.getByRole('button', { name: '打开批量', exact: true }).click();
  await page.getByRole('button', { name: '批次操作', exact: true }).click(); await selectFiles(page, '添加相册题图');
  await page.getByRole('button', { name: '下移第1张', exact: true }).click(); await page.getByRole('button', { name: '导入并解题（3张）', exact: true }).click();
  await expect.poll(() => calls).toBe(12); const appended = await savedPhotos(page);
  expect(appended.records.map(row => row.batch?.position)).toEqual([1, 2, 3, 4, 5, 6]);
  [10, 20, 100, 20, 10, 100].forEach((value, index) => expect(Math.abs(appended.red[index]! - value)).toBeLessThan(4));
  await page.getByRole('button', { name: '批次操作', exact: true }).click(); await selectFiles(page, '添加相册题图');
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob; let held = false;
    HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) { original.call(this, blob => { if (held) { callback(blob); return; } held = true; document.documentElement.dataset.importHeld = 'true'; window.addEventListener('test:release-import', () => callback(blob), { once: true }); }, type, quality); };
  });
  await page.getByRole('button', { name: '导入并解题（3张）', exact: true }).click(); await expect(page.locator('html')).toHaveAttribute('data-import-held', 'true');
  await page.goBack(); await expect(page.getByRole('tab', { name: '历史题目', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.goForward(); await expect(page.getByTestId('current-batch')).toBeVisible();
  await expect(page.getByRole('heading', { name: '确认图片顺序', exact: true })).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('test:release-import')));
  await expect(page.getByText('7 张题图', { exact: true })).toBeVisible(); expect(calls).toBe(12);
  const saved = await savedPhotos(page); expect(saved.records.map(row => row.batch?.position)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(saved.records.at(-1)?.session.runs).toHaveLength(0);
});
