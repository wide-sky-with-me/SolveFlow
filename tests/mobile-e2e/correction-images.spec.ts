import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { StoredLocalRecordSchema, StoredLocalImageSchema } from '../../packages/contracts/src/local.js';
import { configureLocalModel, lastModelInput, modelPass, modelSse } from './local-fixture.js';

test.use({ reducedMotion: 'reduce' });
async function seed(page: Page, batch: boolean) {
  await page.goto('/'); await configureLocalModel(page);
  const ids = { id: randomUUID(), run: randomUUID(), material: randomUUID(), batch: randomUUID() };
  const fixture = await page.evaluate(async ({ ids, batch }) => {
    function image(color: string) { const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 300; const context = canvas.getContext('2d'); if (!context) throw new Error('CANVAS'); context.fillStyle = color; context.fillRect(0, 0, 600, 300); return canvas.toDataURL('image/jpeg'); }
    const main = image('#ffffff'); const extra = image('#cc3344'); const createdAt = new Date().toISOString();
    const candidate = { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
    const record = { schemaVersion: 1, image: main, materials: [{ id: ids.material, image: extra, bytes: atob(extra.split(',')[1]!).length, width: 600, height: 300 }], ...(batch ? { batch: { id: ids.batch, title: 'Synthetic correction batch', createdAt, exam: 'general', position: 1 } } : {}), session: { schemaVersion: 1, id: ids.id, subject: 'math', createdAt, upload: { schemaVersion: 1, id: ids.id, mimeType: 'image/jpeg', bytes: atob(main.split(',')[1]!).length, width: 600, height: 300, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${ids.id}/image` }, runs: [{ schemaVersion: 1, id: ids.run, sessionId: ids.id, status: 'completed', message: '', createdAt, seq: 1, materialIds: [ids.material], outcome: { schemaVersion: 1, status: 'completed', verified: false, verificationStatus: 'not_requested', verification: null, warning: null, candidate } }] } };
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('solveflow-local', 1); request.onsuccess = () => resolve(request.result); request.onerror = reject; });
    try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('documents', 'readwrite'); tx.objectStore('documents').put(JSON.stringify(record), `record.${ids.id}`); tx.oncomplete = () => resolve(); tx.onerror = reject; }); } finally { db.close(); }
    return { main, extra };
  }, { ids, batch });
  await page.goto(`/?session=${ids.id}`);
  await configureLocalModel(page);
  if (batch) {
    await page.getByRole('tab', { name: '历史题目', exact: true }).click();
    await page.getByRole('tab', { name: '批量记录', exact: true }).click();
    await page.getByRole('button', { name: '打开批量', exact: true }).click();
  }
  await expect(page.locator('.final-answer')).toContainText('x=2');
  return { ...ids, ...fixture };
}
async function readDocument(page: Page, key: string) {
  return page.evaluate(async key => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('solveflow-local', 1); request.onsuccess = () => resolve(request.result); request.onerror = reject; });
    try { return await new Promise<string>((resolve, reject) => { const request = db.transaction('documents').objectStore('documents').get(key); request.onsuccess = () => { if (typeof request.result !== 'string') reject(new Error('MISSING_DOCUMENT')); else resolve(request.result); }; request.onerror = reject; }); } finally { db.close(); }
  }, key);
}
async function addImage(page: Page) {
  const buffer = Buffer.from(await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 300; const context = canvas.getContext('2d'); if (!context) throw new Error('CANVAS'); context.fillStyle = '#3366dd'; context.fillRect(0, 0, 600, 300); return canvas.toDataURL('image/jpeg').split(',')[1]!; }), 'base64');
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: '添加图片', exact: true }).click();
  await (await chooser).setFiles({ name: 'synthetic-extra.jpg', mimeType: 'image/jpeg', buffer });
  await page.getByRole('button', { name: '使用这张题图', exact: true }).click();
}
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function images(body: unknown): string[] {
  if (!object(body) || !Array.isArray(body.messages)) throw new Error('INVALID_BODY');
  return body.messages.flatMap((message: unknown) => !object(message) || !Array.isArray(message.content) ? [] : message.content.flatMap((part: unknown) => object(part) && part.type === 'image_url' && object(part.image_url) && typeof part.image_url.url === 'string' ? [part.image_url.url] : []));
}
for (const batch of [false, true]) test(`${batch ? 'batch' : 'single'} correction commits edited pictures and uses the same snapshot for verification and reload`, async ({ page }, info) => {
  const calls: unknown[] = []; const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    const body: unknown = route.request().postDataJSON(); calls.push(body); const input = lastModelInput(body);
    await route.fulfill({ contentType: 'text/event-stream', body: modelSse(object(input) && input.role === 'verifier' ? modelPass : { schemaVersion: 1, kind: 'answer', problem: { text: 'x+2=6', subject: 'math', uncertainties: [] }, answer: 'x=4', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] }, body) });
  });
  const fixture = await seed(page, batch);
  await page.getByRole('button', { name: '识别有误？更正题干', exact: true }).click();
  await expect(page.getByTestId('correction-image')).toHaveCount(2);
  await page.getByRole('button', { name: '删除图片1', exact: true }).click();
  await expect(page.getByRole('button', { name: '删除图片1', exact: true })).toBeDisabled();
  await addImage(page); await expect(page.getByTestId('correction-image')).toHaveCount(2);
  await page.getByLabel('更正后的题干', { exact: true }).fill('x+2=6');
  expect(calls).toHaveLength(0);
  await page.screenshot({ path: info.outputPath('correction-images.png') });
  await page.getByRole('button', { name: '按更正重新解答', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.locator('.final-answer')).toContainText('x=4');
  const saved = StoredLocalRecordSchema.parse(JSON.parse(await readDocument(page, `record.${fixture.id}`)));
  expect(saved.materials).toHaveLength(2); expect(saved.activeImageIds?.[0]).toBe(fixture.material); expect(saved.activeImageIds).not.toContain(fixture.id);
  expect(saved.session.runs[0]?.materialIds).toEqual([fixture.material]);
  const corrected = saved.session.runs.find(run => run.context?.kind === 'correction'); expect(corrected?.imageIds).toEqual(saved.activeImageIds);
  const addedId = saved.activeImageIds![1]!;
  const added = StoredLocalImageSchema.parse(JSON.parse(await readDocument(page, `material.${fixture.id}.${addedId}`))).image;
  expect(images(calls[0])).toEqual([fixture.extra, added]);
  await expect(page.locator('.original-photo-preview img')).toHaveAttribute('src', fixture.extra);
  if (!batch) await page.getByRole('button', { name: '校验', exact: true }).click();
  await expect(page.getByRole('button', { name: '校验通过', exact: true })).toBeVisible();
  expect(calls).toHaveLength(2); expect(images(calls[1])).toEqual([fixture.extra, added]);
  await page.reload(); await expect(page.locator('.final-answer')).toContainText('x=4'); expect(calls).toHaveLength(2);
  await configureLocalModel(page);
  await page.getByRole('button', { name: '识别有误？更正题干', exact: true }).click(); await expect(page.getByTestId('correction-image')).toHaveCount(2);
  await expect(page.getByLabel('更正图片1', { exact: true }).locator('img')).toHaveAttribute('src', fixture.extra);
  expect(errors).toEqual([]);
});
test('cancelling picture additions and removals leaves the stored question and model calls unchanged', async ({ page }) => {
  let calls = 0; await page.route('https://fixture-model.invalid/**', route => { calls++; return route.abort(); });
  const fixture = await seed(page, false); const before = await readDocument(page, `record.${fixture.id}`);
  await page.getByRole('button', { name: '识别有误？更正题干', exact: true }).click(); await expect(page.getByTestId('correction-image')).toHaveCount(2);
  await page.getByRole('button', { name: '删除图片1', exact: true }).click(); await addImage(page);
  await page.getByRole('button', { name: '取消更正', exact: true }).click();
  expect(await readDocument(page, `record.${fixture.id}`)).toBe(before); expect(calls).toBe(0);
  await page.getByRole('button', { name: '识别有误？更正题干', exact: true }).click(); await expect(page.getByTestId('correction-image')).toHaveCount(2);
  await expect(page.getByLabel('更正图片1', { exact: true }).locator('img')).toHaveAttribute('src', fixture.main);
});
