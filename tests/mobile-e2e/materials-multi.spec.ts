import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { LocalRecordSchema, StoredLocalRecordSchema, StoredLocalImageSchema, BatchPrintLayoutInputSchema, parsePreparedPrintRecord, type LocalRecord } from '../../packages/contracts/src/local.js';
import { questionsForBatchQuestionPrint } from '../../packages/client/src/batch-print-variants.js';
import { configureLocalModel, lastModelInput, modelSse } from './local-fixture.js';

test.use({ reducedMotion: 'reduce' });
async function seed(page: Page, configured = false, batch = false) {
  await page.goto('/'); await expect(page.getByTestId('launch-screen')).toBeHidden(); if (configured) await configureLocalModel(page);
  const ids = { id: randomUUID(), run: randomUUID(), material: randomUUID(), batch: randomUUID() };
  const source = await page.evaluate(({ ids, batch }) => new Promise<{ main: string; extra: string }>((resolve, reject) => {
    function picture(color: string) { const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 300; const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('CANVAS'); ctx.fillStyle = color; ctx.fillRect(0, 0, 600, 300); return canvas.toDataURL('image/jpeg'); }
    const main = picture('#fff'); const extra = picture('#bb2244'); const createdAt = new Date().toISOString();
    const record = { schemaVersion: 1, ...(batch ? { batch: { id: ids.batch, title: 'Supplement edit PDF', createdAt, exam: 'general', position: 1 } } : {}), image: main, materials: [{ id: ids.material, image: extra, width: 600, height: 300, bytes: atob(extra.split(',')[1]!).length }], activeImageIds: [ids.id, ids.material], session: { schemaVersion: 1, id: ids.id, subject: 'math', createdAt, upload: { schemaVersion: 1, id: ids.id, mimeType: 'image/jpeg', width: 600, height: 300, bytes: atob(main.split(',')[1]!).length, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${ids.id}/image` }, runs: [{ schemaVersion: 1, id: ids.run, sessionId: ids.id, seq: 1, createdAt, status: 'completed', imageIds: [ids.id, ids.material], message: '', outcome: { schemaVersion: 1, status: 'completed', verified: false, verificationStatus: 'not_requested', verification: null, warning: null, candidate: { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } } }] } };
    const request = indexedDB.open('solveflow-local', 1); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result; const tx = db.transaction('documents', 'readwrite'); tx.objectStore('documents').put(JSON.stringify(record), `record.${ids.id}`); tx.oncomplete = () => { db.close(); resolve({ main, extra }); }; tx.onerror = () => { db.close(); reject(tx.error); }; };
  }), { ids, batch });
  await page.goto(`/?session=${ids.id}`); await expect(page.locator('.final-answer')).toContainText('x=2'); if (configured) await configureLocalModel(page);
  return { ...ids, ...source };
}
async function readDocument(page: Page, key: string) { return page.evaluate(key => new Promise<string>((resolve, reject) => { const request = indexedDB.open('solveflow-local'); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result; const read = db.transaction('documents').objectStore('documents').get(key); read.onsuccess = () => { db.close(); if (typeof read.result === 'string') resolve(read.result); else reject(new Error('MISSING_DOCUMENT')); }; read.onerror = () => { db.close(); reject(read.error); }; }; }), key); }
async function files(page: Page, count = 3) {
  const encoded = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 300; const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('CANVAS'); ctx.fillStyle = '#386edd'; ctx.fillRect(0, 0, 600, 300); return canvas.toDataURL('image/jpeg').split(',')[1]!; });
  return Array.from({ length: count }, (_, index) => ({ name: `supp-${count - index}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from(encoded, 'base64') }));
}
async function select(page: Page, title = '从相册补图', count = 3) { const selected = await files(page, count); const waiting = page.waitForEvent('filechooser'); await page.getByRole('button', { name: title, exact: true }).click(); const chooser = await waiting; expect(chooser.isMultiple()).toBe(true); await chooser.setFiles(selected); }
async function crop(page: Page) { await page.getByRole('button', { name: '精细调整', exact: true }).click(); await page.getByRole('button', { name: '左边界增大', exact: true }).click(); await page.getByRole('button', { name: '使用这张题图', exact: true }).click(); }
async function trackUrls(page: Page) { await page.evaluate(() => { const live = new Set<string>(); const create = URL.createObjectURL.bind(URL); const revoke = URL.revokeObjectURL.bind(URL); const update = () => { document.documentElement.dataset.livePhotoUrls = String(live.size); }; URL.createObjectURL = blob => { const uri = create(blob); live.add(uri); update(); return uri; }; URL.revokeObjectURL = uri => { live.delete(uri); update(); revoke(uri); }; update(); }); }
async function seedPreparedPaper(page: Page, record: LocalRecord) {
  if (!record.batch) throw new Error('MISSING_BATCH');
  const questions = questionsForBatchQuestionPrint({ schemaVersion: 1, batch: { id: record.batch.id, title: record.batch.title, createdAt: record.batch.createdAt, exam: record.batch.exam }, exportedAt: new Date().toISOString(), records: [record] });
  const available = [{ id: record.session.upload.id, image: record.image }, ...(record.materials ?? []).map(({ id, image }) => ({ id, image }))];
  const sources = (record.activeImageIds ?? available.map(source => source.id)).map(id => { const source = available.find(source => source.id === id); if (!source) throw new Error('MISSING_CURRENT_IMAGE'); return source; });
  const input = BatchPrintLayoutInputSchema.parse({ purpose: 'reference', questions: questions.map(({ key, problem }) => ({ key, problem })), sources });
  const assets = sources.map(({ id }, index) => ({ key: `${questions[0]!.key}/${id}/current`, sourceId: id, alt: `Current synthetic diagram ${index + 1}`, role: 'question' }));
  // This fixture checks source ownership; an explicit opt-out keeps byte equality independent of enhancement.
  const adjustments = Object.fromEntries(assets.map(asset => [asset.key, { rotation: 0, crop: { left: 0, top: 0, right: 1, bottom: 1 }, enhance: false }]));
  const prepared = parsePreparedPrintRecord({ schemaVersion: 1, layouts: Object.fromEntries(questions.map(question => [question.key, { problem: question.problem, assets, warnings: [] }])), images: Object.fromEntries(assets.map((asset, index) => [asset.key, sources[index]!.image])), sources: assets.map((asset, index) => ({ key: asset.key, image: sources[index]!.image, label: asset.alt, region: true })), adjustments }, input);
  // Independent versioned-storage fixture avoids importing the mobile Web/JSX graph.
  // Browser ready-state and ordered-pixel assertions verify this persisted protocol against the app.
  const key = `prepared-paper-1-sharpen-1:${createHash('sha256').update(JSON.stringify({ questions: input.questions, sources: input.sources })).digest('hex')}`;
  await page.evaluate(({ key, prepared }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('solveflow-print-cache', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('entries'); request.result.createObjectStore('metadata', { keyPath: 'key' }); };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result; const tx = db.transaction(['entries', 'metadata'], 'readwrite');
      tx.objectStore('entries').put(prepared, key); tx.objectStore('metadata').put({ key, bytes: new TextEncoder().encode(JSON.stringify(prepared)).byteLength, usedAt: Date.now() });
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), { key, prepared });
  return sources.map(source => source.image);
}

test('selects several supplements once, permits crop rotation and removal, and edits a saved supplement without changing old answer evidence', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); let calls = 0; await page.route('https://**', route => { calls++; return route.abort(); });
  await page.route('**/__solveflow/web-env/model/**', route => { calls++; return route.abort(); });
  const source = await seed(page, false, true); const before = LocalRecordSchema.parse(JSON.parse(await readDocument(page, `record.${source.id}`))); await trackUrls(page);
  await page.getByRole('button', { name: '同题材料 / 补图', exact: true }).click(); await select(page); await expect(page.getByTestId('material-import-row')).toHaveCount(3); await expect(page.getByTestId('material-import-row').nth(0)).toContainText('supp-1.jpg');
  await page.getByRole('button', { name: '裁剪第1张', exact: true }).click(); await crop(page); await expect(page.getByTestId('material-import-row').nth(0)).toContainText('588 × 300');
  await page.getByRole('button', { name: '旋转第2张', exact: true }).click(); await expect(page.getByTestId('material-import-row').nth(1)).toContainText('300 × 600'); await page.getByRole('button', { name: '移除第3张', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'dark' }); await page.screenshot({ path: info.outputPath('multi-material-preview.png') });
  await page.getByRole('button', { name: '保存补图（2张）', exact: true }).click(); await expect(page.getByRole('button', { name: '查看材料 3', exact: true })).toBeVisible(); await expect(page.locator('html')).toHaveAttribute('data-live-photo-urls', '0');
  const saved = StoredLocalRecordSchema.parse(JSON.parse(await readDocument(page, `record.${source.id}`))); expect(saved.materials).toHaveLength(3); expect(saved.materials?.slice(1).map(item => [item.width, item.height])).toEqual([[588, 300], [300, 600]]); expect(saved.session.runs).toEqual(before.session.runs); expect(calls).toBe(0);
  await page.getByRole('button', { name: '编辑材料1', exact: true }).click(); await crop(page);
  await expect.poll(async () => StoredLocalRecordSchema.parse(JSON.parse(await readDocument(page, `record.${source.id}`))).materials?.length).toBe(4);
  await expect(page.getByLabel('裁切预览', { exact: true })).toHaveCount(0);
  const edited = StoredLocalRecordSchema.parse(JSON.parse(await readDocument(page, `record.${source.id}`))); expect(edited.materials).toHaveLength(4); expect(edited.materials?.[0]?.id).toBe(source.material); expect(edited.activeImageIds).toEqual([source.id, edited.materials?.at(-1)?.id, ...saved.materials!.slice(1).map(item => item.id)]); expect(edited.session.runs).toEqual(saved.session.runs);
  expect(StoredLocalImageSchema.parse(JSON.parse(await readDocument(page, `material.${source.id}.${source.material}`))).image).toBe(source.extra); expect(calls).toBe(0); await expect(page.locator('html')).toHaveAttribute('data-live-photo-urls', '0');
  await page.getByRole('button', { name: '返回题目', exact: true }).click(); await page.reload(); await page.getByRole('button', { name: '同题材料 / 补图', exact: true }).click(); await expect(page.getByRole('button', { name: '查看材料 3', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回题目', exact: true }).click();
  const currentRaw = await readDocument(page, `record.${source.id}`);
  const current = LocalRecordSchema.parse({ ...edited, schemaVersion: 1, image: source.main, materials: await Promise.all((edited.materials ?? []).map(async material => ({ ...material, image: StoredLocalImageSchema.parse(JSON.parse(await readDocument(page, `material.${source.id}.${material.id}`))).image }))) });
  const currentImages = await seedPreparedPaper(page, current); expect(currentImages).toHaveLength(4);
  await page.getByRole('button', { name: '批次操作', exact: true }).click(); await page.getByRole('button', { name: '导出本批 PDF', exact: true }).click();
  await expect(page.getByRole('button', { name: '整理后的试卷', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('status', { name: '试卷整理状态', exact: true })).toHaveText('已整理，可直接复用');
  await page.getByText('预览导出内容', { exact: true }).click();
  const preview = page.getByTestId('batch-copy-document'); await expect(preview.locator('img')).toHaveCount(4);
  const latestImage = StoredLocalImageSchema.parse(JSON.parse(await readDocument(page, `material.${source.id}.${edited.activeImageIds?.[1]}`))).image;
  await expect(preview.locator('img').nth(1)).toHaveAttribute('src', latestImage);
  expect(await preview.locator('img').evaluateAll(images => images.map(image => image.getAttribute('src')))).toEqual(currentImages);
  expect(latestImage).not.toBe(source.extra);
  expect(await readDocument(page, `record.${source.id}`)).toBe(currentRaw);
  expect(StoredLocalImageSchema.parse(JSON.parse(await readDocument(page, `material.${source.id}.${source.material}`))).image).toBe(source.extra);
  expect(StoredLocalRecordSchema.parse(JSON.parse(currentRaw)).session.runs).toEqual(before.session.runs);
  expect(calls).toBe(0); expect(errors).toEqual([]);
});
test('cancelling multi-image edits releases all temporary photos and keeps records and requests unchanged', async ({ page }) => {
  let calls = 0; await page.route('https://**', route => { calls++; return route.abort(); }); const source = await seed(page); const before = await readDocument(page, `record.${source.id}`); await trackUrls(page);
  await page.getByRole('button', { name: '同题材料 / 补图', exact: true }).click(); await select(page); await page.getByRole('button', { name: '裁剪第1张', exact: true }).click(); await crop(page); await page.getByRole('button', { name: '移除第2张', exact: true }).click(); await page.getByRole('button', { name: '取消补图', exact: true }).click();
  expect(await readDocument(page, `record.${source.id}`)).toBe(before); await expect(page.locator('html')).toHaveAttribute('data-live-photo-urls', '0'); expect(calls).toBe(0);
});
test('a failed transaction keeps the whole multi-image draft for retry and saves no prefix', async ({ page }) => {
  const source = await seed(page); const before = await readDocument(page, `record.${source.id}`); await trackUrls(page); await page.getByRole('button', { name: '同题材料 / 补图', exact: true }).click(); await select(page);
  await page.evaluate(() => { document.documentElement.dataset.failMaterialSave = 'true'; IDBDatabase.prototype.transaction = new Proxy(IDBDatabase.prototype.transaction, { apply(target, context, args) { const tx: IDBTransaction = Reflect.apply(target, context, args); if (args[0] === 'documents' && args[1] === 'readwrite' && document.documentElement.dataset.failMaterialSave === 'true') queueMicrotask(() => tx.abort()); return tx; } }); });
  await page.getByRole('button', { name: '保存补图（3张）', exact: true }).click(); await expect(page.getByText('本地保存失败，请检查可用存储空间。', { exact: true })).toBeVisible(); await expect(page.getByTestId('material-import-row')).toHaveCount(3); expect(await readDocument(page, `record.${source.id}`)).toBe(before);
  await page.evaluate(() => { document.documentElement.dataset.failMaterialSave = 'false'; }); await page.getByRole('button', { name: '保存补图（3张）', exact: true }).click(); await expect(page.getByRole('button', { name: '查看材料 4', exact: true })).toBeVisible(); expect(StoredLocalRecordSchema.parse(JSON.parse(await readDocument(page, `record.${source.id}`))).materials).toHaveLength(4); await expect(page.locator('html')).toHaveAttribute('data-live-photo-urls', '0');
});
test('over-selection is rejected before decoding or saving any supplement', async ({ page }) => {
  const source = await seed(page); const before = await readDocument(page, `record.${source.id}`); await trackUrls(page); await page.getByRole('button', { name: '同题材料 / 补图', exact: true }).click(); await select(page, '从相册补图', 7);
  await expect(page.getByText('本批还可添加6张图片，请减少选择数量。', { exact: true })).toBeVisible(); await expect(page.getByTestId('material-import-row')).toHaveCount(0); expect(await readDocument(page, `record.${source.id}`)).toBe(before); await expect(page.locator('html')).toHaveAttribute('data-live-photo-urls', '0');
});
test('correction also accepts multiple pictures and can crop a saved picture before explicitly submitting its new snapshot', async ({ page }) => {
  const calls: unknown[] = []; await page.route('https://fixture-model.invalid/v1/chat/completions', async route => { const body: unknown = route.request().postDataJSON(); calls.push(body); await route.fulfill({ contentType: 'text/event-stream', body: modelSse({ schemaVersion: 1, kind: 'answer', problem: { text: 'x+2=6', subject: 'math', uncertainties: [] }, answer: 'x=4', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] }, body) }); });
  const source = await seed(page, true); const rawBefore = await readDocument(page, `record.${source.id}`); const before = LocalRecordSchema.parse(JSON.parse(rawBefore));
  await page.getByRole('button', { name: '识别有误？更正题干', exact: true }).click(); await select(page, '添加图片', 2); await page.getByRole('button', { name: '保存补图（2张）', exact: true }).click(); await expect(page.getByTestId('correction-image')).toHaveCount(4);
  await page.getByRole('button', { name: '裁剪图片1', exact: true }).click(); await crop(page); expect(await readDocument(page, `record.${source.id}`)).toBe(rawBefore); expect(calls).toHaveLength(0);
  await page.getByLabel('更正后的题干', { exact: true }).fill('x+2=6'); await page.getByRole('button', { name: '按更正重新解答', exact: true }).click(); await expect(page.locator('.final-answer')).toContainText('x=4'); expect(calls).toHaveLength(1);
  const saved = StoredLocalRecordSchema.parse(JSON.parse(await readDocument(page, `record.${source.id}`))); expect(saved.activeImageIds).toHaveLength(4); expect(saved.activeImageIds?.[0]).not.toBe(source.id); expect(saved.session.runs[0]).toEqual(before.session.runs[0]); expect(saved.session.runs.at(-1)?.imageIds).toEqual(saved.activeImageIds);
});

for (const layout of ['快速原文（最快）', '整理后的试卷', '已保存内容']) test(`supplemented question downloads a complete PDF in ${layout} without changing saved evidence`, async ({ page }, info) => {
  let calls = 0; const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**', route => { calls++; return route.abort(); });
  await page.route('**/__solveflow/web-env/model/**', route => { calls++; return route.abort(); });
  const source = await seed(page, false, true);
  await page.getByRole('button', { name: '同题材料 / 补图', exact: true }).click();
  await select(page, '从相册补图', 2);
  await page.getByRole('button', { name: '保存补图（2张）', exact: true }).click();
  await expect(page.getByRole('button', { name: '查看材料 3', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回题目', exact: true }).click();
  const before = await readDocument(page, `record.${source.id}`);
  await page.getByRole('button', { name: '批次操作', exact: true }).click();
  await page.getByRole('button', { name: '导出本批 PDF', exact: true }).click();
  await page.getByRole('button', { name: layout, exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 PDF', exact: true }).click();
  const download = await pending; const path = info.outputPath('supplemented.pdf');
  await download.saveAs(path);
  expect((await readFile(path)).subarray(0, 5).toString()).toBe('%PDF-');
  expect(await readDocument(page, `record.${source.id}`)).toBe(before);
  expect(errors).toEqual([]); expect(calls).toBe(0);
});

for (const layout of ['快速原文（最快）', '整理后的试卷', '已保存内容']) test(`supplemented correction downloads a complete PDF in ${layout} after replacing its primary image`, async ({ page }, info) => {
  let calls = 0; let unexpected = 0;
  await page.route('https://**', route => { unexpected++; return route.abort(); });
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    calls++;
    const body: unknown = route.request().postDataJSON();
    const input = lastModelInput(body);
    const verifier = typeof input === 'object' && input !== null && 'role' in input && input.role === 'verifier';
    const checked = ['transcription', 'logic', 'arithmetic', 'diagram'];
    const value = verifier ? { schemaVersion: 1, verdict: 'pass', checked, issues: [], coverage: [{ verdict: 'pass', checked }], evidenceStatus: 'sufficient' } : { schemaVersion: 1, kind: 'answer', problem: { text: 'CORRECTED_SOURCE: x+2=6', subject: 'math', uncertainties: [] }, answer: 'CORRECTED_ANSWER: x=4', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
    await route.fulfill({ contentType: 'text/event-stream', body: modelSse(value, body) });
  });
  const source = await seed(page, true, true);
  await page.getByRole('button', { name: '识别有误？更正题干', exact: true }).click();
  await select(page, '添加图片', 2);
  await page.getByRole('button', { name: '保存补图（2张）', exact: true }).click();
  await page.getByRole('button', { name: '裁剪图片1', exact: true }).click(); await crop(page);
  await page.getByLabel('更正后的题干', { exact: true }).fill('x+2=6');
  await page.getByRole('button', { name: '按更正重新解答', exact: true }).click();
  await expect(page.locator('.final-answer').last()).toContainText('CORRECTED_ANSWER: x=4');
  await expect.poll(async () => StoredLocalRecordSchema.parse(JSON.parse(await readDocument(page, `record.${source.id}`))).session.runs.at(-1)?.status).toBe('completed');
  const before = await readDocument(page, `record.${source.id}`);
  const saved = StoredLocalRecordSchema.parse(JSON.parse(before));
  expect(saved.session.runs.at(-1)?.imageIds).toEqual(saved.activeImageIds);
  expect(saved.activeImageIds?.[0]).not.toBe(source.id);
  await page.getByRole('button', { name: '批次操作', exact: true }).click();
  await page.getByRole('button', { name: '导出本批 PDF', exact: true }).click();
  await page.getByRole('button', { name: layout, exact: true }).click();
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 PDF', exact: true }).click();
  const download = await waiting; const path = info.outputPath('corrected-supplemented.pdf');
  await download.saveAs(path);
  expect((await readFile(path)).subarray(0, 5).toString()).toBe('%PDF-');
  expect(await readDocument(page, `record.${source.id}`)).toBe(before);
  expect(calls).toBe(2); expect(unexpected).toBe(0);
});
