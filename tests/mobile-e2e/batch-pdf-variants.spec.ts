import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { BatchPrintLayoutInputSchema } from '../../packages/contracts/dist/local.js';

const batchId = '93000000-0000-4000-8000-000000000001';
const profile = { provider: 'fixture', baseURL: 'https://pdf-layout.invalid/v1', model: 'layout', api: 'openai-completions', contextWindow: 32768, maxTokens: 8192, maxTokensField: 'max_tokens', streaming: false };
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
async function seed(page: Page, red = false, configured = false, preview = true) {
  if (configured) await page.route('**/__solveflow/web-env', route => route.fulfill({ json: { schemaVersion: 1, settings: { schemaVersion: 1, solver: profile, verifier: null }, accessTokens: { solver: 'synthetic-layout-token', verifier: null, backup: null } } }));
  const response = await page.goto('/'); expect(response?.ok()).toBe(true); await expect(page.getByTestId('launch-screen')).toBeHidden();
  await page.evaluate(({ batchId, red }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('solveflow-local', 1); request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result; const tx = db.transaction('documents', 'readwrite'); const store = tx.objectStore('documents');
      const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 550; const context = canvas.getContext('2d'); if (!context) throw new Error('CANVAS');
      context.fillStyle = '#fff'; context.fillRect(0, 0, 900, 550); context.fillStyle = '#111'; context.font = '28px sans-serif'; context.fillText('Synthetic question', 20, 80); context.fillStyle = '#b51b20'; context.fillRect(480, 180, 250, 250);
      const image = canvas.toDataURL('image/jpeg'); const createdAt = '2026-10-13T03:00:00.000Z';
      for (const position of [2, 1]) {
        const id = `93100000-0000-4000-8000-${String(position).padStart(12, '0')}`; const wrong = red && position === 2;
        const candidate = { schemaVersion: 1, kind: 'answer', problem: { text: `Question ${position}: select two.`, subject: 'math', uncertainties: [], options: [{ label: 'A', text: 'one' }, { label: 'B', text: 'two' }, { label: 'C', text: 'three' }] }, answer: 'Original saved explanation stays in storage.', selectedOptions: ['B'], steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
        const outcome = { schemaVersion: 1, status: 'completed', candidate, verified: false, verification: wrong ? { schemaVersion: 1, verdict: 'fail', checked: ['transcription', 'logic'], issues: [{ code: 'LOGIC', message: 'Synthetic red warning.' }] } : null, ...(wrong ? {} : { verificationStatus: 'not_requested' }), warning: null };
        const session = { schemaVersion: 1, id, subject: 'math', createdAt, upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: 2000, width: 900, height: 550, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` }, runs: [{ schemaVersion: 1, id, sessionId: id, createdAt, seq: 1, status: 'completed', message: '', outcome }] };
        store.put(JSON.stringify({ schemaVersion: 1, session, image, batch: { id: batchId, title: 'PDF variants', createdAt, exam: 'general', position } }), `record.${id}`);
      }
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }), { batchId, red });
  await page.goto('/?session=93100000-0000-4000-8000-000000000001'); await expect(page.getByTestId('current-batch')).toBeVisible();
  await page.getByRole('button', { name: '批次操作', exact: true }).click(); await page.getByRole('button', { name: '导出本批 PDF', exact: true }).click();
  if (preview) { await page.getByText('预览导出内容', { exact: true }).click(); await expect(page.getByTestId('batch-copy-document')).toBeVisible(); }
  await expect(page.getByRole('button', { name: '批量导出', exact: true })).toBeEnabled();
}
async function records(page: Page) { return page.evaluate(() => new Promise<string[]>((resolve, reject) => {
  const request = indexedDB.open('solveflow-local'); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result; const tx = db.transaction('documents'); const read = tx.objectStore('documents').getAll(); tx.oncomplete = () => { db.close(); resolve(read.result.filter((value: unknown): value is string => typeof value === 'string' && value.includes('"session"'))); }; tx.onerror = () => { db.close(); reject(tx.error); }; };
})); }
async function picker(page: Page, label: string, choice: string) { await page.getByRole('button', { name: label, exact: true }).click(); await page.getByRole('option', { name: choice, exact: true }).click(); }
async function textOnly(page: Page) { await page.getByText('图片整理', { exact: true }).click(); for (const index of ['0', '1']) { await picker(page, '当前题目', `第 ${Number(index) + 1} 题`); await page.getByRole('button', { name: '本题仅保留文字', exact: true }).click(); } }
function unzip(bytes: Buffer): Record<string, Uint8Array> {
  const module: unknown = createRequire(new URL('../../apps/mobile/package.json', import.meta.url))('fflate');
  if (!module || typeof module !== 'object' || !('unzipSync' in module) || typeof module.unzipSync !== 'function') throw new Error('ZIP_READER');
  const files: unknown = module.unzipSync(bytes); if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error('ZIP_FILES');
  const result: Record<string, Uint8Array> = {}; for (const [name, value] of Object.entries(files)) { if (!(value instanceof Uint8Array)) throw new Error('ZIP_ENTRY'); result[name] = value; } return result;
}
test('text-only export omits pictures and explanations, produces a real named PDF and preserves saved answers', async ({ page }, info) => {
  await seed(page); const before = await records(page); await textOnly(page);
  const doc = page.getByTestId('batch-copy-document'); await expect(doc.locator('img')).toHaveCount(0); await expect(doc.getByTestId('copy-question')).toHaveCount(2); await expect(doc).not.toContainText('Original saved explanation');
  const waiting = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF', exact: true }).click(); const download = await waiting;
  expect(download.suggestedFilename()).toBe('PDF variants_总2_对2_错0.pdf'); const destination = info.outputPath('text-only.pdf'); await download.saveAs(destination); expect((await readFile(destination)).subarray(0, 5).toString()).toBe('%PDF-');
  expect(await records(page)).toEqual(before); await expect(page.locator('iframe[title="批次 PDF 打印"]')).toHaveCount(0);
});
test('history batch actions open a compact themed PDF dialog without navigating away or expanding advanced fields', async ({ page }, info) => {
  await seed(page); await page.getByRole('button', { name: '关闭导出', exact: true }).click(); const before = await records(page);
  await page.getByRole('tab', { name: '历史题目', exact: true }).click(); await page.getByRole('tab', { name: '批量记录', exact: true }).click();
  await page.getByRole('button', { name: '批次操作：PDF variants', exact: true }).click(); await page.getByRole('button', { name: '导出 PDF', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导出 PDF', exact: true }); await expect(dialog).toBeVisible();
  await expect(page.getByLabel('导出内容')).toBeVisible(); await expect(page.getByTestId('batch-copy-document')).toBeHidden(); await expect(page.getByLabel('导出题图旋转角度')).toBeHidden();
  const bounds = await dialog.boundingBox(); if (!bounds) throw new Error('DIALOG_BOUNDS'); const viewport = page.viewportSize(); if (!viewport) throw new Error('VIEWPORT');
  expect(bounds.width).toBeLessThanOrEqual(760); expect(bounds.x).toBeGreaterThan(0); expect(bounds.y).toBeGreaterThan(0); expect(bounds.height).toBeLessThan(viewport.height - 15);
  await expect(page.getByRole('button', { name: '下载 PDF', exact: true })).toBeInViewport({ ratio: 1 });
  const waiting = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF', exact: true }).click(); const downloaded = await waiting; const file = info.outputPath('history-entry.pdf'); await downloaded.saveAs(file); expect((await readFile(file)).subarray(0, 5).toString()).toBe('%PDF-'); await expect(page.getByRole('button', { name: '批量导出', exact: true })).toBeEnabled();
  for (const size of [{ width: 320, height: 844 }, { width: 740, height: 390 }]) { await page.setViewportSize(size); expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true); await expect(page.getByRole('button', { name: '下载 PDF', exact: true })).toBeInViewport({ ratio: 1 }); }
  await page.emulateMedia({ colorScheme: 'dark' }); await expect.poll(async () => page.getByLabel('导出内容').evaluate(node => getComputedStyle(node).colorScheme)).toBe('dark'); await page.setViewportSize(info.project.name === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 1000 }); await page.screenshot({ path: info.outputPath('pdf-export-dialog-dark.png') });
  await page.getByRole('button', { name: '批量导出', exact: true }).click(); await expect(page.getByRole('dialog', { name: '批量导出设置', exact: true })).toBeVisible(); await page.getByRole('button', { name: '取消设置', exact: true }).click();
  await page.getByRole('button', { name: '关闭导出', exact: true }).click(); await expect(page.getByRole('tab', { name: '历史题目', exact: true })).toHaveAttribute('aria-selected', 'true'); expect(await records(page)).toEqual(before);
});
test('ten copies use their requested answer counts, cancel settings safely, and download ten distinct named PDF entries', async ({ page }, info) => {
  await seed(page); const before = await records(page); await textOnly(page);
  await page.getByRole('button', { name: '批量导出', exact: true }).click(); await page.getByLabel('导出份数').fill('3'); await page.getByRole('button', { name: '取消设置', exact: true }).click(); await expect(page.getByRole('button', { name: '当前副本', exact: true })).toHaveCount(0); await expect(page.locator('.pdf-single-copy')).toHaveText('第 1 份对 2 题 / 错 0 题');
  await page.getByRole('button', { name: '批量导出', exact: true }).click(); await page.getByLabel('导出份数').fill('10');
  for (let index = 0; index < 10; index++) await page.getByLabel(`第${index + 1}份答错题数`).fill(String(index % 3));
  await page.getByRole('button', { name: '应用导出设置', exact: true }).click(); await page.getByRole('button', { name: '当前副本', exact: true }).click(); await expect(page.getByRole('option')).toHaveCount(10); await page.keyboard.press('Escape');
  for (let index = 0; index < 10; index++) { await picker(page, '当前副本', `第 ${index + 1} 份 · 对 ${2 - index % 3} / 错 ${index % 3}`); await expect(page.getByTestId('batch-copy-document').locator('[data-adjusted="true"]')).toHaveCount(index % 3); }
  const waiting = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF 压缩包', exact: true }).click(); const download = await waiting;
  const destination = info.outputPath('ten-copies.zip'); await download.saveAs(destination); const files = unzip(await readFile(destination)); expect(Object.keys(files)).toHaveLength(10);
  for (let index = 0; index < 10; index++) { const filename = `PDF variants_总2_对${2 - index % 3}_错${index % 3}_${String(index + 1).padStart(2, '0')}.pdf`; expect(Buffer.from(files[filename] ?? []).subarray(0, 5).toString()).toBe('%PDF-'); }
  expect(await records(page)).toEqual(before); await expect(page.locator('iframe[title="批次 PDF 打印"]')).toHaveCount(0);
});
test('an original red warning counts as wrong and correcting it requires a reference that changes the exported choice', async ({ page }) => {
  await seed(page, true); const before = await records(page); await expect(page.getByTestId('batch-copy-document')).toContainText('对 1 题 · 错 1 题');
  await page.getByRole('button', { name: '批量导出', exact: true }).click(); await page.getByLabel('第1份答错题数').fill('0'); await expect(page.getByRole('button', { name: '应用导出设置', exact: true })).toBeDisabled();
  await page.getByText('逐题参照答案与错误作答', { exact: true }).click(); await page.getByLabel('第2题参照答案').fill('A'); await page.getByRole('button', { name: '应用导出设置', exact: true }).click();
  await expect(page.getByTestId('batch-copy-document')).toContainText('对 2 题 · 错 0 题'); await expect(page.getByTestId('copy-answer').nth(1)).toContainText('A'); expect(await records(page)).toEqual(before);
});
test('cancelling resource preparation produces no partial download and releases the print frame', async ({ page }) => {
  await seed(page); const before = await records(page); await textOnly(page); let downloads = 0; page.on('download', () => { downloads++; });
  let release = () => {}; let stalled = 0; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/_expo/static/css/**', async route => { stalled++; await gate; await route.abort().catch(() => undefined); });
  try {
    await page.getByRole('button', { name: '下载 PDF', exact: true }).click(); await expect.poll(() => stalled).toBeGreaterThan(0);
    await page.getByRole('button', { name: '取消导出', exact: true }).click(); await expect(page.getByText('导出已取消。', { exact: true })).toBeVisible(); await expect(page.locator('iframe[title="批次 PDF 打印"]')).toHaveCount(0);
    expect(downloads).toBe(0); expect(await records(page)).toEqual(before);
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }); }
});
test('the layout agent removes text screenshots and crops diagrams into their question and option positions', async ({ page }) => {
  let calls = 0;
  await page.route('**/__solveflow/web-env/model/solver', async route => {
    calls++;
    const body: unknown = route.request().postDataJSON(); if (!object(body) || !Array.isArray(body.messages)) throw new Error('LAYOUT_MESSAGES');
    const last: unknown = body.messages.at(-1); if (!object(last) || !Array.isArray(last.content)) throw new Error('LAYOUT_CONTENT');
    const part: unknown = last.content.find((value: unknown) => object(value) && value.type === 'text'); if (!object(part) || typeof part.text !== 'string') throw new Error('LAYOUT_PROMPT');
    const raw: unknown = JSON.parse(part.text); if (!object(raw) || !Array.isArray(raw.sourceOrder)) throw new Error('LAYOUT_INPUT');
    const input = BatchPrintLayoutInputSchema.parse({ questions: raw.questions, sources: raw.sourceOrder.map((id: unknown) => ({ id, image: 'data:image/jpeg;base64,AQID' })) });
    const result = { schemaVersion: 1, questions: input.questions.map(question => ({ ...question, confidence: 1, warnings: [], sources: input.sources.map(({ id }) => ({ id, kind: calls === 1 ? 'text-only' : 'illustrations', rotation: calls === 1 ? 0 : 5, regions: calls === 1 ? [] : [{ id: 'body', alt: 'Synthetic body chart', role: 'question', x: .53, y: .33, width: .28, height: .45 }, { id: 'choice', alt: 'Synthetic choice chart', role: 'option', optionLabel: 'A', x: .53, y: .33, width: .28, height: .45 }] })) })) };
    await route.fulfill({ json: { id: 'fixture', object: 'chat.completion', created: 1, model: 'layout', choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(result) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } } });
  });
  await seed(page, false, true); const before = await records(page); await expect(page.getByText(/Agent 已整理 2 题/)).toBeVisible();
  const questions = page.getByTestId('copy-question'); await expect(questions.nth(0).locator('img')).toHaveCount(0); await expect(questions.nth(1).locator('img')).toHaveCount(2); await expect(questions.nth(1).locator('.print-copy-options li').nth(0).locator('img')).toHaveCount(1);
  const dimensions = await questions.nth(1).getByAltText('Synthetic choice chart').evaluate(image => image instanceof HTMLImageElement ? [image.naturalWidth, image.naturalHeight] : []); expect(dimensions[0]).toBeLessThan(500); expect(dimensions[1]).toBeLessThan(400); expect(calls).toBe(2); expect(await records(page)).toEqual(before);
});

async function layoutFixture(page: Page, beforeResponse: (call: number) => Promise<void> = async () => {}) {
  let calls = 0;
  await page.route('**/__solveflow/web-env/model/solver', async route => {
    const call = ++calls; const body: unknown = route.request().postDataJSON();
    if (!object(body) || !Array.isArray(body.messages)) throw new Error('LAYOUT_MESSAGES');
    const last: unknown = body.messages.at(-1); if (!object(last) || !Array.isArray(last.content)) throw new Error('LAYOUT_CONTENT');
    const part: unknown = last.content.find((value: unknown) => object(value) && value.type === 'text'); if (!object(part) || typeof part.text !== 'string') throw new Error('LAYOUT_PROMPT');
    const raw: unknown = JSON.parse(part.text); if (!object(raw) || !Array.isArray(raw.sourceOrder)) throw new Error('LAYOUT_INPUT');
    const input = BatchPrintLayoutInputSchema.parse({ questions: raw.questions, sources: raw.sourceOrder.map((id: unknown) => ({ id, image: 'data:image/jpeg;base64,AQID' })) });
    const result = { schemaVersion: 1, questions: input.questions.map(question => ({ ...question, confidence: 1, warnings: [], sources: input.sources.map(({ id }) => ({ id, kind: question.problem.text.includes('Question 1:') ? 'text-only' : 'illustrations', rotation: 0, regions: question.problem.text.includes('Question 1:') ? [] : [{ id: 'chart', alt: 'Necessary synthetic chart', role: 'question', x: .53, y: .33, width: .28, height: .45 }] })) })) };
    await beforeResponse(call);
    await route.fulfill({ json: { id: 'fixture', object: 'chat.completion', created: 1, model: 'layout', choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(result) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } } }).catch(() => undefined);
  });
  return () => calls;
}
async function reopen(page: Page) {
  await page.getByRole('button', { name: '批次操作', exact: true }).click(); await page.getByRole('button', { name: '导出本批 PDF', exact: true }).click(); await expect(page.getByRole('button', { name: '批量导出', exact: true })).toBeEnabled();
}
test('opening performs no canvas work or model calls, first preview uses the agent, and reload plus download reuses the persistent crops', async ({ page }, info) => {
  const calls = await layoutFixture(page); await seed(page, false, true, false); const before = await records(page);
  await page.getByRole('button', { name: '关闭导出', exact: true }).click();
  await page.evaluate(() => { const original = CanvasRenderingContext2D.prototype.drawImage; document.documentElement.dataset.exportCanvasCalls = '0'; CanvasRenderingContext2D.prototype.drawImage = new Proxy(original, { apply(target, context, args) { document.documentElement.dataset.exportCanvasCalls = String(Number(document.documentElement.dataset.exportCanvasCalls) + 1); return Reflect.apply(target, context, args); } }); });
  await reopen(page); expect(calls()).toBe(0); await expect(page.locator('html')).toHaveAttribute('data-export-canvas-calls', '0'); await expect(page.getByTestId('copy-question')).toHaveCount(0);
  await page.emulateMedia({ colorScheme: 'dark' }); await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => undefined))); }); await page.screenshot({ path: info.outputPath('unified-export-dialog.png') });
  await page.getByText('预览导出内容', { exact: true }).click(); await expect(page.getByTestId('batch-copy-document')).toBeVisible(); expect(calls()).toBe(2);
  await expect(page.getByTestId('copy-question').nth(0).locator('img')).toHaveCount(0); await expect(page.getByTestId('copy-question').nth(1).locator('img')).toHaveCount(1);
  const image = await page.getByAltText('Necessary synthetic chart', { exact: true }).getAttribute('src');
  await page.getByRole('button', { name: '关闭导出', exact: true }).click(); await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible(); await reopen(page); expect(calls()).toBe(2);
  const waiting = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF', exact: true }).click(); const download = await waiting; await download.saveAs(info.outputPath('cached-crops.pdf')); expect((await readFile(info.outputPath('cached-crops.pdf'))).subarray(0, 5).toString()).toBe('%PDF-');
  expect(calls()).toBe(2); expect(await page.getByAltText('Necessary synthetic chart', { exact: true }).getAttribute('src')).toBe(image); expect(await records(page)).toEqual(before);
});
test('cancelled preparation keeps completed cache entries and resumes only the missing record after reload', async ({ page }) => {
  let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; }); const calls = await layoutFixture(page, async call => { if (call === 2) await gate; });
  await seed(page, false, true, false); const before = await records(page); let downloads = 0; page.on('download', () => { downloads++; });
  try {
    await page.getByRole('button', { name: '下载 PDF', exact: true }).click(); await expect.poll(calls).toBe(2); await page.getByRole('button', { name: '取消导出', exact: true }).click(); await expect(page.getByText(/导出识别已取消|导出已取消/)).toBeVisible(); expect(downloads).toBe(0);
    release(); await page.getByRole('button', { name: '关闭导出', exact: true }).click(); await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible(); await reopen(page); expect(calls()).toBe(2);
    await page.getByText('预览导出内容', { exact: true }).click(); await expect(page.getByTestId('batch-copy-document')).toBeVisible(); expect(calls()).toBe(3); await expect(page.getByTestId('copy-question').nth(1).locator('img')).toHaveCount(1); expect(await records(page)).toEqual(before);
  } finally { release(); }
});
test('changing source image bytes invalidates only that record while the picker supports keyboard selection and Escape', async ({ page }) => {
  const calls = await layoutFixture(page); await seed(page, false, true); expect(calls()).toBe(2); await page.getByText('图片整理', { exact: true }).click();
  const pickerButton = page.getByRole('button', { name: '当前题目', exact: true }); await pickerButton.focus(); await page.keyboard.press('ArrowDown'); await expect(page.getByRole('listbox', { name: '当前题目', exact: true })).toBeVisible(); await page.keyboard.press('End'); await page.keyboard.press('Enter'); await expect(pickerButton).toHaveText('第 2 题'); await pickerButton.click(); await page.keyboard.press('Escape'); await expect(pickerButton).toBeFocused(); await expect(page.getByRole('listbox')).toHaveCount(0);
  await page.getByRole('button', { name: '关闭导出', exact: true }).click();
  await page.evaluate(() => new Promise<void>((resolve, reject) => { const request = indexedDB.open('solveflow-local'); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result; const tx = db.transaction('documents', 'readwrite'); const store = tx.objectStore('documents'); const key = 'record.93100000-0000-4000-8000-000000000002'; const read = store.get(key); read.onsuccess = () => { if (typeof read.result !== 'string') throw new Error('RECORD'); const value: unknown = JSON.parse(read.result); if (!value || typeof value !== 'object' || !('image' in value)) throw new Error('RECORD'); const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 550; const context = canvas.getContext('2d'); if (!context) throw new Error('CANVAS'); context.fillStyle = '#fff'; context.fillRect(0, 0, 900, 550); context.fillStyle = '#333'; context.fillRect(480, 180, 250, 250); value.image = canvas.toDataURL('image/jpeg'); store.put(JSON.stringify(value), key); }; tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); }; }; }));
  const changed = await records(page); await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible(); await reopen(page); expect(calls()).toBe(2); await page.getByText('预览导出内容', { exact: true }).click(); await expect(page.getByTestId('batch-copy-document')).toBeVisible(); expect(calls()).toBe(3); expect(await records(page)).toEqual(changed);
});

test('unavailable persistent cache still preserves completed agent work during cancellation and reports the limitation', async ({ page }, info) => {
  let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; }); const calls = await layoutFixture(page, async call => { if (call === 2) await gate; });
  await seed(page, false, true, false); const before = await records(page);
  await page.evaluate(() => { indexedDB.open = new Proxy(indexedDB.open, { apply(target, context, args) { if (args[0] === 'solveflow-print-cache') throw new DOMException('Synthetic cache unavailable', 'QuotaExceededError'); return Reflect.apply(target, context, args); } }); });
  try {
    await page.getByRole('button', { name: '下载 PDF', exact: true }).click(); await expect.poll(calls).toBe(2); await page.getByRole('button', { name: '取消导出', exact: true }).click(); await expect(page.getByText('导出已取消。', { exact: true })).toBeVisible(); release();
    await page.getByText('预览导出内容', { exact: true }).click(); await expect(page.getByTestId('batch-copy-document')).toBeVisible(); expect(calls()).toBe(3); await expect(page.getByText(/整理结果未能缓存/)).toBeVisible();
    const waiting = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF', exact: true }).click(); const download = await waiting; await download.saveAs(info.outputPath('uncached.pdf')); expect((await readFile(info.outputPath('uncached.pdf'))).subarray(0, 5).toString()).toBe('%PDF-'); expect(calls()).toBe(3); await expect(page.getByText(/已生成 1 份.*整理结果未能缓存/)).toBeVisible(); expect(await records(page)).toEqual(before);
  } finally { release(); }
});

test('question-only mode hides all answer data, preserves diagrams and answer copy settings, and prints and downloads the selected content', async ({ page }, info) => {
  await page.addInitScript(() => new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) if (node instanceof HTMLIFrameElement && node.title === '批次 PDF 打印' && node.contentWindow && node.contentDocument) {
      const doc = node.contentDocument; const content = doc.querySelector('[data-pdf-content]');
      document.documentElement.dataset.clonedPdfMode = content?.getAttribute('data-pdf-content') ?? '';
      document.documentElement.dataset.clonedPdfAnswers = String(doc.querySelectorAll('[data-testid="copy-answer"]').length);
      document.documentElement.dataset.clonedPdfText = doc.body.textContent ?? '';
      node.contentWindow.print = () => { document.documentElement.dataset.questionPdfPrinted = 'true'; node.contentWindow?.dispatchEvent(new Event('afterprint')); };
    }
  }).observe(document, { childList: true, subtree: true }));
  const calls = await layoutFixture(page); await seed(page, false, true); const before = await records(page);
  await page.getByRole('button', { name: '批量导出', exact: true }).click(); await page.getByLabel('导出份数').fill('2'); await page.getByLabel('第1份答错题数').fill('1'); await page.getByLabel('第2份答错题数').fill('2'); await page.getByRole('button', { name: '应用导出设置', exact: true }).click();
  await page.getByRole('button', { name: '纯题目', exact: true }).click(); const doc = page.getByTestId('batch-copy-document');
  await expect(doc).toHaveAttribute('data-pdf-content', 'questions'); await expect(doc.getByTestId('copy-question')).toHaveCount(2); await expect(doc.getByTestId('copy-answer')).toHaveCount(0); await expect(doc.locator('[data-adjusted]')).toHaveCount(0); await expect(doc.locator('.print-copy-options li')).toHaveCount(6); await expect(doc.getByAltText('Necessary synthetic chart')).toHaveCount(1);
  await expect(doc).not.toContainText('作答'); await expect(doc).not.toContainText('Original saved explanation'); await expect(doc).not.toContainText(/对 \d+ 题|错 \d+ 题/); await expect(page.getByRole('button', { name: '批量导出', exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: '当前副本', exact: true })).toHaveCount(0); expect(calls()).toBe(2);
  await page.getByRole('button', { name: '打印 / 保存 PDF', exact: true }).click(); await expect(page.locator('html')).toHaveAttribute('data-question-pdf-printed', 'true'); await expect(page.locator('html')).toHaveAttribute('data-cloned-pdf-mode', 'questions'); await expect(page.locator('html')).toHaveAttribute('data-cloned-pdf-answers', '0');
  const waiting = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF', exact: true }).click(); const download = await waiting; expect(download.suggestedFilename()).toBe('PDF variants_总2_纯题目.pdf'); await download.saveAs(info.outputPath('question-only.pdf')); expect((await readFile(info.outputPath('question-only.pdf'))).subarray(0, 5).toString()).toBe('%PDF-'); await expect(page.locator('html')).toHaveAttribute('data-cloned-pdf-mode', 'questions'); await expect(page.locator('html')).toHaveAttribute('data-cloned-pdf-answers', '0'); expect(await page.locator('html').getAttribute('data-cloned-pdf-text')).not.toContain('Original saved explanation'); expect(calls()).toBe(2);
  await page.getByRole('button', { name: '题目与作答', exact: true }).click(); await expect(doc).toHaveAttribute('data-pdf-content', 'answers'); await expect(doc.getByTestId('copy-answer')).toHaveCount(2); await expect(doc.locator('[data-adjusted="true"]')).toHaveCount(1); await expect(page.getByRole('button', { name: '下载 PDF 压缩包', exact: true })).toBeVisible(); expect(await records(page)).toEqual(before);
});
test('question-only download with preview collapsed runs the agent once and respects dark narrow layouts', async ({ page }, info) => {
  const calls = await layoutFixture(page); await seed(page, true, true, false); const before = await records(page); await page.getByRole('button', { name: '纯题目', exact: true }).click(); expect(calls()).toBe(0); await expect(page.getByTestId('copy-question')).toHaveCount(0);
  await page.emulateMedia({ colorScheme: 'dark' }); const dialog = page.getByRole('dialog', { name: '导出 PDF', exact: true });
  for (const size of [{ width: 320, height: 844 }, { width: 740, height: 390 }]) { await page.setViewportSize(size); expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true); await expect(page.getByRole('button', { name: '下载 PDF', exact: true })).toBeInViewport({ ratio: 1 }); }
  await page.setViewportSize(info.project.name === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 1000 }); await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => undefined))); }); await page.screenshot({ path: info.outputPath('question-only-dialog.png') });
  const waiting = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF', exact: true }).click(); const download = await waiting; expect(download.suggestedFilename()).toBe('PDF variants_总2_纯题目.pdf'); await download.saveAs(info.outputPath('collapsed-question-only.pdf')); expect((await readFile(info.outputPath('collapsed-question-only.pdf'))).subarray(0, 5).toString()).toBe('%PDF-'); expect(calls()).toBe(2); await expect(page.getByTestId('batch-copy-document')).toHaveAttribute('data-pdf-content', 'questions'); await expect(page.getByTestId('copy-answer')).toHaveCount(0); expect(await records(page)).toEqual(before);
});
