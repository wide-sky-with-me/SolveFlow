import { expect, test, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { inflateSync } from 'node:zlib';
import { BatchPrintLayoutInputSchema, LocalRecordSchema } from '../../packages/contracts/dist/local.js';

const batchId = '93000000-0000-4000-8000-000000000001';
const profile = { provider: 'fixture', baseURL: 'https://pdf-layout.invalid/v1', model: 'layout', api: 'openai-completions', contextWindow: 32768, maxTokens: 8192, maxTokensField: 'max_tokens', streaming: false };
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
test.beforeEach(async ({ context }) => { await context.route('**/__solveflow/web-env/model/**', route => route.abort()); });
async function seed(page: Page, red = false, configured = false, preview = true) {
  await page.route('**/__solveflow/web-env', route => route.fulfill({ json: { schemaVersion: 1, settings: configured ? { schemaVersion: 1, solver: profile, verifier: null } : null, accessTokens: { solver: configured ? 'synthetic-layout-token' : null, verifier: null, backup: null } } }));
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
  await page.getByRole('button', { name: configured ? '严格试卷版' : '已保存内容', exact: true }).click();
  if (preview) { await page.getByText('预览导出内容', { exact: true }).click(); await expect(page.getByTestId('batch-copy-document')).toBeVisible(); }
  await expect(page.getByLabel('导出份数', { exact: true })).toBeEnabled(); await expect(page.getByRole('dialog')).toHaveCount(1);
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

async function quickProbe(page: Page) {
  await page.evaluate(() => {
    const probe = { scans: 0, frames: 0, lines: [] as string[], yellow: 0 }; Object.defineProperty(window, '__quickPdfProbe', { value: probe, configurable: true });
    const scan = CanvasRenderingContext2D.prototype.getImageData, text = CanvasRenderingContext2D.prototype.fillText, rect = CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.getImageData = function(...args) { probe.scans++; return Reflect.apply(scan, this, args); };
    CanvasRenderingContext2D.prototype.fillText = function(value, ...args) { probe.lines.push(value); return Reflect.apply(text, this, [value, ...args]); };
    CanvasRenderingContext2D.prototype.fillRect = function(...args) { if (this.fillStyle === '#ffeb70') probe.yellow++; return Reflect.apply(rect, this, args); };
    new MutationObserver(records => { for (const record of records) for (const node of record.addedNodes) if (node instanceof HTMLIFrameElement) probe.frames++; }).observe(document.body, { childList: true, subtree: true });
  });
}

function pdfStreams(bytes: Buffer): string {
  const source = bytes.toString('latin1'); const streams: string[] = [];
  for (const match of source.matchAll(/\bstream\r?\n/g)) {
    const start = match.index + match[0].length; const end = source.indexOf('\nendstream', start); if (end < 0) continue;
    try { const decoded = inflateSync(bytes.subarray(start, end)).toString('latin1'); if (/\bBT\s/.test(decoded) && /\bET\b/.test(decoded)) streams.push(decoded); } catch { /* JPEG streams use their own decoder. */ }
  }
  return streams.join('\n');
}
function yellowPdfRects(bytes: Buffer): number {
  let yellow = false, count = 0;
  for (const token of pdfStreams(bytes).matchAll(/([-\d.]+) ([-\d.]+) ([-\d.]+) rg|re\s*f\b/g)) {
    if (token[1] !== undefined) yellow = Math.abs(Number(token[1]) - 1) < .005 && Math.abs(Number(token[2]) - 235 / 255) < .005 && Math.abs(Number(token[3]) - 112 / 255) < .005;
    else if (yellow) count++;
  }
  return count;
}

for (const mode of ['answers', 'questions'] as const) test(`optional export order reorders ${mode} without changing batch records or copy settings`, async ({ page }, info) => {
  await seed(page, false, false, false); const before = await records(page);
  await page.getByRole('button', { name: '快速原文（最快）', exact: true }).click();
  if (mode === 'answers') { await page.getByLabel('导出份数', { exact: true }).fill('2'); await page.getByLabel('第1份答错题数', { exact: true }).fill('1'); await page.getByLabel('第1份备注', { exact: true }).fill('Reordered'); }
  else await page.getByRole('button', { name: '纯题目', exact: true }).click();
  await page.getByText('调整导出顺序（可选）', { exact: true }).click(); await page.getByRole('button', { name: '自定义顺序', exact: true }).click();
  await picker(page, '移动的题图', '当前第 2 张 · 原第 2 张'); await page.getByLabel('导出题图目标位置', { exact: true }).fill('1'); await page.getByRole('button', { name: '移动题图', exact: true }).click();
  await expect(page.getByRole('list', { name: '导出题图顺序', exact: true }).locator('li')).toHaveText(['原第 2 张题图', '原第 1 张题图']);
  if (mode === 'answers') { await expect(page.getByLabel('导出份数', { exact: true })).toHaveValue('2'); await expect(page.getByLabel('第1份答错题数', { exact: true })).toHaveValue('1'); await expect(page.getByLabel('第1份备注', { exact: true })).toHaveValue('Reordered'); }
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: mode === 'answers' ? '下载 PDF 压缩包' : '下载 PDF', exact: true }).click(); const file = info.outputPath(`reordered-${mode}.${mode === 'answers' ? 'zip' : 'pdf'}`); await (await download).saveAs(file);
  const data = await readFile(file); const pdfs = mode === 'answers' ? Object.values(unzip(data)).map(value => Buffer.from(value)) : [data];
  for (const pdf of pdfs) { const text = pdfStreams(pdf); expect(text.indexOf('Question 2: select two.')).toBeGreaterThanOrEqual(0); expect(text.indexOf('Question 2: select two.')).toBeLessThan(text.indexOf('Question 1: select two.')); expect(pdf.toString('latin1')).toContain('/Type /Outlines'); }
  expect(await records(page)).toEqual(before);
  await page.getByRole('button', { name: '按批次顺序', exact: true }).click(); await page.getByRole('button', { name: '关闭导出', exact: true }).click();
});

for (const mode of ['questions', 'reading'] as const) test(`optional export order also applies to saved ${mode} previews`, async ({ page }, info) => {
  await seed(page, false, false, false); const before = await records(page);
  if (mode === 'questions') { await textOnly(page); await page.getByRole('button', { name: '纯题目', exact: true }).click(); }
  else await page.getByRole('button', { name: '原始记录', exact: true }).click();
  await page.getByText('调整导出顺序（可选）', { exact: true }).click(); await page.getByRole('button', { name: '自定义顺序', exact: true }).click();
  await picker(page, '移动的题图', '当前第 2 张 · 原第 2 张'); await page.getByLabel('导出题图目标位置', { exact: true }).fill('1'); await page.getByRole('button', { name: '移动题图', exact: true }).click();
  await page.getByText('预览导出内容', { exact: true }).click();
  const preview = page.getByTestId(mode === 'questions' ? 'batch-copy-document' : 'batch-print-document'); await expect(preview).toBeVisible();
  const text = await preview.innerText(); expect(text.indexOf('Question 2: select two.')).toBeGreaterThanOrEqual(0); expect(text.indexOf('Question 2: select two.')).toBeLessThan(text.indexOf('Question 1: select two.'));
  if (mode === 'questions') { const download = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF', exact: true }).click(); const path = info.outputPath('reordered-saved-questions.pdf'); await (await download).saveAs(path); expect((await readFile(path)).subarray(0, 5).toString()).toBe('%PDF-'); }
  expect(await records(page)).toEqual(before);
});

test('quick parsed multi-copy PDF keeps real English text and reuses source processing across copies', async ({ page }, info) => {
  await seed(page, false, false, false); const before = await records(page);
  await page.evaluate(() => {
    const probe = { imageLoads: 0 }; Object.defineProperty(window, '__directReuseProbe', { value: probe });
    const source = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src'); if (!source?.set) throw new Error('IMAGE_SOURCE');
    Object.defineProperty(HTMLImageElement.prototype, 'src', { ...source, set(value: string) { if (value.startsWith('data:image/')) probe.imageLoads++; source.set!.call(this, value); } });
  });
  await page.getByRole('button', { name: '快速原文（最快）', exact: true }).click(); await page.getByLabel('导出份数').fill('10');
  for (let index = 0; index < 10; index++) await page.getByLabel(`第${index + 1}份答错题数`).fill(String(index % 3));
  const waiting = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF 压缩包', exact: true }).click(); const file = info.outputPath('reused-direct-ten.zip'); await (await waiting).saveAs(file);
  const files = unzip(await readFile(file)); expect(Object.keys(files)).toHaveLength(10);
  for (const [name, entry] of Object.entries(files)) {
    const data = Buffer.from(entry); const text = pdfStreams(data);
    expect(text).toContain('Question 1: select two.'); expect(text).toContain('Question 2: select two.');
    if (name.includes('_错0')) expect(text).toContain('Original saved explanation stays in storage.');
    if (name.includes('_错2')) expect(text).not.toContain('Original saved explanation stays in storage.');
    expect(data.toString('latin1')).toContain('/Type /Outlines'); expect(data.toString('latin1')).toContain('/Subtype /Link'); expect(data.byteLength).toBeLessThan(250000);
  }
  const probe: unknown = await page.evaluate(() => Reflect.get(window, '__directReuseProbe')); expect(probe).toMatchObject({ imageLoads: expect.any(Number) });
  if (!object(probe) || typeof probe.imageLoads !== 'number') throw new Error('REUSE_PROBE'); expect(probe.imageLoads).toBeLessThanOrEqual(8);
  expect(await records(page)).toEqual(before);
});

test('quick parsed long source retains all English paragraphs and browser glyphs across continuation pages', async ({ page }, info) => {
  await seed(page, false, false, false); await page.getByRole('button', { name: '关闭导出', exact: true }).click();
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('solveflow-local'); request.onerror = () => reject(request.error); request.onsuccess = () => {
      const db = request.result, tx = db.transaction('documents', 'readwrite'), store = tx.objectStore('documents'), key = 'record.93100000-0000-4000-8000-000000000001', read = store.get(key);
      read.onsuccess = () => {
        const value: unknown = typeof read.result === 'string' ? JSON.parse(read.result) : null;
        if (!value || typeof value !== 'object' || !('session' in value) || !value.session || typeof value.session !== 'object' || !('runs' in value.session) || !Array.isArray(value.session.runs)) { tx.abort(); return; }
        const run: unknown = value.session.runs[0];
        if (!run || typeof run !== 'object' || !('outcome' in run) || !run.outcome || typeof run.outcome !== 'object' || !('candidate' in run.outcome) || !run.outcome.candidate || typeof run.outcome.candidate !== 'object' || !('problem' in run.outcome.candidate) || !run.outcome.candidate.problem || typeof run.outcome.candidate.problem !== 'object') { tx.abort(); return; }
        Object.assign(run.outcome.candidate.problem, { text: Array.from({ length: 90 }, (_, index) => `English source paragraph ${String(index + 1).padStart(3, '0')}: keep every word, number and punctuation.`).join('\n') + '\n中文原文 α = 2, café, “quoted”, 😀\nSOURCE_END_CANARY' });
        store.put(JSON.stringify(value), key);
      };
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? new Error('LONG_SOURCE_FIXTURE')); };
    };
  }));
  await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible(); await page.getByRole('button', { name: '批次操作', exact: true }).click(); await page.getByRole('button', { name: '导出本批 PDF', exact: true }).click(); await quickProbe(page);
  await page.getByRole('button', { name: '快速原文（最快）', exact: true }).click();
  const waiting = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF', exact: true }).click(); const file = info.outputPath('quick-long-unicode.pdf'); await (await waiting).saveAs(file);
  const bytes = await readFile(file), text = pdfStreams(bytes);
  for (let index = 0; index < 90; index++) expect(text).toContain(`English source paragraph ${String(index + 1).padStart(3, '0')}:`);
  expect(text).toContain('SOURCE_END_CANARY'); expect(bytes.toString('latin1')).toContain('/Type /Outlines');
  const probe: unknown = await page.evaluate(() => Reflect.get(window, '__quickPdfProbe')); expect(JSON.stringify(probe)).toContain('中文原文 α = 2, café, “quoted”, 😀'); expect(yellowPdfRects(bytes)).toBe(4);
});

test('quick parsed export downloads answers and pure questions without preparation, image scans or HTML frames', async ({ page }, info) => {
  await seed(page, false, false, false); const before = await records(page); await quickProbe(page);
  await page.getByRole('button', { name: '快速原文（最快）', exact: true }).click();
  await expect(page.getByText('图片整理', { exact: true })).toHaveCount(0);
  await page.getByText('预览导出内容', { exact: true }).click();
  await expect(page.getByTestId('direct-print-document')).toContainText('Original saved explanation');
  await expect(page.getByTestId('direct-print-document').locator('img')).toHaveCount(2);
  const answerTable = page.getByRole('region', { name: '答案表', exact: true });
  await expect(answerTable.locator('table')).toHaveCount(1); await expect(answerTable.locator('tbody tr')).toHaveCount(1);
  await expect(answerTable.locator('tbody th')).toHaveText('1–2'); await expect(answerTable.locator('a')).toHaveCount(2); await expect(answerTable.locator('mark')).toHaveText(['2', '2']);
  await expect(page.getByTestId('direct-print-document').locator('p mark')).toHaveText(['（B）', '（B）']);
  await expect(page.getByRole('region', { name: '答案表', exact: true }).locator('mark')).toHaveText(['2', '2']);
  const start = Date.now(); const answerDownload = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF', exact: true }).click();
  const answerFile = info.outputPath('quick-answers.pdf'); await (await answerDownload).saveAs(answerFile); const answerMs = Date.now() - start;
  const answerBytes = await readFile(answerFile); expect(answerBytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(answerBytes.toString('latin1')).toContain('/Type /Outlines'); expect(answerBytes.toString('latin1')).toContain('/Subtype /Link');
  expect(yellowPdfRects(answerBytes)).toBe(4);
  await expect(page.getByRole('button', { name: '纯题目', exact: true })).toBeEnabled(); await page.getByRole('button', { name: '纯题目', exact: true }).click();
  const preview = page.getByTestId('direct-print-document'); await expect(preview).toHaveAttribute('data-pdf-content', 'questions'); await expect(preview).not.toContainText('Original saved explanation'); await expect(preview).not.toContainText('作答：');
  await expect(page.getByRole('region', { name: '答案表', exact: true })).toHaveCount(0); await expect(preview.locator('mark')).toHaveCount(0);
  await page.evaluate(() => { const probe: unknown = Reflect.get(window, '__quickPdfProbe'); if (probe && typeof probe === 'object' && 'lines' in probe && Array.isArray(probe.lines)) probe.lines.length = 0; });
  const pureStart = Date.now(), pureDownload = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF', exact: true }).click();
  const pureFile = info.outputPath('quick-questions.pdf'); await (await pureDownload).saveAs(pureFile); const pureMs = Date.now() - pureStart;
  const pureBytes = await readFile(pureFile); expect(pureBytes.subarray(0, 5).toString()).toBe('%PDF-'); expect(yellowPdfRects(pureBytes)).toBe(0); expect(pdfStreams(pureBytes)).not.toContain('Original saved explanation');
  const probe: unknown = await page.evaluate(() => Reflect.get(window, '__quickPdfProbe'));
  expect(probe).toMatchObject({ scans: 0, frames: 0 }); expect(JSON.stringify(probe)).not.toContain('Original saved explanation'); expect(JSON.stringify(probe)).not.toContain('作答：');
  expect(await records(page)).toEqual(before);
  await writeFile(info.outputPath('quick-timings.json'), JSON.stringify({ answerMs, pureMs, sampleQuestions: 2 }));
  await info.attach('quick-timings', { body: JSON.stringify({ answerMs, pureMs, sampleQuestions: 2 }), contentType: 'application/json' });
  await page.emulateMedia({ colorScheme: 'dark' }); await page.screenshot({ path: info.outputPath('quick-export-dark.png') });
});

test('quick parsed multi-copy export keeps remarks, requested wrong marks and complete ZIP entries', async ({ page }, info) => {
  await seed(page, true, false, false); const before = await records(page); await quickProbe(page);
  await page.getByRole('button', { name: '快速原文（最快）', exact: true }).click();
  await page.getByLabel('导出份数').fill('10'); await page.getByLabel('第1份答错题数').fill('1');
  await page.getByRole('button', { name: '标记错题', exact: true }).click(); await page.getByLabel('第1份备注').fill('快速测试');
  const started = Date.now(), waiting = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF 压缩包', exact: true }).click();
  const download = await waiting, path = info.outputPath('quick-ten.zip'); await download.saveAs(path);
  const files = unzip(await readFile(path)); expect(Object.keys(files)).toHaveLength(10); expect(Object.keys(files).some(name => /^快速测试_\d{8}-\d{6}\.pdf$/.test(name))).toBe(true);
  for (const bytes of Object.values(files)) expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe('%PDF-');
  const probe: unknown = await page.evaluate(() => Reflect.get(window, '__quickPdfProbe')); expect(probe).toMatchObject({ scans: 0, frames: 0 }); expect(JSON.stringify(probe)).toContain('× 作答错误');
  expect(await records(page)).toEqual(before); await writeFile(info.outputPath('quick-ten-timing.json'), JSON.stringify({ elapsedMs: Date.now() - started, copies: 10 })); await info.attach('quick-ten-timing', { body: JSON.stringify({ elapsedMs: Date.now() - started, copies: 10 }), contentType: 'application/json' });
});

test('quick parsed cancellation discards a late encoded asset and allows an explicit fresh export', async ({ page }) => {
  await seed(page, false, false, false); const before = await records(page);
  await page.getByRole('button', { name: '快速原文（最快）', exact: true }).click();
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob; let held = false; let release = () => {};
    Object.defineProperty(window, '__releaseQuickEncoding', { value: () => release() });
    HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) {
      if ((type === 'image/jpeg' || type === 'image/png') && !held) { held = true; document.documentElement.dataset.quickEncoding = 'held'; const canvas = this; release = () => Reflect.apply(original, canvas, [callback, type, quality]); return; }
      return Reflect.apply(original, this, [callback, type, quality]);
    };
  });
  let downloads = 0; page.on('download', () => downloads++);
  await page.getByRole('button', { name: '下载 PDF', exact: true }).click(); await expect(page.locator('html')).toHaveAttribute('data-quick-encoding', 'held');
  await page.getByRole('button', { name: '取消导出', exact: true }).click();
  await expect(page.getByRole('button', { name: '下载 PDF', exact: true })).toBeEnabled();
  await page.evaluate(() => { const release: unknown = Reflect.get(window, '__releaseQuickEncoding'); if (typeof release !== 'function') throw new Error('ENCODING_RELEASE'); release(); });
  await page.getByRole('button', { name: '导出记录', exact: true }).click();
  await expect(page.getByTestId('export-record')).toHaveAttribute('data-status', 'cancelled'); expect(downloads).toBe(0);
  await page.getByRole('button', { name: '关闭导出记录', exact: true }).click(); await reopen(page);
  await page.getByRole('button', { name: '快速原文（最快）', exact: true }).click();
  const waiting = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF', exact: true }).click(); await waiting;
  expect(downloads).toBe(1); expect(await records(page)).toEqual(before);
});

test('unprepared first long question downloads with continuation and provisional page progress', async ({ page }, info) => {
  await seed(page, false, false, false); await page.getByRole('button', { name: '关闭导出', exact: true }).click();
  const original = LocalRecordSchema.parse(JSON.parse((await records(page))[0] ?? 'null'));
  for (const run of original.session.runs) if (run.outcome?.status === 'completed') run.outcome.candidate.problem.text = Array.from({ length: 55 }, (_, index) => `Paragraph ${index + 1}: Preserve the complete saved material, numerical values and units. Do not truncate this sentence.`).join('\n\n');
  await page.evaluate(record => new Promise<void>((resolve, reject) => { const request = indexedDB.open('solveflow-local'); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result, tx = db.transaction('documents', 'readwrite'); tx.objectStore('documents').put(JSON.stringify(record), `record.${record.session.id}`); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); }; }), original);
  await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible(); await reopen(page);
  await page.getByRole('button', { name: '整理后的试卷', exact: true }).click();
  await page.evaluate(() => {
    const progress: string[] = []; Object.defineProperty(window, '__unpreparedProgress', { value: progress });
    new MutationObserver(() => { for (const node of document.querySelectorAll('[role="status"]')) if (node.textContent?.includes('生成第')) progress.push(node.textContent); }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  const started = Date.now(), waiting = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF', exact: true }).click();
  const download = await waiting, file = info.outputPath('unprepared-long-first.pdf'); await download.saveAs(file);
  const bytes = await readFile(file), count = bytes.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0; expect(count).toBeGreaterThan(2);
  const progress: unknown = await page.evaluate(() => Reflect.get(window, '__unpreparedProgress')); expect(Array.isArray(progress)).toBe(true); expect(JSON.stringify(progress)).toContain('总页数统计中'); expect(JSON.stringify(progress)).toContain(`第 ${count} / ${count} 页`);
  await expect(page.locator('iframe[title="批次 PDF 打印"]')).toHaveCount(0);
  await info.attach('standard-unprepared-timing', { body: JSON.stringify({ elapsedMs: Date.now() - started, pages: count }), contentType: 'application/json' });
});
test('text-only export omits pictures and explanations, produces a real named PDF and preserves saved answers', async ({ page }, info) => {
  await seed(page); const before = await records(page); await textOnly(page);
  const doc = page.getByTestId('batch-copy-document'); await expect(doc.locator('img')).toHaveCount(0); await expect(doc.getByTestId('copy-question')).toHaveCount(2); await expect(doc).not.toContainText('Original saved explanation');
  const waiting = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF', exact: true }).click(); const download = await waiting;
  expect(download.suggestedFilename()).toBe('PDF variants_作答_第01份_2题_对2_错0.pdf'); const destination = info.outputPath('text-only.pdf'); await download.saveAs(destination); const bytes = await readFile(destination); expect(bytes.subarray(0, 5).toString()).toBe('%PDF-'); expect(bytes.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(2);
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
  await textOnly(page); const waiting = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF', exact: true }).click(); const downloaded = await waiting; const file = info.outputPath('history-entry.pdf'); await downloaded.saveAs(file); expect((await readFile(file)).subarray(0, 5).toString()).toBe('%PDF-'); await expect(page.getByLabel('导出份数', { exact: true })).toBeEnabled();
  for (const size of [{ width: 320, height: 844 }, { width: 740, height: 390 }]) { await page.setViewportSize(size); expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true); await expect(page.getByRole('button', { name: '下载 PDF', exact: true })).toBeInViewport({ ratio: 1 }); }
  await page.emulateMedia({ colorScheme: 'dark' }); await expect.poll(async () => page.getByLabel('导出内容').evaluate(node => getComputedStyle(node).colorScheme)).toBe('dark'); await page.setViewportSize(info.project.name === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 1000 }); await page.screenshot({ path: info.outputPath('pdf-export-dialog-dark.png') });
  await expect(page.getByRole('dialog')).toHaveCount(1); await expect(dialog.getByLabel('第1份答错题数')).toBeVisible();
  await page.getByRole('button', { name: '关闭导出', exact: true }).click(); await expect(page.getByRole('tab', { name: '历史题目', exact: true })).toHaveAttribute('aria-selected', 'true'); expect(await records(page)).toEqual(before);
});
test('ten copies use their requested answer counts, cancel settings safely, and download ten distinct named PDF entries', async ({ page }, info) => {
  await seed(page); const before = await records(page); await textOnly(page);
  await page.getByLabel('导出份数').fill('3'); await page.getByRole('button', { name: '关闭导出', exact: true }).click(); await reopen(page); await expect(page.getByLabel('导出份数')).toHaveValue('1'); await expect(page.getByRole('button', { name: '当前副本', exact: true })).toHaveCount(0); await textOnly(page);
  await page.getByLabel('导出份数').fill('10');
  for (let index = 0; index < 10; index++) await page.getByLabel(`第${index + 1}份答错题数`).fill(String(index % 3));
  await page.getByText('预览导出内容', { exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(1); await page.getByRole('button', { name: '当前副本', exact: true }).click(); await expect(page.getByRole('option')).toHaveCount(10); await page.keyboard.press('Escape');
  for (let index = 0; index < 10; index++) { await picker(page, '当前副本', `第 ${index + 1} 份 · 对 ${2 - index % 3} / 错 ${index % 3}`); await expect(page.getByTestId('batch-copy-document').locator('[data-adjusted="true"]')).toHaveCount(index % 3); }
  const waiting = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF 压缩包', exact: true }).click(); const download = await waiting;
  const destination = info.outputPath('ten-copies.zip'); await download.saveAs(destination); const files = unzip(await readFile(destination)); expect(Object.keys(files)).toHaveLength(10);
  expect(download.suggestedFilename()).toBe('PDF variants_作答_10份.zip');
  for (let index = 0; index < 10; index++) { const filename = `PDF variants_作答_第${String(index + 1).padStart(2, '0')}份_2题_对${2 - index % 3}_错${index % 3}.pdf`; const bytes = Buffer.from(files[filename] ?? []); expect(bytes.subarray(0, 5).toString()).toBe('%PDF-'); expect(bytes.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(2); }
  expect(await records(page)).toEqual(before); await expect(page.locator('iframe[title="批次 PDF 打印"]')).toHaveCount(0);
});
test('an original red warning is assumed correct, explicit errors and references only change exports', async ({ page }) => {
  await seed(page, true); const before = await records(page); await expect(page.locator('.pdf-counts')).toContainText('对 2 题 · 错 0 题');
  await expect(page.getByLabel('第1份答错题数')).toHaveValue('0');
  await expect(page.getByRole('button', { name: '下载 PDF', exact: true })).toBeEnabled();
  await page.getByLabel('第1份答错题数').fill('1');
  await expect(page.getByTestId('batch-copy-document').locator('[data-adjusted="true"]')).toHaveCount(1);
  await page.getByLabel('第1份答错题数').fill('0');
  await page.getByText('逐题参照答案与错误作答', { exact: true }).click(); await page.getByLabel('第2题参照答案').fill('A');
  await expect(page.locator('.pdf-counts')).toContainText('对 2 题 · 错 0 题'); await expect(page.getByTestId('copy-answer').nth(1)).toContainText('A'); await expect(page.getByRole('button', { name: '下载 PDF', exact: true })).toBeEnabled(); expect(await records(page)).toEqual(before);
});
test('five errors stay dispersed and fixed through preview changes, printing and downloading', async ({ page }, info) => {
  await seed(page, true); await page.getByRole('button', { name: '关闭导出', exact: true }).click();
  const original = LocalRecordSchema.parse(JSON.parse((await records(page))[0] ?? 'null'));
  const fixtures = Array.from({ length: 27 }, (_, index) => {
    const record = structuredClone(original); const id = `93100000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    record.session.id = id; record.session.upload.id = id; record.session.upload.previewUrl = `/api/v1/uploads/${id}/image`;
    if (!record.batch) throw new Error('BATCH'); record.batch.position = index + 1;
    for (const run of record.session.runs) {
      run.id = id; run.sessionId = id;
      if (run.outcome?.status === 'completed') run.outcome.candidate.problem.text = `Question ${index + 1}. ` + 'Synthetic material. '.repeat(3 + index % 3 * 50);
    }
    return LocalRecordSchema.parse(record);
  });
  await page.evaluate(fixtures => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('solveflow-local'); request.onerror = () => reject(request.error);
    request.onsuccess = () => { const db = request.result, tx = db.transaction('documents', 'readwrite'), store = tx.objectStore('documents');
      for (const record of fixtures) store.put(JSON.stringify(record), `record.${record.session.id}`);
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }), fixtures);
  await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible(); await reopen(page);
  await page.getByRole('button', { name: '已保存内容', exact: true }).click();
  await expect(page.getByLabel('第1份答错题数')).toHaveValue('0');
  await page.getByLabel('第1份答错题数').fill('5'); await page.getByRole('button', { name: '标记错题', exact: true }).click();
  await page.getByText('预览导出内容', { exact: true }).click();
  // Inspect the plan after the local image preparation phase has mounted its document.
  await page.getByTestId('batch-copy-document').waitFor({ state: 'visible' });
  const wrong = () => page.locator('[data-testid="copy-question"][data-answer-incorrect="true"]').evaluateAll(nodes => nodes.map(node => Number(node.getAttribute('data-pdf-question'))));
  await expect.poll(async () => (await wrong()).length).toBe(5); const planned = await wrong();
  expect(new Set(planned.map(ordinal => Math.floor((ordinal - 1) / 9))).size).toBe(3);
  expect(new Set(planned.map(ordinal => (ordinal - 1) % 3)).size).toBe(3);
  await page.getByRole('button', { name: '不标记', exact: true }).click();
  await page.getByRole('button', { name: '标记错题', exact: true }).click(); expect(await wrong()).toEqual(planned);
  await page.evaluate(() => new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) if (node instanceof HTMLIFrameElement && node.title === '批次 PDF 打印' && node.contentDocument && node.contentWindow) {
      document.documentElement.dataset.printedErrors = JSON.stringify([...node.contentDocument.querySelectorAll('[data-answer-incorrect="true"]')].map(question => Number(question.getAttribute('data-pdf-question'))));
      node.contentWindow.print = () => node.contentWindow?.dispatchEvent(new Event('afterprint'));
    }
  }).observe(document, { childList: true, subtree: true }));
  await page.getByRole('button', { name: '打印 / 保存 PDF', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-printed-errors', JSON.stringify(planned));
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF', exact: true }).click(); const download = await pending;
  await download.saveAs(info.outputPath('dispersed-five-errors.pdf'));
  expect(download.suggestedFilename()).toContain('_对22_错5_标记错题.pdf');
  await expect(page.locator('html')).toHaveAttribute('data-printed-errors', JSON.stringify(planned));
  expect(await wrong()).toEqual(planned); await expect(page.getByTestId('copy-question')).toHaveCount(27);
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
  const dimensions = await questions.nth(1).getByAltText('Synthetic choice chart').evaluate(image => image instanceof HTMLImageElement ? [image.naturalWidth, image.naturalHeight] : []); expect(dimensions[0]).toBeLessThan(500); expect(dimensions[1]).toBeLessThan(400);
  await page.getByText('图片整理', { exact: true }).click(); await picker(page, '当前题目', '第 2 题'); await page.getByRole('button', { name: '图片来源', exact: true }).click(); await page.getByRole('option', { name: /题干图.*Synthetic body chart/ }).click(); await page.getByRole('button', { name: '将当前裁片用于本题', exact: true }).click();
  await expect(questions.nth(1).locator('img')).toHaveCount(2); await expect(questions.nth(1).locator('.print-copy-options li').nth(0).locator('img')).toHaveCount(1); expect(calls).toBe(2); expect(await records(page)).toEqual(before);
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
    const result = { schemaVersion: 1, questions: input.questions.map(question => ({ ...question, problem: question.problem ?? { text: 'Question 2: select two.', subject: 'math', uncertainties: [], options: [{ label: 'A', text: 'one' }, { label: 'B', text: 'two' }, { label: 'C', text: 'three' }] }, confidence: 1, warnings: [], sources: input.sources.map(({ id }) => ({ id, kind: question.problem?.text.includes('Question 1:') ? 'text-only' : 'illustrations', rotation: 0, regions: question.problem?.text.includes('Question 1:') ? [] : [{ id: 'chart', alt: 'Necessary synthetic chart', role: 'question', x: .53, y: .33, width: .28, height: .45 }] })) })) };
    await beforeResponse(call);
    await route.fulfill({ json: { id: 'fixture', object: 'chat.completion', created: 1, model: 'layout', choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(result) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } } }).catch(() => undefined);
  });
  return () => calls;
}
async function reopen(page: Page) {
  await page.getByRole('button', { name: '批次操作', exact: true }).click(); await page.getByRole('button', { name: '导出本批 PDF', exact: true }).click(); await expect(page.getByRole('button', { name: '纯题目', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '严格试卷版', exact: true }).click();
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
  await page.getByLabel('导出份数').fill('2'); await page.getByLabel('第1份答错题数').fill('1'); await page.getByLabel('第2份答错题数').fill('2'); await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.getByRole('button', { name: '纯题目', exact: true }).click(); const doc = page.getByTestId('batch-copy-document');
  await expect(doc).toHaveAttribute('data-pdf-content', 'questions'); await expect(doc.getByTestId('copy-question')).toHaveCount(2); await expect(doc.getByTestId('copy-answer')).toHaveCount(0); await expect(doc.locator('[data-adjusted]')).toHaveCount(0); await expect(doc.locator('.print-copy-options li')).toHaveCount(6); await expect(doc.getByAltText('Necessary synthetic chart')).toHaveCount(1);
  await expect(doc).not.toContainText('作答'); await expect(doc).not.toContainText('Original saved explanation'); await expect(doc).not.toContainText(/对 \d+ 题|错 \d+ 题/); await expect(page.getByRole('button', { name: '批量导出', exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: '当前副本', exact: true })).toHaveCount(0); expect(calls()).toBe(2);
  await page.getByRole('button', { name: '打印 / 保存 PDF', exact: true }).click(); await expect(page.locator('html')).toHaveAttribute('data-question-pdf-printed', 'true'); await expect(page.locator('html')).toHaveAttribute('data-cloned-pdf-mode', 'questions'); await expect(page.locator('html')).toHaveAttribute('data-cloned-pdf-answers', '0');
  const waiting = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF', exact: true }).click(); const download = await waiting; expect(download.suggestedFilename()).toBe('PDF variants_题目_2题.pdf'); await download.saveAs(info.outputPath('question-only.pdf')); const bytes = await readFile(info.outputPath('question-only.pdf')); expect(bytes.subarray(0, 5).toString()).toBe('%PDF-'); expect(bytes.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(2); await expect(page.locator('html')).toHaveAttribute('data-cloned-pdf-mode', 'questions'); await expect(page.locator('html')).toHaveAttribute('data-cloned-pdf-answers', '0'); expect(await page.locator('html').getAttribute('data-cloned-pdf-text')).not.toContain('Original saved explanation'); expect(calls()).toBe(2);
  await page.getByRole('button', { name: '题目与作答', exact: true }).click(); await expect(doc).toHaveAttribute('data-pdf-content', 'answers'); await expect(doc.getByTestId('copy-answer')).toHaveCount(2); await expect(doc.locator('[data-adjusted="true"]')).toHaveCount(1); await expect(page.getByRole('button', { name: '下载 PDF 压缩包', exact: true })).toBeVisible(); expect(await records(page)).toEqual(before);
});
test('question-only download with preview collapsed runs the agent once and respects dark narrow layouts', async ({ page }, info) => {
  const calls = await layoutFixture(page); await seed(page, true, true, false); const before = await records(page); await page.getByRole('button', { name: '纯题目', exact: true }).click(); expect(calls()).toBe(0); await expect(page.getByTestId('copy-question')).toHaveCount(0);
  await page.emulateMedia({ colorScheme: 'dark' }); const dialog = page.getByRole('dialog', { name: '导出 PDF', exact: true });
  for (const size of [{ width: 320, height: 844 }, { width: 740, height: 390 }]) { await page.setViewportSize(size); expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true); await expect(page.getByRole('button', { name: '下载 PDF', exact: true })).toBeInViewport({ ratio: 1 }); }
  await page.setViewportSize(info.project.name === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 1000 }); await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => undefined))); }); await page.screenshot({ path: info.outputPath('question-only-dialog.png') });
  const waiting = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF', exact: true }).click(); const download = await waiting; expect(download.suggestedFilename()).toBe('PDF variants_题目_2题.pdf'); await download.saveAs(info.outputPath('collapsed-question-only.pdf')); expect((await readFile(info.outputPath('collapsed-question-only.pdf'))).subarray(0, 5).toString()).toBe('%PDF-'); expect(calls()).toBe(2); await expect(page.getByTestId('batch-copy-document')).toHaveAttribute('data-pdf-content', 'questions'); await expect(page.getByTestId('copy-answer')).toHaveCount(0); expect(await records(page)).toEqual(before);
});
test('question extraction remains available when one record has no saved answer', async ({ page }, info) => {
  const calls = await layoutFixture(page); await seed(page, false, true, false); await page.getByRole('button', { name: '关闭导出', exact: true }).click();
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('solveflow-local'); request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result; const tx = db.transaction('documents', 'readwrite'); const store = tx.objectStore('documents'); const key = 'record.93100000-0000-4000-8000-000000000002'; const read = store.get(key);
      read.onsuccess = () => { if (typeof read.result !== 'string') { tx.abort(); return; } const value: unknown = JSON.parse(read.result); if (!value || typeof value !== 'object' || !('session' in value) || !value.session || typeof value.session !== 'object' || !('runs' in value.session)) { tx.abort(); return; } value.session.runs = []; store.put(JSON.stringify(value), key); };
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = tx.onabort = () => { db.close(); reject(tx.error ?? new Error('FIXTURE_WRITE_FAILED')); };
    };
  }));
  const before = await records(page); await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible(); await reopen(page);
  await expect(page.getByRole('button', { name: '题目与作答', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('第1份答错题数')).toHaveValue('0');
  await page.getByText('预览导出内容', { exact: true }).click();
  await expect(page.getByTestId('copy-answer').nth(1)).toHaveText('作答：未保存作答');
  await expect(page.locator('.pdf-counts')).toContainText('对 2 题 · 错 0 题');
  await page.getByRole('button', { name: '纯题目', exact: true }).click();
  const waiting = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF', exact: true }).click(); const download = await waiting; const file = info.outputPath('unanswered-question-paper.pdf'); await download.saveAs(file);
  expect((await readFile(file)).toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(2); await expect(page.getByTestId('copy-question')).toHaveCount(2); await expect(page.getByTestId('copy-answer')).toHaveCount(0); expect(calls()).toBe(2); expect(await records(page)).toEqual(before);
});
test('unresolved full screenshots stay in review and produce no formal paper download', async ({ page }) => {
  await seed(page); await page.getByRole('button', { name: '严格试卷版', exact: true }).click(); await page.getByRole('button', { name: '纯题目', exact: true }).click(); const before = await records(page); let downloads = 0; page.on('download', () => { downloads++; });
  await page.getByRole('button', { name: '下载 PDF', exact: true }).click(); await expect(page.getByText(/尚待整理/).first()).toBeVisible(); expect(downloads).toBe(0); await expect(page.locator('iframe[title="批次 PDF 打印"]')).toHaveCount(0); expect(await records(page)).toEqual(before);
});

for (const label of ['导出份数', '第1份答错题数']) test(`copy quantity drafts retain an empty edit and block stale exports (${label})`, async ({ page }) => {
  await seed(page); await textOnly(page); const before = await records(page);
  const field = page.getByLabel(label, { exact: true }); await field.fill('');
  await expect(field).toHaveValue('');
  await expect(page.getByRole('button', { name: '打印 / 保存 PDF', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '下载 PDF', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '后台导出', exact: true })).toBeDisabled();
  await field.pressSequentially(label === '导出份数' ? '5' : '2');
  await expect(field).toHaveValue(label === '导出份数' ? '5' : '2');
  await expect(page.getByRole('button', { name: /下载 PDF/, exact: false })).toBeEnabled();
  expect(await records(page)).toEqual(before);
});

test('copy quantity drafts disclose an out-of-range count instead of exporting the old count', async ({ page }) => {
  await seed(page); await textOnly(page);
  const count = page.getByLabel('导出份数', { exact: true }); await count.fill('21');
  await expect(count).toHaveValue('21'); await expect(count).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('button', { name: /下载 PDF/ })).toBeDisabled();
  await count.press('Escape'); await expect(count).toHaveValue('1');
  await expect(page.getByRole('dialog', { name: '导出 PDF', exact: true })).toBeVisible();
});

test('copy quantity drafts keep invalid edits focused across modes and reset on closing', async ({ page }, info) => {
  await seed(page); await textOnly(page); const before = await records(page);
  const count = page.getByLabel('导出份数', { exact: true });
  for (const text of ['0', '21', '1.5', '1e1', 'x']) {
    await count.fill(text); await expect(count).toHaveValue(text); await expect(count).toBeFocused();
    await expect(count).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('导出份数需为 1 至 20 的整数。', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /下载 PDF/ })).toBeDisabled();
  }
  await page.getByRole('button', { name: '纯题目', exact: true }).click();
  await expect(page.getByRole('button', { name: '下载 PDF', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '题目与作答', exact: true }).click();
  await expect(count).toHaveValue('x'); await expect(page.getByRole('button', { name: /下载 PDF/ })).toBeDisabled();
  await page.emulateMedia({ colorScheme: 'dark' }); await count.fill('21');
  expect(await page.getByRole('dialog').evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('copy-quantity-feedback.png') });
  await count.press('Escape'); await expect(count).toHaveValue('1');
  await count.press('ArrowUp'); await expect(count).toHaveValue('2');
  await page.getByLabel('第1份答错题数').fill('3');
  await expect(page.getByLabel('第1份答错题数')).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('第1份答错题数').press('Escape');
  await expect(page.getByLabel('第1份答错题数')).toHaveValue('0');
  await page.getByRole('button', { name: '关闭导出', exact: true }).click(); await reopen(page);
  await expect(count).toHaveValue('1'); expect(await records(page)).toEqual(before);
});

test('copy quantity drafts preserve per-copy edits through count typing and export twenty exact PDF entries', async ({ page }, info) => {
  await seed(page); await textOnly(page); const before = await records(page);
  const count = page.getByLabel('导出份数', { exact: true }); await count.fill('20');
  for (let index = 0; index < 20; index++) await page.getByLabel(`第${index + 1}份答错题数`).fill(String(index % 3));
  await page.getByLabel('第20份答错题数').fill('');
  await count.fill('2'); await expect(page.getByRole('button', { name: /下载 PDF/ })).toBeEnabled();
  await count.fill(''); await count.pressSequentially('20');
  await expect(page.getByLabel('第20份答错题数')).toHaveValue('');
  await expect(page.getByRole('button', { name: /下载 PDF/ })).toBeDisabled();
  await page.getByLabel('第20份答错题数').press('Escape');
  for (let index = 0; index < 20; index++) await expect(page.getByLabel(`第${index + 1}份答错题数`)).toHaveValue(String(index % 3));
  const waiting = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF 压缩包', exact: true }).click();
  const download = await waiting; const destination = info.outputPath('twenty-copies.zip'); await download.saveAs(destination);
  expect(download.suggestedFilename()).toBe('PDF variants_作答_20份.zip'); const files = unzip(await readFile(destination));
  expect(Object.keys(files)).toHaveLength(20);
  for (let index = 0; index < 20; index++) {
    const name = `PDF variants_作答_第${String(index + 1).padStart(2, '0')}份_2题_对${2 - index % 3}_错${index % 3}.pdf`;
    const bytes = Buffer.from(files[name] ?? []); expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(2);
  }
  expect(await records(page)).toEqual(before); await expect(page.locator('iframe[title="批次 PDF 打印"]')).toHaveCount(0);
});

test('copy quantity drafts do not replace a pending artifact when storage is retried', async ({ page }, info) => {
  await seed(page); await textOnly(page); const before = await records(page);
  await page.getByLabel('导出份数').fill('2'); await page.getByLabel('第1份答错题数').fill('1'); await page.getByLabel('第2份答错题数').fill('2');
  await page.evaluate(() => {
    let fail = true; const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = new Proxy(put, { apply(target, store, args) {
      if (store instanceof IDBObjectStore && store.name === 'files' && fail) { fail = false; throw new DOMException('Synthetic quantity artifact fault', 'QuotaExceededError'); }
      return Reflect.apply(target, store, args);
    } });
    const create = Document.prototype.createElement; document.documentElement.dataset.quantityFrames = '0';
    Document.prototype.createElement = new Proxy(create, { apply(target, context, args) { if (args[0] === 'iframe') document.documentElement.dataset.quantityFrames = String(Number(document.documentElement.dataset.quantityFrames) + 1); return Reflect.apply(target, context, args); } });
  });
  await page.getByRole('button', { name: '下载 PDF 压缩包', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试保存并下载', exact: true })).toBeVisible();
  const frames = await page.locator('html').getAttribute('data-quantity-frames'); expect(Number(frames)).toBeGreaterThan(0);
  await page.getByLabel('导出份数').fill('5'); await page.getByLabel('导出份数').fill('21');
  const waiting = page.waitForEvent('download'); await page.getByRole('button', { name: '重试保存并下载', exact: true }).click();
  const download = await waiting; const destination = info.outputPath('original-two-copies.zip'); await download.saveAs(destination);
  expect(download.suggestedFilename()).toBe('PDF variants_作答_2份.zip');
  expect(Object.keys(unzip(await readFile(destination))).sort()).toEqual(['PDF variants_作答_第01份_2题_对1_错1.pdf', 'PDF variants_作答_第02份_2题_对0_错2.pdf']);
  await expect(page.locator('html')).toHaveAttribute('data-quantity-frames', frames ?? 'missing');
  await expect(page.getByLabel('导出份数')).toHaveValue('21'); await expect(page.getByRole('button', { name: /下载 PDF/ })).toBeDisabled();
  expect(await records(page)).toEqual(before);
});

test('copy quantity keyboard bounds and original records retain independent draft validity', async ({ page }) => {
  await seed(page); await textOnly(page); const before = await records(page);
  const count = page.getByLabel('导出份数', { exact: true });
  await count.fill('20'); await count.press('ArrowUp'); await expect(count).toHaveValue('20');
  await count.press('ArrowDown'); await expect(count).toHaveValue('19');
  await count.fill('1'); await count.press('ArrowDown'); await expect(count).toHaveValue('1');
  const wrong = page.getByLabel('第1份答错题数', { exact: true });
  await wrong.press('ArrowDown'); await expect(wrong).toHaveValue('0');
  await wrong.press('ArrowUp'); await expect(wrong).toHaveValue('1');
  await wrong.fill('2'); await wrong.press('ArrowUp'); await expect(wrong).toHaveValue('2');
  await wrong.fill('3'); await count.fill('21');
  await page.getByRole('button', { name: '原始记录', exact: true }).click();
  await expect(page.getByRole('button', { name: '打印 / 保存 PDF', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '后台导出', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '题目与作答', exact: true }).click();
  await expect(count).toHaveValue('21'); await expect(wrong).toHaveValue('3');
  await expect(page.getByRole('button', { name: /下载 PDF/ })).toBeDisabled();
  await count.press('Escape'); await expect(count).toHaveValue('1');
  await expect(page.getByRole('button', { name: /下载 PDF/ })).toBeDisabled();
  await wrong.press('Escape'); await expect(wrong).toHaveValue('2');
  await expect(page.getByRole('button', { name: /下载 PDF/ })).toBeEnabled();
  expect(await records(page)).toEqual(before);
});

test('per-copy remarks keep their values and theme layout through quantity and mode edits', async ({ page }, info) => {
  await seed(page); const before = await records(page);
  const count = page.getByLabel('导出份数', { exact: true });
  await count.fill('3');
  await page.getByLabel('第1份备注', { exact: true }).fill('甲组');
  await page.getByLabel('第3份备注', { exact: true }).fill('乙组');
  await count.fill('1'); await count.fill('3');
  await expect(page.getByLabel('第3份备注', { exact: true })).toHaveValue('乙组');
  await page.getByLabel('第1份答错题数', { exact: true }).fill('1');
  await expect(page.getByLabel('第1份备注', { exact: true })).toHaveValue('甲组');
  await expect(page.getByLabel('第1份答对题数', { exact: true })).toHaveText('对 1 题');
  await page.getByRole('button', { name: '纯题目', exact: true }).click();
  await page.getByRole('button', { name: '题目与作答', exact: true }).click();
  await expect(page.getByLabel('第1份备注', { exact: true })).toHaveValue('甲组');
  for (const colorScheme of ['light', 'dark'] as const) for (const viewport of [{ width: 1440, height: 1000 }, { width: 740, height: 390 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport); await page.emulateMedia({ colorScheme });
    const remark = page.getByLabel('第1份备注', { exact: true }); await remark.scrollIntoViewIfNeeded();
    await expect(remark).toBeInViewport({ ratio: 1 }); expect((await remark.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.getByRole('dialog').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`remarks-${viewport.width}-${colorScheme}.png`) });
  }
  expect(await records(page)).toEqual(before);
});

test('a remark names the real single PDF and each ZIP entry with one fixed export timestamp', async ({ page }, info) => {
  await seed(page); const before = await records(page); await textOnly(page);
  await page.getByLabel('第1份备注', { exact: true }).fill('第一组');
  await page.evaluate(() => new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) if (node instanceof HTMLIFrameElement && node.title === '批次 PDF 打印' && node.contentWindow) {
      node.contentWindow.print = () => { document.documentElement.dataset.remarkPrintTitle = document.title; node.contentWindow?.dispatchEvent(new Event('afterprint')); };
    }
  }).observe(document, { childList: true, subtree: true }));
  await page.getByRole('button', { name: '打印 / 保存 PDF', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-remark-print-title', /^第一组_\d{8}-\d{6}\.pdf$/);
  const singleWait = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF', exact: true }).click();
  const single = await singleWait; expect(single.suggestedFilename()).toMatch(/^第一组_\d{8}-\d{6}\.pdf$/);
  const singlePath = info.outputPath('remark-single.pdf'); await single.saveAs(singlePath); expect((await readFile(singlePath)).subarray(0, 5).toString()).toBe('%PDF-');
  await page.getByLabel('导出份数', { exact: true }).fill('4');
  for (const [index, remark] of ['甲组', '乙组', '甲组', ''].entries()) await page.getByLabel(`第${index + 1}份备注`, { exact: true }).fill(remark);
  const zipWait = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF 压缩包', exact: true }).click();
  const zip = await zipWait; const zipPath = info.outputPath('remark-copies.zip'); await zip.saveAs(zipPath);
  const files = unzip(await readFile(zipPath)); const names = Object.keys(files); expect(names).toHaveLength(4);
  const first = names.find(name => /^甲组_\d{8}-\d{6}\.pdf$/.test(name)); expect(first).toBeTruthy();
  const timestamp = first!.slice('甲组_'.length, -4);
  expect(names).toEqual(expect.arrayContaining([`甲组_${timestamp}.pdf`, `甲组_${timestamp}-02.pdf`, `乙组_${timestamp}.pdf`, 'PDF variants_作答_第04份_2题_对2_错0.pdf']));
  for (const bytes of Object.values(files)) expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe('%PDF-');
  expect(await records(page)).toEqual(before);
});
