import { expect, test, type Page, type Locator } from '@playwright/test';
import { configureLocalModel, lastModelInput, modelPass, modelSse } from './local-fixture.js';
import { StoredLocalRecordSchema, StoredLocalImageSchema } from '../../packages/contracts/src/local.js';

test.use({ launchOptions: { executablePath: process.env.SOLVEFLOW_TEST_CHROME ?? '/usr/bin/google-chrome', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });
async function selectBatch(page: Page) {
  await page.getByRole('button', { name: '拍照', exact: true }).click(); await page.getByRole('button', { name: '批量解题', exact: true }).click();
  await page.getByRole('button', { name: '允许使用相机' }).evaluateAll(nodes => { for (const node of nodes) if (node instanceof HTMLElement) node.click(); });
  await selectFiles(page, '从相册选择');
}
async function selectFiles(page: Page, button: string, numbers = [10, 2, 1]) {
  const images = await page.evaluate(numbers => numbers.map(n => { const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 200; const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('CANVAS'); ctx.fillStyle = `rgb(${n * 10},40,60)`; ctx.fillRect(0, 0, 300, 200); return canvas.toDataURL('image/jpeg').split(',')[1]!; }), numbers);
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('dialog').getByRole('button', { name: button, exact: true }).click();
  const picker = await chooser; expect(picker.isMultiple()).toBe(true);
  await picker.setFiles(numbers.map((n, index) => ({ name: `question-${n}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from(images[index]!, 'base64') })));
  await expect(page.getByRole('heading', { name: /^(确认图片顺序|新增题图工作台)$/ })).toBeVisible();
}
function insertionTarget(page: Page, original: number) {
  return page.getByRole('button', { name: new RegExp('^插到第[0-9]+张之前（原第' + original + '张）$') });
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
async function holdAcceptedImport(page: Page) {
  await page.evaluate(() => {
    const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';
    let engine: Record<string, unknown> | null = null;
    for (const node of document.querySelectorAll('*')) {
      const key = Object.keys(node).find(name => name.startsWith('__reactFiber$')); let fiber: unknown = key ? Reflect.get(node, key) : null;
      for (let depth = 0; object(fiber) && depth < 100; depth++, fiber = fiber.return) {
        const props = fiber.memoizedProps;
        if (object(props) && object(props.runtime) && object(props.runtime.engine)) { engine = props.runtime.engine; break; }
      }
      if (engine) break;
    }
    if (!engine || typeof engine.create !== 'function') throw new Error('IMPORT_ENGINE_NOT_FOUND');
    const create = engine.create, owner = engine; let held = false;
    owner.create = async (...args: unknown[]) => {
      if (!held) { held = true; document.documentElement.dataset.importHeld = 'true'; await new Promise<void>(resolve => window.addEventListener('test:release-import', () => resolve(), { once: true })); }
      return Reflect.apply(create, owner, args);
    };
  });
}

test('stopping a prepared import retains only unsaved inputs and resumes without duplicate admissions', async ({ page }) => {
  let calls = 0;
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => { calls++; const body = route.request().postDataJSON(); const input = lastModelInput(body); const verifier = typeof input === 'object' && input !== null && 'role' in input && input.role === 'verifier'; await route.fulfill({ contentType: 'text/event-stream', body: modelSse(verifier ? modelPass : { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] }, body) }); });
  await page.goto('/'); await configureLocalModel(page); await selectBatch(page); await holdAcceptedImport(page);
  await page.getByRole('button', { name: '导入并解题（3张）', exact: true }).click(); await expect(page.locator('html')).toHaveAttribute('data-import-held', 'true');
  await expect(page.getByTestId('import-photo-row')).toHaveCount(0);
  await page.getByRole('button', { name: '停止导入后续图片', exact: true }).click(); await page.evaluate(() => window.dispatchEvent(new Event('test:release-import')));
  await expect(page.getByTestId('import-photo-row')).toHaveCount(2); await expect.poll(() => calls).toBe(2);
  expect((await savedPhotos(page)).records.map(row => row.batch?.position)).toEqual([1]);
  await page.getByRole('button', { name: '导入并解题（2张）', exact: true }).click(); await expect.poll(() => calls).toBe(6);
  const saved = await savedPhotos(page); expect(saved.records.map(row => row.batch?.position)).toEqual([1, 2, 3]);
  [10, 20, 100].forEach((value, index) => expect(Math.abs(saved.red[index]! - value)).toBeLessThan(4));
});

test('appending an import avoids repeated global metadata reads and hides thumbnail reflows while busy', async ({ page }) => {
  let calls = 0;
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => { calls++; const body = route.request().postDataJSON(); const input = lastModelInput(body); const verifier = typeof input === 'object' && input !== null && 'role' in input && input.role === 'verifier'; await route.fulfill({ contentType: 'text/event-stream', body: modelSse(verifier ? modelPass : { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] }, body) }); });
  await page.goto('/'); await configureLocalModel(page); await selectBatch(page);
  await page.getByRole('button', { name: '导入并解题（3张）', exact: true }).click(); await expect.poll(() => calls).toBe(6); await page.getByRole('button', { name: '完成拍摄', exact: true }).click();
  await page.getByRole('tab', { name: '历史题目', exact: true }).click(); await page.getByRole('tab', { name: '批量记录', exact: true }).click(); await page.getByRole('button', { name: '打开批量', exact: true }).click();
  await page.getByRole('button', { name: '批次操作', exact: true }).click(); await selectFiles(page, '添加相册题图'); await holdAcceptedImport(page);
  await page.evaluate(() => {
    const get = IDBObjectStore.prototype.get; let reads = 0; document.documentElement.dataset.importMetadataReads = '0';
    IDBObjectStore.prototype.get = function(key) { if (typeof key === 'string' && /^(summary|favorite)\./.test(key)) document.documentElement.dataset.importMetadataReads = String(++reads); return get.call(this, key); };
  });
  await page.getByRole('button', { name: '导入并解题（3张）', exact: true }).click(); await expect(page.locator('html')).toHaveAttribute('data-import-held', 'true');
  await expect(page.getByTestId('import-photo-row')).toHaveCount(0); await expect(page.locator('html')).toHaveAttribute('data-import-metadata-reads', '0');
  await page.evaluate(() => window.dispatchEvent(new Event('test:release-import'))); await expect.poll(() => calls).toBe(12);
  await expect(page.getByRole('heading', { name: '确认图片顺序', exact: true })).toHaveCount(0); await expect(page.locator('html')).toHaveAttribute('data-import-metadata-reads', '0');
  expect((await savedPhotos(page)).records.map(row => row.batch?.position)).toEqual([1, 2, 3, 4, 5, 6]);
});
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
  await page.getByRole('button', { name: '关闭导入', exact: true }).click();
  await expect(page.getByRole('heading', { name: '确认图片顺序', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '完成拍摄', exact: true }).click(); expect(calls).toBe(0);
  await page.getByRole('tab', { name: '历史题目', exact: true }).click(); await page.getByRole('tab', { name: '批量记录', exact: true }).click();
  await expect(page.getByText('还没有批量解题记录。', { exact: true })).toBeVisible();
});

for (const entry of ['添加相册题图', '继续拍摄']) test(`existing batch inserts three ordered photos before an explicit position through ${entry}`, async ({ page }) => {
  let calls = 0;
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => { calls++; const body = route.request().postDataJSON(); const input = lastModelInput(body); const verifier = typeof input === 'object' && input !== null && 'role' in input && input.role === 'verifier'; await route.fulfill({ contentType: 'text/event-stream', body: modelSse(verifier ? modelPass : { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] }, body) }); });
  await page.goto('/'); await configureLocalModel(page); await selectBatch(page); await page.getByRole('button', { name: '导入并解题（3张）', exact: true }).click(); await expect.poll(() => calls).toBe(6);
  await page.getByRole('button', { name: '完成拍摄', exact: true }).click();
  await page.getByRole('tab', { name: '历史题目', exact: true }).click(); await page.getByRole('tab', { name: '批量记录', exact: true }).click(); await page.getByRole('button', { name: '打开批量', exact: true }).click();
  const original = await savedPhotos(page); const originalIds = original.records.map(record => record.session.id);
  await page.getByRole('button', { name: '批次操作', exact: true }).click();
  await expect(page.getByText('新增题图位置', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '插入指定位置', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: entry, exact: true })).toBeEnabled();
  if (entry === '继续拍摄') { await page.getByRole('button', { name: entry, exact: true }).click(); await selectFiles(page, '从相册选择'); }
  else await selectFiles(page, entry);
  await expect(page.getByTestId('batch-import-new-slot').getByTestId('batch-import-slot-number')).toHaveText(['4', '5', '6']);
  await insertionTarget(page, 2).click(); await page.getByRole('button', { name: '全部新图放到此处', exact: true }).click();
  await page.getByRole('button', { name: '导入并解题（3张）', exact: true }).click(); await expect.poll(() => calls).toBe(12);
  if (entry === '继续拍摄') await page.getByRole('button', { name: '完成拍摄', exact: true }).click();
  const inserted = await savedPhotos(page); expect(inserted.records.map(record => record.batch?.position)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(inserted.records.map(record => record.session.id).filter(id => originalIds.includes(id))).toEqual(originalIds);
  expect(inserted.records[0]!.session.id).toBe(originalIds[0]); expect(inserted.records[4]!.session.id).toBe(originalIds[1]); expect(inserted.records[5]!.session.id).toBe(originalIds[2]);
  [10, 10, 20, 100, 20, 100].forEach((value, index) => expect(Math.abs(inserted.red[index]! - value)).toBeLessThan(4));
  for (const record of original.records) expect(inserted.records.find(value => value.session.id === record.session.id)?.session).toEqual(record.session);
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
  await page.getByRole('button', { name: '编辑第1张题图', exact: true }).click();
  await page.getByRole('button', { name: '下移第1张', exact: true }).click();
  await page.getByRole('button', { name: '关闭图片操作', exact: true }).click();
  await page.getByRole('button', { name: '导入并解题（3张）', exact: true }).click();
  await expect.poll(() => calls).toBe(12); const appended = await savedPhotos(page);
  expect(appended.records.map(row => row.batch?.position)).toEqual([1, 2, 3, 4, 5, 6]);
  [10, 20, 100, 20, 10, 100].forEach((value, index) => expect(Math.abs(appended.red[index]! - value)).toBeLessThan(4));
  await page.getByRole('button', { name: '批次操作', exact: true }).click(); await selectFiles(page, '添加相册题图');
  await holdAcceptedImport(page);
  await page.getByRole('button', { name: '导入并解题（3张）', exact: true }).click(); await expect(page.locator('html')).toHaveAttribute('data-import-held', 'true');
  await page.goBack(); await expect(page.getByRole('tab', { name: '历史题目', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.goForward(); await expect(page.getByTestId('current-batch')).toBeVisible();
  await expect(page.getByRole('heading', { name: '确认图片顺序', exact: true })).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('test:release-import')));
  await expect(page.getByText('7 张题图', { exact: true })).toBeVisible(); expect(calls).toBe(12);
  const saved = await savedPhotos(page); expect(saved.records.map(row => row.batch?.position)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(saved.records.at(-1)?.session.runs).toHaveLength(0);
});

test('batch capture previews allow removal and cancel, saved photos allow adjustment, and discarding releases the camera', async ({ page }) => {
  let calls = 0;
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => { calls++; const body = route.request().postDataJSON(); const input = lastModelInput(body); const verifier = typeof input === 'object' && input !== null && 'role' in input && input.role === 'verifier'; await route.fulfill({ contentType: 'text/event-stream', body: modelSse(verifier ? modelPass : { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] }, body) }); });
  await page.goto('/'); await configureLocalModel(page); await selectBatch(page);
  await page.getByRole('button', { name: '移除第2张', exact: true }).click(); await expect(page.getByTestId('import-photo-row')).toHaveCount(2);
  await page.getByRole('button', { name: '取消导入', exact: true }).click(); expect((await savedPhotos(page)).records).toHaveLength(0); expect(calls).toBe(0);
  await selectFiles(page, '从相册选择'); await page.getByRole('button', { name: '移除第2张', exact: true }).click(); await page.getByRole('button', { name: '导入并解题（2张）', exact: true }).click(); await expect.poll(() => calls).toBe(4);
  await page.getByRole('button', { name: '调整批次图片', exact: true }).click(); await expect(page.getByTestId('batch-edit-row')).toHaveCount(2); await page.getByRole('button', { name: '取消调整', exact: true }).click();
  await expect(page.getByRole('button', { name: '拍摄', exact: true })).toBeEnabled();
  const stream = await page.locator('video').evaluateHandle(node => node instanceof HTMLVideoElement ? node.srcObject : null);
  await page.getByRole('button', { name: '放弃本批', exact: true }).click();
  expect(await stream.evaluate(value => value instanceof MediaStream && value.getTracks().every(track => track.readyState === 'ended'))).toBe(true);
  await page.getByRole('button', { name: '保留本批', exact: true }).click(); expect((await savedPhotos(page)).records).toHaveLength(2);
  await page.getByRole('button', { name: '放弃本批', exact: true }).click(); await page.getByRole('button', { name: '确认放弃本批', exact: true }).click();
  await expect.poll(async () => (await savedPhotos(page)).records.length).toBe(0); await expect(page.getByRole('button', { name: '拍一张', exact: true })).toBeVisible(); expect(calls).toBe(4); await stream.dispose();
});

for (const totalBytes of [200 * 1024 * 1024, 500 * 1024 * 1024, 500 * 1024 * 1024 + 1]) {
  test(`batch import byte limit accepts up to 500 MiB: ${totalBytes} original bytes`, async ({ page }) => {
    // Simulate picker metadata without allocating hundreds of MiB in every browser worker.
    await page.addInitScript(({ totalBytes }) => {
      const readSize = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')?.get;
      Object.defineProperty(File.prototype, 'size', { configurable: true, get(this: File) {
        if (this.name.startsWith('capacity-')) return Math.floor(totalBytes / 100) + (this.name === 'capacity-99.jpg' ? totalBytes % 100 : 0);
        return readSize?.call(this);
      } });
    }, { totalBytes });
    await page.route('**/__solveflow/web-env', route => route.fulfill({ status: 404, json: {} }));
    await page.route('**/__solveflow/web-env/**', route => route.abort());
    let modelCalls = 0;
    await page.route('https://fixture-model.invalid/**', route => { modelCalls++; return route.abort(); });
    await page.goto('/'); await configureLocalModel(page);
    await page.getByRole('button', { name: '拍照', exact: true }).click(); await page.getByRole('button', { name: '批量解题', exact: true }).click();
    await page.getByRole('button', { name: '允许使用相机' }).evaluateAll(nodes => { for (const node of nodes) if (node instanceof HTMLElement) node.click(); });
    const image = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 200;
      const context = canvas.getContext('2d'); if (!context) throw new Error('CANVAS');
      context.fillStyle = '#fff'; context.fillRect(0, 0, 300, 200); return canvas.toDataURL('image/jpeg').split(',')[1]!;
    });
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('dialog').getByRole('button', { name: '从相册选择', exact: true }).click();
    await (await chooser).setFiles(Array.from({ length: 100 }, (_, index) => ({ name: `capacity-${index}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from(image, 'base64') })));
    if (totalBytes <= 500 * 1024 * 1024) {
      await expect(page.getByRole('heading', { name: '确认图片顺序', exact: true })).toBeVisible();
      await expect(page.getByTestId('import-photo-row')).toHaveCount(100);
      await page.getByRole('button', { name: '取消导入', exact: true }).click();
    } else {
      await expect(page.getByText('本次选择超过500MB，请分次导入。', { exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: '确认图片顺序', exact: true })).toHaveCount(0);
    }
    expect((await savedPhotos(page)).records).toHaveLength(0); expect(modelCalls).toBe(0);
  });
}

test('batch upload timeout names the network failure and never replays after reload', async ({ page }) => {
  let calls = 0;
  // Upload markers are read through the same-origin Web bridge.
  const profile = { provider: 'fixture', baseURL: 'https://fixture-model.invalid/v1', model: 'synthetic-upload-model', api: 'openai-completions', contextWindow: 32768, maxTokens: 8192, maxTokensField: 'max_tokens' };
  await page.route('**/__solveflow/web-env', route => route.fulfill({ json: { schemaVersion: 1, settings: { schemaVersion: 1, solver: profile, verifier: null }, accessTokens: { solver: 'synthetic-upload-token', verifier: null, backup: null } } }));
  await page.route('https://fixture-model.invalid/**', route => route.abort());
  await page.route('**/__solveflow/web-env/model/**', route => {
    calls++; return route.fulfill({ status: 408, headers: { 'x-solveflow-request-failure': 'upload-timeout' }, json: { error: { message: 'private-upload-canary' } } });
  });
  await page.goto('/'); await expect(page.getByTestId('launch-screen')).toBeHidden(); await selectBatch(page);
  await page.getByRole('button', { name: '导入并解题（3张）', exact: true }).click();
  await expect.poll(() => calls).toBe(3);
  await page.getByRole('button', { name: '完成拍摄', exact: true }).click();
  await expect(page.getByText('题图上传超时，请检查网络后手动重试。', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('错误代码：MODEL_UPLOAD_TIMEOUT', { exact: true })).toBeVisible();
  await expect(page.getByText('模型服务拒绝了请求', { exact: false })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('错误代码：MODEL_UPLOAD_TIMEOUT', { exact: true })).toBeVisible();
  expect(calls).toBe(3); await expect(page.getByText('private-upload-canary', { exact: false })).toHaveCount(0);
});


for (const entry of ['添加相册题图', '继续拍摄']) {
  test(`single-image workbench inserts visually, cancels safely and defaults to append through ${entry}`, async ({ page }, testInfo) => {
    let calls = 0;
    await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
      calls++; const body = route.request().postDataJSON(); const input = lastModelInput(body);
      const verifier = typeof input === 'object' && input !== null && 'role' in input && input.role === 'verifier';
      await route.fulfill({ contentType: 'text/event-stream', body: modelSse(verifier ? modelPass : { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] }, body) });
    });
    await page.goto('/'); await configureLocalModel(page); await selectBatch(page);
    await page.getByRole('button', { name: '导入并解题（3张）', exact: true }).click(); await expect.poll(() => calls).toBe(6);
    await page.getByRole('button', { name: '完成拍摄', exact: true }).click();
    const original = await savedPhotos(page);
    async function addSingle(number: number) {
      await page.getByRole('button', { name: '批次操作', exact: true }).click();
      if (entry === '继续拍摄') { await page.getByRole('button', { name: entry, exact: true }).click(); await selectFiles(page, '从相册选择', [number]); }
      else await selectFiles(page, entry, [number]);
      await expect(page.getByRole('heading', { name: '新增题图工作台', exact: true })).toBeVisible();
      await page.getByTestId('batch-import-dialog').evaluate(async node => {
        for (let element: Element | null = node; element; element = element.parentElement) {
          await Promise.all(element.getAnimations().map(animation => animation.finished));
        }
      });
      await expect(page.getByText('新 1 → 第 4 张 · 追加到末尾', { exact: true })).toBeVisible();
      await expect.poll(async () => {
        const confirm = await page.getByRole('button', { name: '导入并解题（1张）', exact: true }).boundingBox();
        const dialog = await page.getByTestId('batch-import-dialog').boundingBox();
        return !!confirm && !!dialog && dialog.x >= 12 && dialog.y >= 12 && dialog.width <= 760 && dialog.y + dialog.height <= page.viewportSize()!.height - 12 && confirm.y >= dialog.y && confirm.y + confirm.height <= dialog.y + dialog.height;
      }).toBe(true);
      await expect(page.getByTestId('import-photo-row').getByRole('img')).toHaveAccessibleName(/^题图1缩略图：/);
      await expect(page.getByTestId('batch-import-insertion-cursor')).toHaveCount(1);
    }
    await addSingle(8);
    await insertionTarget(page, 2).click();
    await expect(page.getByText('新 1 → 第 2 张 · 目标：第 3 张（原第 2 张）', { exact: true })).toBeVisible();
    await expect(page.getByTestId('batch-import-existing-slot').nth(1).getByText('3', { exact: true })).toBeVisible();
    await expect(page.getByTestId('batch-import-existing-slot').nth(2).getByText('4', { exact: true })).toBeVisible();
    await expect(page.getByTestId('batch-import-slot-number')).toHaveText(['1', '2', '3', '4']);
    await expect(insertionTarget(page, 2)).toHaveAttribute('aria-label', '插到第3张之前（原第2张）');
    await expect(page.getByTestId('batch-import-new-slot').getByTestId('batch-import-slot-number')).toHaveText('2');
    await insertionTarget(page, 3).click();
    await expect(page.getByTestId('batch-import-placement-summary')).toHaveText('新 1 → 第 3 张 · 目标：第 4 张（原第 3 张）');
    await expect(page.getByTestId('batch-import-existing-slot').getByTestId('batch-import-slot-number')).toHaveText(['1', '2', '4']);
    await page.getByRole('button', { name: '本张追加到末尾', exact: true }).click();
    await expect(page.getByTestId('batch-import-existing-slot').getByTestId('batch-import-slot-number')).toHaveText(['1', '2', '3']);
    await expect(page.getByTestId('batch-import-placement-summary')).toHaveText('新 1 → 第 4 张 · 追加到末尾');
    await insertionTarget(page, 2).click();
    await expect(page.getByTestId('batch-import-placement-summary')).toHaveText('新 1 → 第 2 张 · 目标：第 3 张（原第 2 张）');
    await expect(page.getByTestId('batch-import-insertion-cursor')).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath('single-workbench.png'), fullPage: true });
    if (testInfo.project.name === 'mobile' && entry === '添加相册题图') {
      await page.setViewportSize({ width: 844, height: 390 });
      await expect.poll(async () => {
        const dialog = await page.getByTestId('batch-import-dialog').boundingBox();
        const confirm = await page.getByRole('button', { name: '导入并解题（1张）', exact: true }).boundingBox();
        return !!dialog && !!confirm && dialog.y >= 12 && dialog.y + dialog.height <= 378 && confirm.y >= dialog.y && confirm.y + confirm.height <= dialog.y + dialog.height;
      }).toBe(true);
      await expect(page.getByText('新 1 → 第 2 张 · 目标：第 3 张（原第 2 张）', { exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('single-workbench-landscape.png'), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
    }
    await page.getByRole('button', { name: '取消导入', exact: true }).click();
    expect((await savedPhotos(page)).records).toEqual(original.records); expect(calls).toBe(6);
    if (entry === '继续拍摄') await page.getByRole('button', { name: '完成拍摄', exact: true }).click();
    await addSingle(8);
    await insertionTarget(page, 2).click();
    const preview = await page.getByTestId('batch-import-slot-number').allTextContents();
    await page.getByRole('button', { name: '导入并解题（1张）', exact: true }).click(); await expect.poll(() => calls).toBe(8);
    if (entry === '继续拍摄') await page.getByRole('button', { name: '完成拍摄', exact: true }).click();
    const inserted = await savedPhotos(page);
    expect(inserted.records.map(row => row.batch?.position)).toEqual([1, 2, 3, 4]);
    expect(inserted.records.map(row => String(row.batch?.position))).toEqual(preview);
    expect(original.records.map(old => inserted.records.find(row => row.session.id === old.session.id)?.batch?.position)).toEqual([1, 3, 4]);
    [10, 80, 20, 100].forEach((value, index) => expect(Math.abs(inserted.red[index]! - value)).toBeLessThan(4));
    expect(inserted.records.filter(row => original.records.some(old => old.session.id === row.session.id)).map(row => row.session)).toEqual(original.records.map(row => row.session));
    await page.getByRole('button', { name: '批次操作', exact: true }).click();
    await selectFiles(page, '添加相册题图', [9]);
    await expect(page.getByText('新 1 → 第 5 张 · 追加到末尾', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '导入并解题（1张）', exact: true }).click(); await expect.poll(() => calls).toBe(10);
    const appended = await savedPhotos(page);
    [10, 80, 20, 100, 90].forEach((value, index) => expect(Math.abs(appended.red[index]! - value)).toBeLessThan(4));
  });
}

test('workbench independently places multiple images and resumes a stopped admission without duplicates', async ({ page }, testInfo) => {
  let calls = 0;
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    calls++; const body = route.request().postDataJSON(); const input = lastModelInput(body);
    const verifier = typeof input === 'object' && input !== null && 'role' in input && input.role === 'verifier';
    await route.fulfill({ contentType: 'text/event-stream', body: modelSse(verifier ? modelPass : { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] }, body) });
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/'); await configureLocalModel(page); await selectBatch(page);
  await page.getByRole('button', { name: '导入并解题（3张）', exact: true }).click(); await expect.poll(() => calls).toBe(6);
  await page.getByRole('button', { name: '完成拍摄', exact: true }).click();
  const original = await savedPhotos(page);
  await page.getByRole('button', { name: '批次操作', exact: true }).click(); await selectFiles(page, '添加相册题图');
  await insertionTarget(page, 2).click();
  await page.getByRole('button', { name: '全部新图放到此处', exact: true }).click();
  await expect(page.getByTestId('batch-import-placement-summary')).toHaveText('新 1 → 第 2 张 · 目标：第 5 张（原第 2 张）');
  await expect(page.getByTestId('batch-import-new-slot').getByTestId('batch-import-slot-number')).toHaveText(['2', '3', '4']);
  await expect(page.getByTestId('batch-import-existing-slot').getByTestId('batch-import-slot-number')).toHaveText(['1', '5', '6']);
  await expect(page.getByTestId('import-photo-row').nth(2)).toContainText('加入后第 4 张');
  await page.getByRole('button', { name: '全部追加到末尾', exact: true }).click();
  await expect(page.getByText('新 1 → 第 4 张 · 追加到末尾', { exact: true })).toBeVisible();
  await insertionTarget(page, 3).click();
  await page.getByRole('button', { name: '选择新图2的位置', exact: true }).click();
  await insertionTarget(page, 1).click();
  await expect(page.getByText('新 2 → 第 1 张 · 目标：第 2 张（原第 1 张）', { exact: true })).toBeVisible();
  await expect(page.getByTestId('batch-import-slot-number')).toHaveText(['1', '2', '3', '4', '5', '6']);
  await expect(page.getByTestId('batch-import-existing-slot').getByTestId('batch-import-slot-number')).toHaveText(['2', '3', '5']);
  await expect(page.getByTestId('batch-import-new-slot').getByTestId('batch-import-slot-number')).toHaveText(['1', '4', '6']);
  await expect(page.getByTestId('batch-import-existing-slot').first()).toHaveCSS('background-color', 'rgb(14, 21, 32)');
  await page.screenshot({ path: testInfo.outputPath('multiple-workbench-dark.png'), fullPage: true });
  await holdAcceptedImport(page);
  await page.getByRole('button', { name: '导入并解题（3张）', exact: true }).click(); await expect(page.locator('html')).toHaveAttribute('data-import-held', 'true');
  await page.getByRole('button', { name: '停止导入后续图片', exact: true }).click(); await page.evaluate(() => window.dispatchEvent(new Event('test:release-import')));
  await expect(page.getByTestId('import-photo-row')).toHaveCount(2); await expect.poll(() => calls).toBe(8);
  await expect(page.getByTestId('batch-import-slot-number')).toHaveText(['1', '2', '3', '4', '5', '6']);
  await page.getByRole('button', { name: '导入并解题（2张）', exact: true }).click(); await expect.poll(() => calls).toBe(12);
  const saved = await savedPhotos(page);
  expect(saved.records.map(row => row.batch?.position)).toEqual([1, 2, 3, 4, 5, 6]);
  [20, 10, 20, 10, 100, 100].forEach((value, index) => expect(Math.abs(saved.red[index]! - value)).toBeLessThan(4));
  expect(saved.records.filter(row => original.records.some(old => old.session.id === row.session.id)).map(row => row.session)).toEqual(original.records.map(row => row.session));
});

async function prepareDragWorkbench(page: Page, total = 3) {
  let calls = 0;
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    calls++; const body = route.request().postDataJSON(); const input = lastModelInput(body);
    const verifier = typeof input === 'object' && input !== null && 'role' in input && input.role === 'verifier';
    await route.fulfill({ contentType: 'text/event-stream', body: modelSse(verifier ? modelPass : { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] }, body) });
  });
  await page.goto('/'); await configureLocalModel(page); await selectBatch(page);
  await page.getByRole('button', { name: '导入并解题（3张）', exact: true }).click(); await expect.poll(() => calls).toBe(6);
  await page.getByRole('button', { name: '完成拍摄', exact: true }).click();
  const original = await savedPhotos(page);
  if (total > 3) {
    const batch = original.records[0]?.batch; if (!batch) throw new Error('SYNTHETIC_BATCH_NOT_FOUND');
    await page.evaluate(async ({ batch, total }) => {
      const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';
      let engine: Record<string, unknown> | null = null;
      for (const node of document.querySelectorAll('*')) {
        const key = Object.keys(node).find(name => name.startsWith('__reactFiber$')); let fiber: unknown = key ? Reflect.get(node, key) : null;
        for (let depth = 0; object(fiber) && depth < 100; depth++, fiber = fiber.return) {
          const props = fiber.memoizedProps;
          if (object(props) && object(props.runtime) && object(props.runtime.engine)) { engine = props.runtime.engine; break; }
        }
        if (engine) break;
      }
      if (!engine || typeof engine.create !== 'function') throw new Error('SYNTHETIC_ENGINE_NOT_FOUND');
      const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 200;
      const context = canvas.getContext('2d'); if (!context) throw new Error('CANVAS'); context.fillStyle = '#fff'; context.fillRect(0, 0, 300, 200);
      const image = canvas.toDataURL('image/jpeg');
      for (let position = 4; position <= total; position++) await Reflect.apply(engine.create, engine, [image, 300, 200, batch.exam, { ...batch, position }]);
    }, { batch, total });
  }
  await page.getByRole('button', { name: '批次操作', exact: true }).click(); await selectFiles(page, '添加相册题图');
  await page.getByTestId('batch-import-dialog').evaluate(async node => {
    for (let element: Element | null = node; element; element = element.parentElement) await Promise.all(element.getAnimations().map(animation => animation.finished));
  });
  return { original, calls: () => calls };
}

test('new image thumbnails keep selection separate from tools and preserve edited pixels and insertion positions', async ({ page }, info) => {
  const prepared = await prepareDragWorkbench(page);
  const cards = page.getByTestId('import-photo-row');
  await expect(cards).toHaveCount(3);
  await expect(cards.getByRole('img')).toHaveCount(3);
  await page.getByRole('button', { name: '选择新图2的位置', exact: true }).click();
  await expect(page.getByTestId('import-photo-tools')).toHaveCount(0);
  await page.getByRole('button', { name: '编辑第1张题图', exact: true }).click();
  const tools = page.getByTestId('import-photo-tools');
  await expect(tools).toContainText('question-1.jpg');
  await expect(page.getByTestId('batch-import-drag-ghost')).toHaveCount(0);
  await tools.getByRole('button', { name: '旋转第1张', exact: true }).click();
  await expect(tools.getByRole('button', { name: '旋转第1张', exact: true })).toBeEnabled();
  await tools.getByRole('button', { name: '裁剪第1张', exact: true }).click();
  await page.getByRole('button', { name: '精细调整', exact: true }).click();
  await page.getByRole('button', { name: '右边界减小', exact: true }).click();
  await page.getByRole('button', { name: '使用这张题图', exact: true }).click();
  await expect(page.getByRole('heading', { name: '确认与裁切题图', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '移除第2张', exact: true }).click();
  await expect(cards).toHaveCount(2);
  await expect(page.getByRole('button', { name: /^上移第|^下移第/ })).toHaveCount(0);
  await insertionTarget(page, 2).click(); await page.getByRole('button', { name: '全部新图放到此处', exact: true }).click();
  await expect(page.getByTestId('batch-import-new-slot').getByTestId('batch-import-slot-number')).toHaveText(['2', '3']);
  expect(prepared.calls()).toBe(6); expect((await savedPhotos(page)).records).toEqual(prepared.original.records);
  await page.screenshot({ path: info.outputPath('thumbnail-workbench.png') });
  await page.getByRole('button', { name: '导入并解题（2张）', exact: true }).click(); await expect.poll(prepared.calls).toBe(10);
  const saved = await savedPhotos(page);
  expect(saved.records.map(row => row.batch?.position)).toEqual([1, 2, 3, 4, 5]);
  expect(saved.records[1]?.session.upload).toMatchObject({ width: 196, height: 300 });
  expect(saved.records[2]?.session.upload).toMatchObject({ width: 300, height: 200 });
  [10, 10, 100, 20, 100].forEach((value, index) => expect(Math.abs(saved.red[index]! - value)).toBeLessThan(4));
  for (const old of prepared.original.records) expect(saved.records.find(row => row.session.id === old.session.id)?.session).toEqual(old.session);
});

test('cancelling an edited thumbnail draft releases every temporary image without saving or answering', async ({ page }) => {
  await page.addInitScript(() => {
    const created: string[] = [], released: string[] = [];
    Reflect.set(window, '__importUrlAudit', { created, released });
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = value => { const uri = create(value); created.push(uri); return uri; };
    URL.revokeObjectURL = value => { released.push(value); revoke(value); };
  });
  const prepared = await prepareDragWorkbench(page);
  await page.getByRole('button', { name: '编辑第1张题图', exact: true }).click();
  await page.getByRole('button', { name: '旋转第1张', exact: true }).click();
  await expect(page.getByRole('button', { name: '旋转第1张', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '关闭图片操作', exact: true }).click();
  await page.getByRole('button', { name: '取消导入', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const value: unknown = Reflect.get(window, '__importUrlAudit');
    if (!value || typeof value !== 'object' || !('created' in value) || !Array.isArray(value.created) || !('released' in value) || !Array.isArray(value.released)) throw new Error('URL_AUDIT_MISSING');
    const released = value.released;
    return value.created.filter(uri => !released.includes(uri)).length;
  })).toBe(0);
  expect((await savedPhotos(page)).records).toEqual(prepared.original.records); expect(prepared.calls()).toBe(6);
});

async function startImportPointer(page: Page, source: Locator, touch: boolean) {
  await source.scrollIntoViewIfNeeded(); const box = await source.boundingBox(); if (!box) throw new Error('DRAG_SOURCE_NOT_VISIBLE');
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const cdp = touch ? await page.context().newCDPSession(page) : null;
  if (cdp) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: x + 8, y: y + 8 }] });
  } else { await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 8, y + 8); }
  await expect(page.getByTestId('batch-import-drag-ghost')).toBeVisible();
  return {
    async move(x: number, y: number) {
      if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x, y }] });
      else await page.mouse.move(x, y, { steps: 8 });
    },
    async finish() { if (cdp) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach(); } else await page.mouse.up(); },
    async cancel() { if (cdp) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); await cdp.detach(); } else { await page.keyboard.press('Escape'); await page.mouse.up(); } },
  };
}
async function importTargetPoint(target: Locator, side: 'before' | 'after' = 'before') {
  const box = await target.boundingBox(); if (!box) throw new Error('DRAG_TARGET_NOT_VISIBLE');
  return { x: box.x + box.width * (side === 'before' ? .2 : .8), y: box.y + box.height / 2 };
}

test('workbench drag previews single placement, stages only on release and saves the visible order', async ({ page }, info) => {
  const fixture = await prepareDragWorkbench(page);
  const pointer = await startImportPointer(page, page.getByRole('button', { name: '选择新图1的位置', exact: true }), info.project.name === 'mobile');
  const point = await importTargetPoint(insertionTarget(page, 2)); await pointer.move(point.x, point.y);
  await expect(page.getByTestId('batch-import-new-slot').getByTestId('batch-import-slot-number')).toHaveText(['2', '5', '6']);
  await expect(page.getByRole('button', { name: '导入并解题（3张）', exact: true })).toBeDisabled();
  expect((await savedPhotos(page)).records).toEqual(fixture.original.records); expect(fixture.calls()).toBe(6);
  await pointer.finish(); await expect(page.getByTestId('batch-import-drag-ghost')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '导入并解题（3张）', exact: true })).toBeEnabled();
  await expect(page.getByTestId('batch-import-new-slot').getByTestId('batch-import-slot-number')).toHaveText(['2', '5', '6']);
  await page.screenshot({ path: info.outputPath('drag-single.png'), fullPage: true });
  await page.getByRole('button', { name: '导入并解题（3张）', exact: true }).click(); await expect.poll(fixture.calls).toBe(12);
  const saved = await savedPhotos(page); [10, 10, 20, 100, 20, 100].forEach((value, index) => expect(Math.abs(saved.red[index]! - value)).toBeLessThan(4));
});

test('workbench drag reorders pending peers and moves the whole incoming group', async ({ page }, info) => {
  const fixture = await prepareDragWorkbench(page);
  const pointer = await startImportPointer(page, page.getByTestId('batch-import-new-slot').nth(2), info.project.name === 'mobile');
  const point = await importTargetPoint(page.getByTestId('batch-import-new-slot').first()); await pointer.move(point.x, point.y); await pointer.finish();
  await expect(page.getByTestId('import-photo-row').first().getByRole('img')).toHaveAccessibleName('题图1缩略图：question-10.jpg');
  await page.getByRole('button', { name: '整组拖动', exact: true }).click();
  await expect(page.getByRole('button', { name: '整组拖动', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const group = await startImportPointer(page, page.getByRole('button', { name: '选择新图1的位置', exact: true }), info.project.name === 'mobile');
  const middle = await importTargetPoint(insertionTarget(page, 2)); await group.move(middle.x, middle.y);
  await expect(page.getByTestId('batch-import-new-slot').getByTestId('batch-import-slot-number')).toHaveText(['2', '3', '4']);
  await group.finish(); await expect(page.getByTestId('batch-import-existing-slot').getByTestId('batch-import-slot-number')).toHaveText(['1', '5', '6']);
  expect(fixture.calls()).toBe(6); await page.screenshot({ path: info.outputPath('drag-group.png'), fullPage: true });
  await page.getByRole('button', { name: '导入并解题（3张）', exact: true }).click(); await expect.poll(fixture.calls).toBe(12);
  const saved = await savedPhotos(page); [10, 100, 10, 20, 20, 100].forEach((value, index) => expect(Math.abs(saved.red[index]! - value)).toBeLessThan(4));
});

test('workbench drag cancellation restores the draft without saving or closing its dialog', async ({ page }, info) => {
  const fixture = await prepareDragWorkbench(page);
  const original = await page.getByTestId('batch-import-slot-number').allTextContents();
  const pointer = await startImportPointer(page, page.getByRole('button', { name: '选择新图1的位置', exact: true }), false);
  const point = await importTargetPoint(insertionTarget(page, 2)); await pointer.move(point.x, point.y);
  await expect(page.getByTestId('batch-import-new-slot').getByTestId('batch-import-slot-number')).toHaveText(['2', '5', '6']);
  await pointer.cancel();
  await expect(page.getByRole('heading', { name: '新增题图工作台', exact: true })).toBeVisible();
  await expect(page.getByTestId('batch-import-slot-number')).toHaveText(original);
  await expect(page.getByTestId('batch-import-new-slot').getByTestId('batch-import-slot-number')).toHaveText(['4', '5', '6']);
  const outside = await startImportPointer(page, page.getByRole('button', { name: '选择新图1的位置', exact: true }), info.project.name === 'mobile');
  const header = await page.getByRole('heading', { name: '新增题图工作台', exact: true }).boundingBox(); if (!header) throw new Error('HEADER');
  await outside.move(header.x + 12, header.y + 12); await outside.finish();
  await expect(page.getByTestId('batch-import-new-slot').getByTestId('batch-import-slot-number')).toHaveText(['4', '5', '6']);
  if (info.project.name === 'mobile') {
    const cancelled = await startImportPointer(page, page.getByRole('button', { name: '选择新图1的位置', exact: true }), true);
    const target = await importTargetPoint(insertionTarget(page, 2)); await cancelled.move(target.x, target.y); await cancelled.cancel();
    await expect(page.getByTestId('batch-import-new-slot').getByTestId('batch-import-slot-number')).toHaveText(['4', '5', '6']);
  }
  expect((await savedPhotos(page)).records).toEqual(fixture.original.records); expect(fixture.calls()).toBe(6);
  await page.getByRole('button', { name: '取消导入', exact: true }).click();
});

test('workbench drag automatically scrolls a long grid and releases resources after cancellation', async ({ page }, info) => {
  const fixture = await prepareDragWorkbench(page, 80);
  const body = page.getByTestId('batch-import-scroll');
  const pointer = await startImportPointer(page, page.getByRole('button', { name: '选择新图3的位置', exact: true }), info.project.name === 'mobile');
  const box = await body.boundingBox(); if (!box) throw new Error('SCROLL_BODY');
  await pointer.move(box.x + 45, box.y + box.height - 10);
  await expect.poll(() => body.evaluate(node => node.scrollTop), { timeout: 10000 }).toBeGreaterThan(0);
  await expect.poll(() => body.evaluate(node => node.scrollTop >= node.scrollHeight - node.clientHeight - 2), { timeout: 10000 }).toBe(true);
  const point = await importTargetPoint(insertionTarget(page, 80)); await pointer.move(point.x, point.y); await pointer.finish();
  await expect(page.getByTestId('batch-import-new-slot').getByTestId('batch-import-slot-number')).toHaveText(['80', '82', '83']);
  await expect(insertionTarget(page, 80)).toHaveAttribute('aria-label', '插到第81张之前（原第80张）');
  await expect(page.getByTestId('batch-import-drag-ghost')).toHaveCount(0);
  const position = await body.evaluate(node => node.scrollTop); await page.waitForTimeout(100);
  expect(await body.evaluate(node => node.scrollTop)).toBe(position);
  await page.getByRole('button', { name: '取消导入', exact: true }).click();
  expect((await savedPhotos(page)).records).toHaveLength(80); expect(fixture.calls()).toBe(6);
});
