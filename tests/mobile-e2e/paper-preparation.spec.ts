import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { BatchPrintLayoutInputSchema, BatchPrintLayoutSchema, LocalRecordSchema, PreparedPrintRecordSchema } from '../../packages/contracts/dist/local.js';
import { MAX_DEVICE_PHASE_DURATION_MS } from '../../packages/contracts/dist/agent.js';
const ids = ['94100000-0000-4000-8000-000000000001', '94100000-0000-4000-8000-000000000002'];
const profile = { provider: 'fixture', baseURL: 'https://paper.invalid/v1', model: 'layout', api: 'openai-completions', contextWindow: 32768, maxTokens: 8192, maxTokensField: 'max_tokens', streaming: false };
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
async function setup(page: Page, beforeModel?: () => Promise<void>, transform?: (result: unknown, call: number) => unknown, enableVerifier = false, mathFixture = false, skewFixture = 0) {
  let calls = 0; let unexpected = 0; const roles: string[] = []; const notes: string[] = []; const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/__solveflow/web-env', route => route.fulfill({ json: { schemaVersion: 1, settings: { schemaVersion: 1, solver: profile, verifier: enableVerifier ? { ...profile, model: 'refine-layout', thinking: { mode: 'on', effort: 'low', protocol: 'thinking-type' } } : null }, accessTokens: { solver: 'synthetic-paper-token', verifier: enableVerifier ? 'synthetic-refine-token' : null, backup: null } } }));
  await page.route('**/__solveflow/web-env/model/**', route => { unexpected++; return route.abort(); });
  await page.route(/\/__solveflow\/web-env\/model\/(?:solver|verifier)$/, async route => {
    calls++; roles.push(route.request().url().split('/').at(-1) ?? ''); await beforeModel?.(); const body: unknown = route.request().postDataJSON(); if (!object(body) || !Array.isArray(body.messages)) throw new Error('MESSAGES');
    const last: unknown = body.messages.at(-1); if (!object(last) || !Array.isArray(last.content)) throw new Error('CONTENT');
    for (const part of last.content) if (object(part) && part.type === 'text' && typeof part.text === 'string' && part.text.includes('reviewNotes')) { const feedback: unknown = JSON.parse(part.text); if (object(feedback) && typeof feedback.reviewNotes === 'string') notes.push(feedback.reviewNotes); }
    const part: unknown = last.content.find((part: unknown) => object(part) && part.type === 'text'); if (!object(part) || typeof part.text !== 'string') throw new Error('PROMPT');
    const raw: unknown = JSON.parse(part.text); if (!object(raw) || !Array.isArray(raw.sourceOrder)) throw new Error('INPUT'); expect(raw.purpose).toBe('reference');
    const input = BatchPrintLayoutInputSchema.parse({ purpose: raw.purpose, questions: raw.questions, sources: raw.sourceOrder.map((id: unknown) => ({ id, image: 'data:image/jpeg;base64,AQID' })) });
    const result = { schemaVersion: 1, questions: input.questions.map(question => ({ ...question, problem: question.problem, confidence: 1, warnings: [], sources: input.sources.map(source => ({ id: source.id, kind: question.problem?.text.includes('Question 1') ? 'text-only' : 'illustrations', rotation: 0, regions: question.problem?.text.includes('Question 1') ? [] : [{ id: enableVerifier && calls > 2 ? 'refined-chart' : 'chart', alt: 'Necessary colour chart', role: 'question', x: .52, y: .3, width: .3, height: .5 }] })) })) };
    const output = transform ? transform(result, calls) : result;
    await route.fulfill({ json: { id: 'fixture', object: 'chat.completion', created: 1, model: 'layout', choices: [{ index: 0, message: { role: 'assistant', content: typeof output === 'string' ? output : JSON.stringify(output) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } } });
  });
  await page.goto('/'); await expect(page.getByTestId('launch-screen')).toBeHidden();
  await page.evaluate(({ ids, mathFixture, skewFixture }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('solveflow-local', 1); request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result; const tx = db.transaction('documents', 'readwrite'); const store = tx.objectStore('documents');
      const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 550; const context = canvas.getContext('2d'); if (!context) throw new Error('CANVAS');
      context.fillStyle = skewFixture ? '#b6a2bc' : '#faf8f2'; context.fillRect(0, 0, 900, 550); context.fillStyle = '#111'; context.font = '28px serif'; context.fillText('Synthetic question', 20, 80);
      if (skewFixture) {
        context.save(); context.translate(615, 320); context.rotate(-skewFixture * Math.PI / 180); context.translate(-615, -320);
        context.font = '24px serif'; for (const y of [280, 310, 340]) context.fillText('LEVEL 100', 500, y);
        for (const [colour, points] of [['#ee0000', [[500, 230], [700, 230]]], ['#00bb00', [[500, 370], [680, 400]]]] as const) { context.fillStyle = colour; for (const [x, y] of points) context.fillRect(x - 4, y - 4, 8, 8); }
        context.restore();
      } else { context.fillStyle = '#b51b20'; context.fillRect(480, 180, 250, 250); }
      const image = canvas.toDataURL('image/jpeg'); const createdAt = '2026-10-13T03:00:00.000Z';
      ids.forEach((id, index) => {
        const problem = { text: `Question ${index + 1}: select one.`, subject: 'math', uncertainties: index ? ['Original question has a cropped caption.'] : mathFixture ? ['公式核对：$\\frac{25}{4}$'] : [], optionsComplete: true, options: [{ label: 'A', text: !index && mathFixture ? '$\\frac{25}{4}$' : 'one' }, { label: 'B', text: 'two' }, { label: 'C', text: 'three' }] };
        const candidate = { schemaVersion: 1, kind: 'answer', problem, answer: 'Saved answer.', selectedOptions: ['B'], steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
        const outcome = { schemaVersion: 1, status: 'completed', candidate, verified: false, verification: null, verificationStatus: 'not_requested', warning: null };
        const session = { schemaVersion: 1, id, subject: 'math', createdAt, upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: 2000, width: 900, height: 550, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` }, runs: [{ schemaVersion: 1, id, sessionId: id, createdAt, seq: 1, status: 'completed', message: '', outcome }] };
        store.put(JSON.stringify({ schemaVersion: 1, session, image, batch: { id: '94000000-0000-4000-8000-000000000001', title: 'Prepared paper', createdAt, exam: 'general', position: index + 1 } }), `record.${id}`);
      });
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }), { ids, mathFixture, skewFixture });
  await page.goto(`/?session=${ids[0]}`); await expect(page.getByTestId('current-batch')).toBeVisible();
  return { calls: () => calls, roles, notes, errors, unexpected: () => unexpected };
}
async function open(page: Page) { await page.getByRole('button', { name: '批次操作', exact: true }).click(); await page.getByRole('button', { name: '导出本批 PDF', exact: true }).click(); await expect(page.getByRole('button', { name: '整理后的试卷', exact: true })).toHaveAttribute('aria-pressed', 'true'); }
async function process(page: Page) { await page.getByRole('button', { name: '整理题目与图示', exact: true }).click(); await expect(page.getByText('已整理，可直接复用', { exact: true })).toBeVisible(); }
async function preview(page: Page) { await page.getByText('预览导出内容', { exact: true }).click(); await expect(page.getByTestId('batch-copy-document')).toBeVisible(); }
async function history(page: Page) { return page.evaluate(() => new Promise<string[]>((resolve, reject) => { const request = indexedDB.open('solveflow-local'); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result; const tx = db.transaction('documents'); const read = tx.objectStore('documents').getAll(); tx.oncomplete = () => { db.close(); resolve(read.result.filter((value: unknown): value is string => typeof value === 'string' && value.includes('"session"'))); }; tx.onerror = () => { db.close(); reject(tx.error); }; }; })); }

test('manual text confirmation keeps doubt but removes obsolete retained-source claims', async ({ page }) => {
  const f = await setup(page, undefined, value => { const parsed = BatchPrintLayoutSchema.parse(value); return { ...parsed, questions: parsed.questions.map(question => ({ ...question, confidence: .8, sources: question.sources.map(source => ({ ...source, kind: 'text-only', regions: [] })) })) }; });
  const before = await history(page); await open(page); await page.getByRole('button', { name: '整理题目与图示', exact: true }).click();
  await expect(page.getByRole('status', { name: '试卷整理状态' })).toHaveText('2 题待核对图示'); await page.getByText('图片整理', { exact: true }).click();
  for (const ordinal of [1, 2]) { await page.getByRole('button', { name: '当前题目', exact: true }).click(); await page.getByRole('option', { name: `第 ${ordinal} 题`, exact: true }).click(); await page.getByRole('button', { name: '本题仅保留文字', exact: true }).click(); }
  await expect(page.getByRole('status', { name: '试卷整理状态' })).toHaveText('已整理，可直接复用'); await preview(page);
  const printed = page.getByTestId('batch-copy-document'); await expect(printed.locator('img')).toHaveCount(0);
  await expect(printed.locator('.print-warning').filter({ hasText: '已保留原图' })).toHaveCount(0);
  await expect(printed.locator('.print-warning').filter({ hasText: '已确认仅保留文字' })).toHaveCount(2);
  expect(f.calls()).toBe(2); expect(f.unexpected()).toBe(0); expect(await history(page)).toEqual(before);
});
for (const cause of ['confidence', 'omitted-options']) test(`manual diagram confirmation retains doubt, persists the crop and removes obsolete original-image claims (${cause})`, async ({ page }) => {
  const f = await setup(page, undefined, value => { const parsed = BatchPrintLayoutSchema.parse(value); return { ...parsed, questions: parsed.questions.map(question => ({ ...question, confidence: cause === 'confidence' ? .8 : 1, ...(cause === 'omitted-options' && question.problem ? { problem: { ...question.problem, options: question.problem.options?.slice(0, 2), optionsComplete: false, uncertainties: ['模型漏录选项 C，请核对来源。'] } } : {}), sources: question.sources.map(source => ({ ...source, kind: 'text-only', regions: [] })) })) }; });
  const expectedStatus = (pending: number) => pending ? `${pending} 题待核对图示` : '已整理，可直接复用';
  const before = await history(page); await open(page); await page.getByRole('button', { name: '整理题目与图示', exact: true }).click();
  await expect(page.getByRole('status', { name: '试卷整理状态' })).toHaveText(expectedStatus(2)); await page.getByText('图片整理', { exact: true }).click();
  await page.getByLabel('导出裁切left').fill('10'); await page.getByRole('button', { name: '更新图像预览', exact: true }).click();
  await expect(page.getByRole('button', { name: '更新图像预览', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '将当前裁片用于本题', exact: true }).click(); await expect(page.getByRole('status', { name: '试卷整理状态' })).toHaveText(expectedStatus(1));
  await page.getByRole('button', { name: '当前题目', exact: true }).click(); await page.getByRole('option', { name: '第 2 题', exact: true }).click(); await page.getByRole('button', { name: '本题仅保留文字', exact: true }).click();
  await expect(page.getByRole('status', { name: '试卷整理状态' })).toHaveText(expectedStatus(0)); await preview(page);
  const printed = page.getByTestId('batch-copy-document'); const question = printed.getByTestId('copy-question').first();
  await expect(question.locator('img')).toHaveCount(1); await expect(question.locator('.print-warning')).toContainText([cause === 'confidence' ? '题目识别置信度不足，已确认使用裁图，请核对。' : '识别结果遗漏已有选项，已恢复原题文字，并已确认使用裁图，请核对。']);
  await expect(printed.locator('.print-warning').filter({ hasText: '保留原图' })).toHaveCount(0); const crop = await question.locator('img').getAttribute('src');
  await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible(); await open(page); await expect(page.getByRole('status', { name: '试卷整理状态' })).toHaveText(expectedStatus(0)); await preview(page);
  await expect(page.getByTestId('copy-question').first().locator('img')).toHaveAttribute('src', crop ?? 'MISSING_CROP');
  expect(f.calls()).toBe(2); expect(f.unexpected()).toBe(0); expect(await history(page)).toEqual(before);
});
test('prepared incomplete choices restrict variants while the unchanged baseline stays exportable', async ({ page }, info) => {
  const f = await setup(page, undefined, value => { const parsed = BatchPrintLayoutSchema.parse(value); return { ...parsed, questions: parsed.questions.map(question => ({ ...question, problem: { ...question.problem, optionsComplete: false, uncertainties: ['图片未拍到完整选项。'] } })) }; });
  const before = await history(page); await open(page); await page.getByRole('button', { name: '整理题目与图示', exact: true }).click();
  await expect(page.getByRole('status', { name: '试卷整理状态' })).toHaveText('已整理，2 题内容待核对'); await preview(page);
  await page.getByLabel('第1份答错题数').fill('2'); await expect(page.getByRole('button', { name: '下载 PDF', exact: true })).toBeDisabled();
  const planError = page.getByText('可调整的题目不足；请确认选项或填写有效参照答案及错误作答。', { exact: true }); await expect(planError).toBeVisible();
  await page.getByRole('button', { name: '纯题目', exact: true }).click(); await expect(planError).toHaveCount(0); await expect(page.getByRole('button', { name: '下载 PDF', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '题目与作答', exact: true }).click(); await expect(planError).toBeVisible(); await expect(page.getByRole('button', { name: '下载 PDF', exact: true })).toBeDisabled();
  await page.getByLabel('第1份答错题数').fill('0'); await expect(page.getByRole('button', { name: '下载 PDF', exact: true })).toBeEnabled();
  await expect(page.getByTestId('copy-answer')).toHaveText(['作答：B', '作答：B']);
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF', exact: true }).click(); const download = await pending;
  await download.saveAs(info.outputPath('unchanged-partial-reference.pdf')); expect((await readFile(info.outputPath('unchanged-partial-reference.pdf'))).toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(2);
  expect(f.calls()).toBe(2); expect(f.unexpected()).toBe(0); expect(await history(page)).toEqual(before);
});
test('incomplete choices remain disclosed after preparation and reviewing reuses the cache', async ({ page }) => {
  const f = await setup(page, undefined, value => { const checked = BatchPrintLayoutSchema.safeParse(value); if (!checked.success) throw new Error(JSON.stringify(checked.error.issues)); const parsed = checked.data; return { ...parsed, questions: parsed.questions.map(question => ({ ...question, problem: { ...question.problem, optionsComplete: !question.problem.text.includes('Question 1'), uncertainties: question.problem.text.includes('Question 1') ? ['图片未拍到完整选项。'] : question.problem.uncertainties } })) }; });
  const before = await history(page); await open(page); await page.getByRole('button', { name: '整理题目与图示', exact: true }).click();
  const status = page.getByRole('status', { name: '试卷整理状态' }); await expect(status).toHaveText('已整理，1 题内容待核对');
  await expect(page.locator('.pdf-preparation')).toHaveAttribute('data-state', 'pending'); await expect(page.getByRole('button', { name: '整理题目与图示', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '核对内容', exact: true }).click(); await expect(page.getByRole('button', { name: '当前题目', exact: true })).toHaveText('第 1 题');
  await expect(page.getByText('本题选项尚未确认完整，导出保留现有内容和疑点。', { exact: true })).toBeVisible(); expect(f.calls()).toBe(2);
  await preview(page); await expect(page.getByRole('button', { name: '下载 PDF', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '关闭导出', exact: true }).click(); await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible(); await open(page);
  await expect(status).toHaveText('已整理，1 题内容待核对'); expect(f.calls()).toBe(2); expect(await history(page)).toEqual(before); expect(f.unexpected()).toBe(0);
});
test('structured tables keep every row and unit in the print projection', async ({ page }) => {
  const table = '| absorbing object | count in one-minute interval |\n| --- | ---: |\n| no object | 473 |\n| two sheets of paper | 470 |\n| thin aluminium plate | 23 |\n| thick lead block | 20 |';
  const f = await setup(page, undefined, value => { const parsed = BatchPrintLayoutSchema.parse(value); return { ...parsed, questions: parsed.questions.map(question => ({ ...question, problem: { ...question.problem, text: `Question.\n\n${table}\n\nSelect the conclusion.` } })) }; });
  await open(page); await process(page); await preview(page); const printed = page.getByTestId('copy-question').nth(0).locator('table');
  await expect(printed.locator('tbody tr')).toHaveCount(4); await expect(printed.locator('thead')).toContainText('one-minute interval');
  await expect(printed.locator('tbody td:nth-child(2)')).toHaveText(['473', '470', '23', '20']); expect(f.calls()).toBe(2); expect(f.errors).toEqual([]);
});
test('print stems preserve explicit statement lines without rewriting saved content', async ({ page }, info) => {
  const text = 'Question 1: select the correct statements.\n\n1  Primary current is $I$.\n2  Secondary turns are 100.\n3  Resistance is 3 ohms.\n\n- Keep the original units.\n- Keep the original numbering.';
  const f = await setup(page, undefined, value => { const parsed = BatchPrintLayoutSchema.parse(value); return { ...parsed, questions: parsed.questions.map((question, index) => index ? question : { ...question, problem: { ...question.problem, text } }) }; });
  const before = await history(page); await open(page); await process(page); await preview(page);
  async function checkLines() {
    const stem = page.getByTestId('copy-question').first().locator('.print-page-stem');
    const positions = await stem.evaluate(element => ['1  Primary', '2  Secondary', '3  Resistance'].map(label => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const offset = node.textContent?.indexOf(label) ?? -1; if (offset < 0) continue;
        const range = document.createRange(); range.setStart(node, offset); range.setEnd(node, offset + 1); return range.getBoundingClientRect().top;
      }
      throw new Error('STATEMENT_LABEL_MISSING');
    }));
    expect((positions[1] ?? 0) - (positions[0] ?? 0)).toBeGreaterThan(15); expect((positions[2] ?? 0) - (positions[1] ?? 0)).toBeGreaterThan(15);
    await expect(stem.locator('ul > li')).toHaveCount(2); await expect(stem.locator('.katex')).toHaveCount(1);
  }
  await checkLines(); await page.getByRole('button', { name: '纯题目', exact: true }).click();
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF', exact: true }).click(); const download = await pending;
  await download.saveAs(info.outputPath('preserved-statement-lines.pdf')); expect((await readFile(info.outputPath('preserved-statement-lines.pdf'))).toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(2);
  await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible(); await open(page); await preview(page); await checkLines();
  expect(f.calls()).toBe(2); expect(f.unexpected()).toBe(0); expect(f.errors).toEqual([]); expect(await history(page)).toEqual(before);
});

test('print notes render formulas and option fractions retain readable numerators', async ({ page }) => {
  await setup(page, undefined, value => { const parsed = BatchPrintLayoutSchema.parse(value); return { ...parsed, questions: parsed.questions.map(question => ({ ...question, warnings: ['标注核对：$\\lambda$'] })) }; }, false, true);
  await open(page); await page.getByRole('button', { name: '整理题目与图示', exact: true }).click(); await page.getByRole('button', { name: '已保存内容', exact: true }).click(); await preview(page); const question = page.getByTestId('copy-question').nth(0);
  await expect(question.locator('.print-warning')).toHaveCount(1); await expect(question.locator('.print-warning .answer-markdown > p')).toHaveCount(2);
  await expect(question.locator('.print-warning')).toContainText('识别待核对：'); await expect(question.locator('.print-warning')).toContainText('整理待核对：');
  await expect(question.locator('.print-warning .katex')).toHaveCount(2); await expect(question.locator('.print-warning .katex-html').first()).toBeVisible();
  const noteText = await question.locator('.print-warning').first().evaluate(node => { const clone = node.cloneNode(true); if (!(clone instanceof Element)) throw new Error('NOTE_MISSING'); clone.querySelectorAll('.katex').forEach(math => math.remove()); return clone.textContent; }); expect(noteText).not.toContain('\\frac');
  const sizes = await question.locator('.print-copy-options li').first().evaluate(option => { const label = option.querySelector('strong'); const numerator = Array.from(option.querySelectorAll('.mfrac .mord')).find(node => node.textContent === '25'); if (!label || !numerator) throw new Error('FRACTION_MISSING'); return { label: parseFloat(getComputedStyle(label).fontSize), numerator: parseFloat(getComputedStyle(numerator).fontSize) }; });
  expect(sizes.numerator).toBeGreaterThanOrEqual(sizes.label * .95);
});
test('a fitted question keeps readable text and a clear footer gap', async ({ page }) => {
  await page.addInitScript(() => new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) if (node instanceof HTMLIFrameElement && node.title === '批次 PDF 打印' && node.contentWindow && node.contentDocument) {
      const doc = node.contentDocument;
      node.contentWindow.print = () => {
        const sheet = doc.querySelector<HTMLElement>('[data-pdf-question="1"]'), inner = sheet?.querySelector('.print-page-inner'), footer = sheet?.querySelector('.print-page-footer');
        if (!sheet || !inner || !footer) throw new Error('PRINT_GEOMETRY_MISSING');
        document.documentElement.dataset.printFooterGap = String(footer.getBoundingClientRect().top - inner.getBoundingClientRect().bottom);
        document.documentElement.dataset.printQuestionScale = sheet.dataset.pdfFit;
        node.contentWindow?.dispatchEvent(new Event('afterprint'));
      };
    }
  }).observe(document, { childList: true, subtree: true }));
  const f = await setup(page, undefined, value => { const parsed = BatchPrintLayoutSchema.parse(value); return { ...parsed, questions: parsed.questions.map((question, index) => index ? question : { ...question, problem: { ...question.problem, text: Array.from({ length: 26 }, (_, i) => `Statement ${i + 1}: This complete line tests fitting without dropping any printed material.`).join('\n\n') }, warnings: ['Single-page footer spacing.'] }) }; });
  const before = await history(page); await open(page); await process(page); await page.getByRole('button', { name: '纯题目', exact: true }).click(); await page.getByRole('button', { name: '打印 / 保存 PDF', exact: true }).click();
  const html = page.locator('html'); await expect(html).toHaveAttribute('data-print-footer-gap', /.+/);
  const gap = Number(await html.getAttribute('data-print-footer-gap')), scale = Number(await html.getAttribute('data-print-question-scale'));
  expect(scale).toBeLessThan(.99); expect(scale * 10.5).toBeGreaterThanOrEqual(8); expect(gap).toBeGreaterThanOrEqual(16);
  expect(await history(page)).toEqual(before); expect(f.errors).toEqual([]); expect(f.unexpected()).toBe(0);
});
test('an unfinished recognition fence does not consume layout warnings or formulas', async ({ page }) => {
  const f = await setup(page, undefined, value => { const parsed = BatchPrintLayoutSchema.parse(value); return { ...parsed, questions: parsed.questions.map(question => ({ ...question, problem: { ...question.problem, uncertainties: ['识别疑点\n\n```\n未闭合片段'] }, warnings: ['整理公式：$\\lambda$'] })) }; });
  const before = await history(page); await open(page); await process(page); await preview(page); const note = page.getByTestId('copy-question').first().locator('.print-warning');
  await expect(note).toHaveCount(1); await expect(note.locator('.answer-markdown')).toHaveCount(2); await expect(note.locator('.katex')).toHaveCount(1); await expect(note.locator('.answer-code')).toContainText('未闭合片段'); await expect(note.locator('.answer-code')).not.toContainText('整理待核对');
  await expect(note).toContainText('识别待核对：'); await expect(note).toContainText('整理待核对：'); expect(await history(page)).toEqual(before); expect(f.errors).toEqual([]); expect(f.unexpected()).toBe(0);
});
test('historical inactive images stay available for reading but do not corrupt prepared paper', async ({ page }) => {
  const f = await setup(page);
  const raw = (await history(page)).find(value => value.includes(ids[1] ?? 'missing')); const record = LocalRecordSchema.parse(raw ? JSON.parse(raw) : null);
  const materialId = '94100000-0000-4000-8000-000000000003';
  const updated = { ...record, materials: [{ id: materialId, image: record.image, width: 900, height: 550, bytes: 2000 }], activeImageIds: [materialId], session: { ...record.session, runs: record.session.runs.map((run, index) => index ? run : { ...run, imageIds: [materialId] }) } };
  await page.evaluate(row => new Promise<void>((resolve, reject) => { const request = indexedDB.open('solveflow-local'); request.onsuccess = () => { const db = request.result; const tx = db.transaction('documents', 'readwrite'); tx.objectStore('documents').put(JSON.stringify(row), `record.${row.session.id}`); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); }; request.onerror = () => reject(request.error); }), updated);
  await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible(); const before = await history(page); await open(page); await process(page);
  await page.getByText('图片整理', { exact: true }).click(); await page.getByRole('button', { name: '当前题目', exact: true }).click(); await page.getByRole('option', { name: '第 2 题', exact: true }).click();
  await page.getByRole('button', { name: '图片来源', exact: true }).click(); await page.getByRole('option', { name: '第 2 张', exact: true }).click();
  await page.getByLabel('导出裁切left').fill('10'); await page.getByRole('button', { name: '更新图像预览', exact: true }).click(); await expect(page.getByRole('button', { name: '更新图像预览', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '将当前裁片用于本题', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('历史版本题图仅用于原始记录，请选择当前题图。'); await expect(page.getByRole('button', { name: '重试保存整理', exact: true })).toHaveCount(0);
  expect(await history(page)).toEqual(before); expect(f.calls()).toBe(2);
});
test('refinement truncation names the verifier budget and keeps the previous prepared layout', async ({ page }) => {
  const f = await setup(page, undefined, undefined, true); await open(page); await process(page); let calls = 0;
  await page.route('**/__solveflow/web-env/model/verifier', route => { calls++; return route.fulfill({ json: { id: 'truncated_refinement', model: 'refine-layout', choices: [{ index: 0, message: { role: 'assistant', content: '{' }, finish_reason: 'length' }], usage: { prompt_tokens: 10, completion_tokens: 8192, total_tokens: 8202 } } }); });
  await page.getByText('图片整理', { exact: true }).click(); page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: '精修当前题', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('题目整理输出被模型截断，未保存不完整结果；请提高校验模型输出上限后重试。');
  expect(calls).toBe(1); await preview(page); await expect(page.getByTestId('copy-question').nth(1).locator('img')).toHaveCount(1); expect(f.calls()).toBe(2); expect(f.errors).toEqual([]);
});
test('explicit refinement uses only the configured verifier for the selected record and reuses it after reload', async ({ page }) => {
  const f = await setup(page, undefined, undefined, true); const before = await history(page); await open(page); await process(page);
  await page.getByText('图片整理', { exact: true }).click(); await page.getByRole('button', { name: '当前题目', exact: true }).click(); await page.getByRole('option', { name: '第 2 题', exact: true }).click();
  await page.getByRole('button', { name: '图片来源', exact: true }).click(); await page.getByRole('option', { name: /Necessary colour chart/ }).click();
  await page.getByText('精修核对意见（可选）', { exact: true }).click(); await page.getByLabel('精修核对意见').fill('请核对坐标标注是否完整。');
  await expect(page.getByLabel('精修核对意见')).toHaveAttribute('maxlength', '2000');
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: '精修当前题', exact: true }).click();
  await expect(page.getByRole('button', { name: '精修当前题', exact: true })).toBeEnabled();
  expect(f.roles).toEqual(['solver', 'solver', 'verifier']); expect(f.notes).toEqual(['请核对坐标标注是否完整。']);
  await page.getByRole('button', { name: '图片来源', exact: true }).click(); await expect(page.getByRole('option', { name: '第 2 张', exact: true })).toHaveAttribute('aria-selected', 'true'); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '关闭导出', exact: true }).click(); await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible(); await open(page); await preview(page);
  await expect(page.getByTestId('copy-question').nth(0).locator('img')).toHaveCount(0); await expect(page.getByTestId('copy-question').nth(1).locator('img')).toHaveCount(1);
  expect(f.calls()).toBe(3); expect(await history(page)).toEqual(before); expect(f.errors).toEqual([]); expect(f.unexpected()).toBe(0);
});
test('explicit first preparation stores necessary-only graphics and reuses identical pixels after reopening and reload', async ({ page }, info) => {
  const f = await setup(page); const before = await history(page); await open(page); expect(f.calls()).toBe(0); await expect(page.getByRole('button', { name: '下载 PDF', exact: true })).toBeDisabled();
  await process(page); expect(f.calls()).toBe(2); await preview(page);
  const questions = page.getByTestId('copy-question'); await expect(questions.nth(0).locator('img')).toHaveCount(0); await expect(questions.nth(1).locator('img')).toHaveCount(1); await expect(questions.nth(1)).toContainText('Original question has a cropped caption.');
  const image = await page.getByAltText('Necessary colour chart', { exact: true }).getAttribute('src'); expect(image?.startsWith('data:image/jpeg;base64,')).toBe(true);
  await page.getByRole('button', { name: '关闭导出', exact: true }).click(); await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible(); await open(page); expect(f.calls()).toBe(2); await expect(page.getByText('已整理，可直接复用', { exact: true })).toBeVisible();
  await preview(page); expect(await page.getByAltText('Necessary colour chart', { exact: true }).getAttribute('src')).toBe(image);
  await page.getByRole('button', { name: '纯题目', exact: true }).click(); await expect(page.getByTestId('copy-answer')).toHaveCount(0);
  const waiting = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF', exact: true }).click(); const download = await waiting; await download.saveAs(info.outputPath('prepared-questions.pdf')); expect((await readFile(info.outputPath('prepared-questions.pdf'))).subarray(0, 5).toString()).toBe('%PDF-');
  expect(f.calls()).toBe(2); expect(f.unexpected()).toBe(0); expect(f.errors).toEqual([]); expect(await history(page)).toEqual(before);
  await page.emulateMedia({ colorScheme: 'dark' }); await page.screenshot({ path: info.outputPath('prepared-paper-dark.png') });
});

async function markerSlopes(page: Page) {
  return page.getByAltText('Necessary colour chart', { exact: true }).evaluate(async node => {
    if (!(node instanceof HTMLImageElement)) throw new Error('FIGURE_MISSING'); await node.decode();
    const canvas = document.createElement('canvas'); canvas.width = node.naturalWidth; canvas.height = node.naturalHeight; const context = canvas.getContext('2d'); if (!context) throw new Error('CANVAS'); context.drawImage(node, 0, 0);
    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height); const result: number[] = [];
    for (const colour of ['red', 'green']) {
      const points: [number, number][] = [];
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const p = (y * width + x) * 4, r = data[p] ?? 0, g = data[p + 1] ?? 0, b = data[p + 2] ?? 0; if (colour === 'red' ? r > 180 && g < 100 && b < 100 : g > 140 && r < 100 && b < 100) points.push([x, y]); }
      const middle = points.reduce((sum, point) => sum + point[0], 0) / points.length;
      const centre = (side: boolean) => { const half = points.filter(point => (point[0] < middle) === side); if (half.length < 12) throw new Error('MARKER_LOST'); return [half.reduce((sum, point) => sum + point[0], 0) / half.length, half.reduce((sum, point) => sum + point[1], 0) / half.length] as const; };
      const left = centre(true), right = centre(false); result.push((right[1] - left[1]) / (right[0] - left[0]));
    }
    canvas.width = 0; return result;
  });
}
test('first preparation straightens colour-cast cropped figures, preserves deliberate slopes and reuses the exact exported pixels', async ({ page }, info) => {
  const f = await setup(page, undefined, undefined, false, false, 8); const before = await history(page); await open(page); await process(page); await preview(page);
  const slopes = await markerSlopes(page); expect(Math.abs(slopes[0] ?? 1)).toBeLessThan(.03); expect(slopes[1]).toBeCloseTo(1 / 6, 1);
  const image = await page.getByAltText('Necessary colour chart', { exact: true }).getAttribute('src');
  await page.getByText('图片整理', { exact: true }).click(); await page.getByRole('button', { name: '当前题目', exact: true }).click(); await page.getByRole('option', { name: '第 2 题', exact: true }).click(); await page.getByRole('button', { name: '图片来源', exact: true }).click(); await page.getByRole('option', { name: /Necessary colour chart/ }).click();
  const angle = Number(await page.getByLabel('导出题图旋转角度').inputValue()); expect(angle).toBeGreaterThan(6); expect(angle).toBeLessThan(10);
  const waiting = page.waitForEvent('download'); await page.getByRole('button', { name: '纯题目', exact: true }).click(); await page.getByRole('button', { name: '下载 PDF', exact: true }).click(); const download = await waiting; await download.saveAs(info.outputPath('straightened-figures.pdf'));
  expect((await readFile(info.outputPath('straightened-figures.pdf'))).toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(2);
  await page.getByRole('button', { name: '关闭导出', exact: true }).click(); await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible(); await open(page); await preview(page);
  expect(await page.getByAltText('Necessary colour chart', { exact: true }).getAttribute('src')).toBe(image); expect(await markerSlopes(page)).toEqual(slopes); expect(await history(page)).toEqual(before); expect(f.calls()).toBe(2); expect(f.errors).toEqual([]); expect(f.unexpected()).toBe(0);
});

test('legacy prepared crops can be straightened locally once without replacing saved questions or calling a model', async ({ page }) => {
  const f = await setup(page, undefined, undefined, false, false, 8); await open(page); await process(page); const before = await history(page);
  await page.getByRole('button', { name: '关闭导出', exact: true }).click();
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
    const request = indexedDB.open('solveflow-print-cache'); request.onerror = () => reject(request.error);
    request.onsuccess = () => { const db = request.result, tx = db.transaction('entries', 'readwrite'), read = tx.objectStore('entries').openCursor();
      read.onsuccess = () => { const cursor = read.result; if (!cursor) return; const value: unknown = cursor.value;
        if (String(cursor.key).startsWith('prepared-paper-') && object(value) && object(value.images) && object(value.adjustments) && Array.isArray(value.sources)) {
          for (const key of Object.keys(value.images)) { const source: unknown = value.sources.find((source: unknown) => object(source) && source.key === key); if (!object(source) || typeof source.image !== 'string') throw new Error('CROP_SOURCE'); value.images[key] = source.image; value.adjustments[key] = { rotation: 0, crop: { left: 0, top: 0, right: 1, bottom: 1 }, enhance: true }; }
          cursor.update(value);
        }
        cursor.continue();
      };
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }));
  await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible(); await open(page); await preview(page);
  expect(Math.abs((await markerSlopes(page))[0] ?? 0)).toBeGreaterThan(.1);
  await page.getByRole('button', { name: '摆正本批图示', exact: true }).click(); await expect(page.getByText('已摆正 1 张图示，已有旋转和裁切保持不变。', { exact: true })).toBeVisible();
  const slopes = await markerSlopes(page); expect(Math.abs(slopes[0] ?? 1)).toBeLessThan(.03); expect(slopes[1]).toBeCloseTo(1 / 6, 1); const image = await page.getByAltText('Necessary colour chart', { exact: true }).getAttribute('src');
  await expect(page.getByRole('button', { name: '摆正本批图示', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '关闭导出', exact: true }).click(); await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible(); await open(page); await preview(page);
  expect(await page.getByAltText('Necessary colour chart', { exact: true }).getAttribute('src')).toBe(image); expect(await markerSlopes(page)).toEqual(slopes); expect(await history(page)).toEqual(before); expect(f.calls()).toBe(2); expect(f.errors).toEqual([]); expect(f.unexpected()).toBe(0);
});

test('manual decisions and crop adjustments survive a dialog reopening without another extraction request', async ({ page }) => {
  const f = await setup(page); await open(page); await process(page); await page.getByText('图片整理', { exact: true }).click();
  await page.getByRole('button', { name: '当前题目', exact: true }).click(); await page.getByRole('option', { name: '第 2 题', exact: true }).click();
  await page.getByRole('button', { name: '图片来源', exact: true }).click(); await page.getByRole('option', { name: /Necessary colour chart/ }).click();
  await page.getByLabel('导出题图旋转角度').fill('2'); await page.getByRole('button', { name: '更新图像预览', exact: true }).click(); await expect(page.getByText('整理结果已保存，后续导出可复用。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭导出', exact: true }).click(); await open(page); await page.getByText('图片整理', { exact: true }).click(); await page.getByRole('button', { name: '当前题目', exact: true }).click(); await page.getByRole('option', { name: '第 2 题', exact: true }).click(); await page.getByRole('button', { name: '图片来源', exact: true }).click(); await page.getByRole('option', { name: /Necessary colour chart/ }).click(); await expect(page.getByLabel('导出题图旋转角度')).toHaveValue('2');
  await page.getByRole('button', { name: '本题仅保留文字', exact: true }).click(); await expect(page.getByText('整理结果已保存，后续导出可复用。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭导出', exact: true }).click(); await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible(); await open(page); await preview(page); await expect(page.getByTestId('copy-question').nth(1).locator('img')).toHaveCount(0); expect(f.calls()).toBe(2); expect(f.errors).toEqual([]);
});

test('prepared storage failure reveals feedback and keyboard retry above a long copy list without replaying the model', async ({ page }) => {
  let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; }); const f = await setup(page, () => gate); await open(page); const before = await history(page);
  await page.evaluate(() => { const put = IDBObjectStore.prototype.put; let fault = true; IDBObjectStore.prototype.put = function(this: IDBObjectStore, value, key) { if (fault && this.transaction.db.name === 'solveflow-print-cache' && this.name === 'entries' && typeof key === 'string' && key.startsWith('prepared-paper-')) { fault = false; throw new DOMException('TEST_QUOTA', 'QuotaExceededError'); } return Reflect.apply(put, this, [value, key]); }; });
  try {
    await page.getByLabel('导出份数', { exact: true }).fill('20'); await page.getByRole('button', { name: '整理题目与图示', exact: true }).click();
    await expect.poll(f.calls).toBe(1); await page.locator('.pdf-dialog-body').evaluate(node => { node.scrollTop = node.scrollHeight; }); release();
    await expect(page.getByRole('alert')).toBeVisible(); await expect(page.getByRole('alert')).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('pdf-operation-feedback')).toBeFocused();
    const retry = page.getByRole('button', { name: '重试保存整理', exact: true });
    await page.keyboard.press('Tab'); await expect(retry).toBeFocused(); await expect(retry).toBeInViewport({ ratio: 1 });
    await retry.click(); await expect(retry).toHaveCount(0); expect(f.calls()).toBe(1);
    await process(page); expect(f.calls()).toBe(2); expect(await history(page)).toEqual(before); expect(f.errors).toEqual([]);
  } finally { release(); }
});

test('a prepared-record storage fault retains the result and retries only persistence', async ({ page }) => {
  const f = await setup(page); await open(page);
  await page.evaluate(() => { const put = IDBObjectStore.prototype.put; let fault = true; document.documentElement.dataset.processingCalls = '0'; const draw = CanvasRenderingContext2D.prototype.drawImage; CanvasRenderingContext2D.prototype.drawImage = new Proxy(draw, { apply(target, context, args) { document.documentElement.dataset.processingCalls = String(Number(document.documentElement.dataset.processingCalls) + 1); return Reflect.apply(target, context, args); } }); IDBObjectStore.prototype.put = function(this: IDBObjectStore, value, key) { if (fault && this.transaction.db.name === 'solveflow-print-cache' && this.name === 'entries' && typeof key === 'string' && key.startsWith('prepared-paper-')) { fault = false; throw new DOMException('Synthetic quota', 'QuotaExceededError'); } return Reflect.apply(put, this, [value, key]); }; });
  await page.getByRole('button', { name: '整理题目与图示', exact: true }).click(); await expect(page.getByRole('button', { name: '重试保存整理', exact: true })).toBeVisible(); expect(f.calls()).toBe(1); const pixels = await page.locator('html').getAttribute('data-processing-calls');
  await page.getByRole('button', { name: '重试保存整理', exact: true }).click(); await expect(page.getByRole('button', { name: '重试保存整理', exact: true })).toHaveCount(0); expect(f.calls()).toBe(1); expect(await page.locator('html').getAttribute('data-processing-calls')).toBe(pixels);
  await process(page); expect(f.calls()).toBe(2); await preview(page); await expect(page.getByTestId('copy-question').nth(1).locator('img')).toHaveCount(1); expect(f.errors).toEqual([]);
});

test('prepared pixels do not expire by age and copies or content-mode changes do not redraw or re-extract', async ({ page }) => {
  const f = await setup(page); await open(page); await process(page); await preview(page);
  const pixels = await page.getByAltText('Necessary colour chart', { exact: true }).getAttribute('src');
  await page.getByRole('button', { name: '关闭导出', exact: true }).click();
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('solveflow-print-cache'); request.onerror = () => reject(request.error);
    request.onsuccess = () => { const db = request.result; const tx = db.transaction('metadata', 'readwrite'); const store = tx.objectStore('metadata'); const cursor = store.openCursor(); cursor.onsuccess = () => { const row = cursor.result; if (row) { const value: unknown = row.value; if (value && typeof value === 'object' && 'key' in value && 'bytes' in value) row.update({ key: value.key, bytes: value.bytes, usedAt: 0 }); row.continue(); } }; tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); }; };
  }));
  await page.addInitScript(() => { let count = 0; const publish = () => document.documentElement?.setAttribute('data-paper-draws', String(count)); document.addEventListener('DOMContentLoaded', publish, { once: true }); const draw = CanvasRenderingContext2D.prototype.drawImage; CanvasRenderingContext2D.prototype.drawImage = new Proxy(draw, { apply(target, context, args) { count++; publish(); return Reflect.apply(target, context, args); } }); });
  await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible(); await open(page); await expect(page.getByText('已整理，可直接复用', { exact: true })).toBeVisible(); await preview(page);
  expect(await page.getByAltText('Necessary colour chart', { exact: true }).getAttribute('src')).toBe(pixels);
  await page.getByLabel('导出份数', { exact: true }).fill('2'); await page.getByRole('button', { name: '纯题目', exact: true }).click(); await page.getByRole('button', { name: '题目与作答', exact: true }).click();
  expect(f.calls()).toBe(2); expect(await page.locator('html').getAttribute('data-paper-draws')).toBe('0'); expect(f.errors).toEqual([]);
});

test('changed source pixels invalidate only their own prepared record and opening still makes no model request', async ({ page }) => {
  const f = await setup(page); await open(page); await process(page); await page.getByRole('button', { name: '关闭导出', exact: true }).click();
  const image = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 550; const context = canvas.getContext('2d'); if (!context) throw new Error('CANVAS'); context.fillStyle = '#faf8f2'; context.fillRect(0, 0, 900, 550); context.fillStyle = '#23894a'; context.fillRect(480, 180, 250, 250); return canvas.toDataURL('image/jpeg'); });
  const record: unknown = JSON.parse((await history(page))[1] ?? 'null'); if (!object(record) || !object(record.session) || record.session.id !== ids[1]) throw new Error('RECORD'); record.image = image;
  const id = ids[1]; if (!id) throw new Error('ID');
  await page.evaluate(({ id, value }) => new Promise<void>((resolve, reject) => { const request = indexedDB.open('solveflow-local'); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result; const tx = db.transaction('documents', 'readwrite'); tx.objectStore('documents').put(value, `record.${id}`); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); }; }; }), { id, value: JSON.stringify(record) });
  await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible(); await open(page); expect(f.calls()).toBe(2); await expect(page.getByRole('button', { name: '下载 PDF', exact: true })).toBeDisabled();
  await process(page); expect(f.calls()).toBe(3); await preview(page); await expect(page.getByTestId('copy-question').nth(0).locator('img')).toHaveCount(0); await expect(page.getByTestId('copy-question').nth(1).locator('img')).toHaveCount(1); expect(f.errors).toEqual([]);
});

test('preparation action and live status share the batch header without starting models on open', async ({ page }, info) => {
  let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; }); let pause = true;
  const f = await setup(page, () => { if (pause) { pause = false; return gate; } return Promise.resolve(); });
  await open(page); const header = page.getByTestId('pdf-batch-summary'); const action = header.getByRole('button', { name: '整理题目与图示', exact: true }); const status = header.getByRole('status', { name: '试卷整理状态' });
  await expect(action).toBeEnabled(); await expect(status).toHaveText('2 题待整理'); expect(f.calls()).toBe(0); await expect(page.getByRole('button', { name: '整理题目与图示', exact: true })).toHaveCount(1);
  const title = await header.locator('.pdf-batch-info').boundingBox(); const button = await action.boundingBox(); const bounds = await header.boundingBox(); const viewport = page.viewportSize();
  if (!title || !button || !bounds || !viewport) throw new Error('HEADER_BOUNDS');
  if (viewport.width > 600) { expect(button.x).toBeGreaterThanOrEqual(title.x + title.width); expect(button.y).toBeLessThan(title.y + title.height); }
  else { expect(button.y).toBeGreaterThanOrEqual(title.y + title.height); expect(button.x).toBeGreaterThanOrEqual(bounds.x); }
  expect(button.x + button.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1); await page.screenshot({ path: info.outputPath('preparation-header-pending.png') });
  await action.focus(); await page.keyboard.press('Enter'); await expect.poll(f.calls).toBe(1); await expect(status).toHaveText('整理题目与图示 1 / 2 · 第 1 / 3 次尝试'); await expect(action).toBeDisabled(); await expect(header.locator('.pdf-preparation')).toHaveAttribute('data-state', 'working'); await expect(page.getByText('整理题目与图示 1 / 2 · 第 1 / 3 次尝试', { exact: true })).toHaveCount(1); await page.screenshot({ path: info.outputPath('preparation-header-working.png') });
  release(); await expect(status).toHaveText('已整理，可直接复用'); await expect(header.locator('.pdf-preparation')).toHaveAttribute('data-state', 'ready'); expect(f.calls()).toBe(2);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' }); await page.screenshot({ path: info.outputPath('preparation-header-ready-dark.png') });
  await page.getByRole('button', { name: '已保存内容', exact: true }).click(); await expect(header.locator('.pdf-preparation')).toHaveCount(0); await page.getByRole('button', { name: '整理后的试卷', exact: true }).click(); await expect(status).toHaveText('已整理，可直接复用'); expect(f.calls()).toBe(2);
  await page.getByRole('button', { name: '关闭导出', exact: true }).click(); await open(page); await expect(page.getByTestId('pdf-batch-summary').getByRole('status', { name: '试卷整理状态' })).toHaveText('已整理，可直接复用'); expect(f.calls()).toBe(2); expect(f.unexpected()).toBe(0); expect(f.errors).toEqual([]);
});

test('busy progress and cancellation stay visible while scrolling many copies and short viewports', async ({ page }) => {
  let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; }); let pause = true;
  const f = await setup(page, () => { if (pause) { pause = false; return gate; } return Promise.resolve(); });
  await open(page); const before = await history(page); await page.getByLabel('导出份数', { exact: true }).fill('20');
  try {
    await page.getByRole('button', { name: '整理题目与图示', exact: true }).click(); await expect.poll(f.calls).toBe(1);
    const initial = page.viewportSize(); if (!initial) throw new Error('VIEWPORT_MISSING');
    for (const viewport of [initial, { width: 390, height: 320 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport); await page.emulateMedia({ colorScheme: 'dark' });
      await page.locator('.pdf-dialog-body').evaluate(node => { node.scrollTop = node.scrollHeight; });
      await expect(page.getByRole('status', { name: '试卷整理状态' })).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('button', { name: '取消导出', exact: true })).toBeInViewport({ ratio: 1 });
    }
    await page.getByRole('button', { name: '取消导出', exact: true }).click();
    await expect(page.getByRole('status', { name: '试卷整理状态' })).toHaveText('2 题待整理');
    expect(f.calls()).toBe(1); expect(f.errors).toEqual([]); expect(await history(page)).toEqual(before);
  } finally { release(); }
});

test('slow preparation survives fifteen seconds and Escape until explicitly cancelled', async ({ page }) => {
  let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; }); let pause = true;
  const f = await setup(page, () => { if (pause) { pause = false; return gate; } return Promise.resolve(); });
  await open(page); const before = await history(page); await page.clock.install();
  const header = page.getByTestId('pdf-batch-summary'); const action = header.getByRole('button', { name: '整理题目与图示', exact: true });
  try {
    await action.click(); await expect.poll(f.calls).toBe(1); await page.clock.fastForward(17_000);
    await expect(header.locator('.pdf-preparation')).toHaveAttribute('data-state', 'working');
    await page.keyboard.press('Escape');
    await expect(header.locator('.pdf-preparation')).toHaveAttribute('data-state', 'working');
    await expect(page.getByRole('dialog', { name: '导出 PDF', exact: true })).toBeVisible();
    await expect(action).toBeDisabled(); expect(f.calls()).toBe(1);
    await page.getByRole('button', { name: '取消导出', exact: true }).click();
    await expect(page.getByText('导出已取消。', { exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(action).toBeEnabled(); release(); await page.clock.resume();
    await expect(header.getByRole('status', { name: '试卷整理状态' })).toHaveText('2 题待整理');
    expect(f.calls()).toBe(1); expect(await history(page)).toEqual(before); expect(f.errors).toEqual([]);
  } finally { release(); }
});

test('a slow preparation can finish normally without an automatic retry', async ({ page }) => {
  let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; }); let pause = true;
  const f = await setup(page, () => { if (pause) { pause = false; return gate; } return Promise.resolve(); });
  await open(page); const before = await history(page); await page.clock.install();
  try {
    await page.getByRole('button', { name: '整理题目与图示', exact: true }).click(); await expect.poll(f.calls).toBe(1);
    await page.clock.fastForward(61_000); await expect(page.getByRole('status', { name: '试卷整理状态' })).toHaveText('整理题目与图示 1 / 2 · 第 1 / 3 次尝试');
    release(); await page.clock.resume(); await expect(page.getByRole('status', { name: '试卷整理状态' })).toHaveText('已整理，可直接复用');
    expect(f.calls()).toBe(2); expect(await history(page)).toEqual(before); expect(f.errors).toEqual([]);
  } finally { release(); }
});

test('a preparation deadline reports timeout rather than cancellation and ignores a late response', async ({ page }) => {
  let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; }); const f = await setup(page, () => gate);
  await open(page); const before = await history(page); await page.clock.install();
  try {
    await page.getByRole('button', { name: '整理题目与图示', exact: true }).click(); await expect.poll(f.calls).toBe(1);
    await page.clock.fastForward(MAX_DEVICE_PHASE_DURATION_MS + 1); await expect(page.getByRole('alert')).toHaveText('模型响应超时，请稍后重试。');
    release(); await page.clock.resume(); await expect(page.getByRole('status', { name: '试卷整理状态' })).toHaveText('2 题待整理');
    await expect(page.getByRole('button', { name: '整理题目与图示', exact: true })).toBeEnabled();
    await expect(page.getByText('导出已取消。', { exact: true })).toHaveCount(0); expect(f.calls()).toBe(1); expect(await history(page)).toEqual(before); expect(f.errors).toEqual([]);
  } finally { release(); }
});

test('a disconnected preparation stops at three attempts and reports a connection failure', async ({ page }) => {
  const f = await setup(page); await open(page); const before = await history(page); let calls = 0;
  await page.route('**/__solveflow/web-env/model/solver', route => { calls++; return route.abort('connectionreset'); });
  await page.getByRole('button', { name: '整理题目与图示', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('模型服务暂时无法完成请求，请检查连接或模型配置。（已尝试 3 次，连接异常）');
  await expect(page.getByText('导出已取消。', { exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: '整理题目与图示', exact: true })).toBeEnabled();
  expect(calls).toBe(3); expect(await history(page)).toEqual(before); expect(f.errors).toEqual([]);
});

test('a token-limited model result is disclosed as truncation without saving or automatic replay', async ({ page }) => {
  const f = await setup(page); await open(page); const before = await history(page); let calls = 0;
  await page.route('**/__solveflow/web-env/model/solver', route => {
    calls++; return route.fulfill({ json: { id: 'truncated_fixture', model: 'layout', choices: [{ index: 0, message: { role: 'assistant', content: '{"schemaVersion":1,"questions":[' }, finish_reason: 'length' }], usage: { prompt_tokens: 10, completion_tokens: 8192, total_tokens: 8202 } } });
  });
  await page.getByRole('button', { name: '整理题目与图示', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('题目整理输出被模型截断，未保存不完整结果；请提高主模型输出上限后重试。');
  await expect(page.getByRole('status', { name: '试卷整理状态' })).toHaveText('2 题待整理');
  await expect(page.getByRole('button', { name: '整理题目与图示', exact: true })).toBeEnabled();
  expect(calls).toBe(1); expect(await history(page)).toEqual(before); expect(f.errors).toEqual([]);
});

test('empty optional numbers and unlabelled option diagrams keep the original and save without replay', async ({ page }) => {
  const f = await setup(page); await open(page); let calls = 0;
  await page.route('**/__solveflow/web-env/model/solver', route => {
    calls++; const payload: unknown = route.request().postDataJSON(); if (!object(payload) || !Array.isArray(payload.messages)) throw new Error('MESSAGES');
    const last: unknown = payload.messages.at(-1); if (!object(last) || !Array.isArray(last.content)) throw new Error('CONTENT');
    const part: unknown = last.content.find((value: unknown) => object(value) && value.type === 'text'); if (!object(part) || typeof part.text !== 'string') throw new Error('PROMPT');
    const raw: unknown = JSON.parse(part.text); if (!object(raw) || !Array.isArray(raw.sourceOrder)) throw new Error('INPUT');
    const input = BatchPrintLayoutInputSchema.parse({ purpose: raw.purpose, questions: raw.questions, sources: raw.sourceOrder.map((id: unknown) => ({ id, image: 'data:image/jpeg;base64,AQID' })) });
    const output = { schemaVersion: 1, questions: input.questions.map(question => ({ ...question, problem: { ...question.problem, sourceNumber: '' }, confidence: 1, warnings: [], sources: input.sources.map(source => ({ id: source.id, kind: 'illustrations', rotation: 0, regions: [{ id: 'unassigned', alt: 'Synthetic option figure', role: 'option', x: .2, y: .2, width: .3, height: .3 }] })) })) };
    return route.fulfill({ json: { id: 'normalization_fixture', model: 'layout', choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(output) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } } });
  });
  await page.getByRole('button', { name: '整理题目与图示', exact: true }).click();
  await expect(page.getByRole('button', { name: '整理题目与图示', exact: true })).toBeEnabled();
  expect(calls).toBe(2); await expect(page.getByText('题目整理返回了无效内容；已保存的题目和答案仍可按保存内容导出。', { exact: true })).toHaveCount(0);
  const saved = await page.evaluate(() => new Promise<number>((resolve, reject) => { const request = indexedDB.open('solveflow-print-cache'); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result; const tx = db.transaction('entries'); const entries = tx.objectStore('entries').count(); tx.oncomplete = () => { db.close(); resolve(entries.result); }; }; }));
  expect(saved).toBeGreaterThanOrEqual(2); expect(f.errors).toEqual([]);
});

test('shows retry progress and accepts the third response without repeating successful records', async ({ page }) => {
  const f = await setup(page, undefined, (result, call) => call < 3 ? 'not json' : result);
  await open(page); await page.getByRole('button', { name: '整理题目与图示', exact: true }).click();
  await expect(page.getByText(/JSON 格式错误，1 秒后重试/)).toBeVisible();
  await expect(page.getByText(/JSON 格式错误，2 秒后重试/)).toBeVisible();
  await expect(page.getByText('已整理，可直接复用', { exact: true })).toBeVisible();
  expect(f.calls()).toBe(4); await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible(); await open(page);
  await expect(page.getByText('已整理，可直接复用', { exact: true })).toBeVisible();
  expect(f.calls()).toBe(4); expect(f.unexpected()).toBe(0); expect(f.errors).toEqual([]);
});

test('discloses three failed attempts and resumes only the remaining record', async ({ page }) => {
  let recovered = false; const f = await setup(page, undefined, (result, call) => call > 1 && !recovered ? 'not json' : result);
  const before = await history(page); await open(page); await page.getByRole('button', { name: '整理题目与图示', exact: true }).click();
  await expect(page.getByText(/已尝试 3 次，JSON 格式错误/)).toBeVisible(); expect(f.calls()).toBe(4);
  await expect(page.getByText('1 题待整理', { exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible(); await open(page);
  await expect(page.getByText('1 题待整理', { exact: true })).toBeVisible(); expect(f.calls()).toBe(4);
  recovered = true; await process(page); expect(f.calls()).toBe(5); expect(await history(page)).toEqual(before);
  expect(f.unexpected()).toBe(0); expect(f.errors).toEqual([]);
});

test('disconnected unanswered text extraction resumes only remaining work and exports after reload', async ({ page }, info) => {
  const extractedText = 'Question 2: calculate $2+2$.';
  await page.addInitScript(() => new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) if (node instanceof HTMLIFrameElement && node.title === '批次 PDF 打印' && node.contentWindow && node.contentDocument) {
      const doc = node.contentDocument; const target = node.contentWindow;
      target.print = () => { document.documentElement.dataset.unansweredPrinted = String(doc.querySelectorAll('[data-testid="copy-question"]').length); target.dispatchEvent(new Event('afterprint')); };
    }
  }).observe(document, { childList: true, subtree: true }));
  const f = await setup(page, undefined, value => {
    if (!object(value) || !Array.isArray(value.questions)) throw new Error('FIXTURE');
    return { ...value, questions: value.questions.map((question: unknown) => {
      if (!object(question) || !Array.isArray(question.sources)) throw new Error('FIXTURE_QUESTION');
      return { ...question, problem: question.problem ?? { text: extractedText, subject: 'math', uncertainties: [] }, sources: question.sources.map((source: unknown) => {
        if (!object(source)) throw new Error('FIXTURE_SOURCE');
        return { ...source, kind: 'text-only', rotation: 0, regions: [] };
      }) };
    }) };
  });
  await page.evaluate(id => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('solveflow-local'); request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result; const tx = db.transaction('documents', 'readwrite'); const store = tx.objectStore('documents'); const key = `record.${id}`; const read = store.get(key);
      read.onsuccess = () => {
        if (typeof read.result !== 'string') { tx.abort(); return; }
        const value: unknown = JSON.parse(read.result);
        if (!value || typeof value !== 'object' || !('session' in value) || !value.session || typeof value.session !== 'object' || !('runs' in value.session)) { tx.abort(); return; }
        value.session.runs = []; store.put(JSON.stringify(value), key);
      };
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = tx.onabort = () => { db.close(); reject(tx.error ?? new Error('FIXTURE_WRITE_FAILED')); };
    };
  }), ids[1]);
  let recovered = false; const requested: string[] = [];
  await page.route('**/__solveflow/web-env/model/solver', route => {
    const body = route.request().postData() ?? ''; const id = ids.find(id => body.includes(id)); if (!id) throw new Error('FIXTURE_SOURCE_ID');
    requested.push(id);
    return id === ids[1] && !recovered ? route.abort('connectionreset') : route.fallback();
  });
  await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible(); const before = await history(page); await open(page);
  await expect(page.getByRole('button', { name: '纯题目', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '整理题目与图示', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('已尝试 3 次，连接异常');
  await expect(page.getByRole('status', { name: '试卷整理状态' })).toHaveText('1 题待整理');
  expect(requested).toEqual([ids[0], ids[1], ids[1], ids[1]]); expect(f.calls()).toBe(1);
  await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible(); await open(page);
  await expect(page.getByRole('status', { name: '试卷整理状态' })).toHaveText('1 题待整理'); expect(requested).toHaveLength(4);
  recovered = true; await process(page); await preview(page);
  await expect(page.getByTestId('copy-question').nth(1)).toContainText('Question 2: calculate');
  await expect(page.getByTestId('copy-question').nth(1).locator('img')).toHaveCount(0);
  await page.getByRole('button', { name: '打印 / 保存 PDF', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-unanswered-printed', '2');
  const waiting = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF', exact: true }).click();
  const file = info.outputPath('reconnected-unanswered-text.pdf'); await (await waiting).saveAs(file);
  expect((await readFile(file)).toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(2);
  await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible(); await open(page);
  await expect(page.getByRole('status', { name: '试卷整理状态' })).toHaveText('已整理，可直接复用');
  await page.getByRole('button', { name: '后台导出', exact: true }).click();
  await page.getByRole('tab', { name: '我的', exact: true }).click(); await page.getByRole('button', { name: /^导出记录/ }).click();
  await expect(page.getByTestId('export-record')).toHaveCount(2); const record = page.getByTestId('export-record').first();
  await expect(record).toHaveAttribute('data-status', 'succeeded');
  const again = page.waitForEvent('download'); await record.getByRole('button', { name: '下载文件', exact: true }).click();
  const reloaded = info.outputPath('reloaded-unanswered-text.pdf'); await (await again).saveAs(reloaded);
  expect((await readFile(reloaded)).toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(2);
  expect(requested).toEqual([ids[0], ids[1], ids[1], ids[1], ids[1]]); expect(f.calls()).toBe(2);
  await expect(page.getByRole('alert')).toHaveCount(0); expect(await history(page)).toEqual(before); expect(f.unexpected()).toBe(0); expect(f.errors).toEqual([]);
});

test('distinguishes retained diagrams and opens their review without another model request', async ({ page }) => {
  const f = await setup(page, undefined, (result, call) => {
    if (call !== 1) return result;
    if (!object(result) || !Array.isArray(result.questions)) throw new Error('FIXTURE');
    return { ...result, questions: result.questions.map((question: unknown, index: number) => {
      if (!object(question) || !Array.isArray(question.sources)) throw new Error('FIXTURE_QUESTION');
      return index ? question : { ...question, sources: question.sources.map((source: unknown) => object(source) ? { ...source, kind: 'retain-source', regions: [] } : source) };
    }) };
  });
  await open(page); await page.getByRole('button', { name: '整理题目与图示', exact: true }).click();
  await expect(page.getByRole('status', { name: '试卷整理状态' })).toHaveText('1 题待核对图示');
  expect(f.calls()).toBe(2); await expect(page.getByRole('button', { name: '整理题目与图示', exact: true })).toBeEnabled(); await page.getByRole('button', { name: '核对图示', exact: true }).click();
  await expect(page.getByText('图片整理', { exact: true })).toBeFocused(); await expect(page.getByAltText('导出源图', { exact: true })).toBeVisible();
  expect(f.calls()).toBe(2); expect(f.errors).toEqual([]); expect(f.unexpected()).toBe(0);
});

test('reprocesses only the current record and preserves the saved batch history', async ({ page }) => {
  const f = await setup(page); const before = await history(page);
  await open(page); await process(page); expect(f.calls()).toBe(2);
  await page.getByText('图片整理', { exact: true }).click();
  page.once('dialog', dialog => void dialog.accept());
  await page.getByRole('button', { name: '重新整理当前题', exact: true }).click();
  await expect(page.getByRole('button', { name: '重新整理当前题', exact: true })).toBeEnabled();
  expect(f.calls()).toBe(3); expect(await history(page)).toEqual(before);
  await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible(); await open(page); expect(f.calls()).toBe(3);
  expect(f.errors).toEqual([]); expect(f.unexpected()).toBe(0);
});

test('diagram-only option labels share the picture row without hiding substantive captions', async ({ page }) => {
  const labels = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const f = await setup(page, undefined, value => { const parsed = BatchPrintLayoutSchema.parse(value); return { ...parsed, questions: parsed.questions.map(question => ({ ...question, problem: { ...question.problem, options: labels.map(label => ({ label, text: label === 'H' ? 'Frequency remains constant.' : '见选项图。' })), optionsComplete: true }, sources: question.sources.map(source => ({ ...source, kind: 'illustrations', regions: labels.map(label => ({ id: `graph-${label}`, role: 'option', optionLabel: label, alt: `Graph ${label}`, x: .1, y: .1, width: .6, height: .6 })) })) })) }; });
  await open(page); await process(page); await preview(page); const options = page.getByTestId('copy-question').nth(0).locator('.print-copy-options li');
  await expect(options.nth(0)).toHaveClass(/diagram-only/); await expect(options.nth(0).locator('img')).toHaveCount(1); await expect(options.nth(0).locator('.answer-markdown')).toHaveCount(0);
  const positions = await options.nth(0).evaluate(option => { const label = option.querySelector('strong'); const image = option.querySelector('img'); if (!label || !image) throw new Error('DIAGRAM_MISSING'); return { labelTop: label.getBoundingClientRect().top, imageTop: image.getBoundingClientRect().top, labelRight: label.getBoundingClientRect().right, imageLeft: image.getBoundingClientRect().left }; });
  expect(Math.abs(positions.labelTop - positions.imageTop)).toBeLessThan(3); expect(positions.imageLeft - positions.labelRight).toBeLessThanOrEqual(16); await expect(options.nth(7)).not.toHaveClass(/diagram-only/); await expect(options.nth(7)).toContainText('Frequency remains constant.');
  expect(f.calls()).toBe(2); expect(f.errors).toEqual([]); expect(f.unexpected()).toBe(0);
});
test('fits graphical options in two columns without another extraction request', async ({ page }, testInfo) => {
  const labels = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const f = await setup(page, undefined, result => {
    if (!object(result) || !Array.isArray(result.questions)) throw new Error('FIXTURE');
    return { ...result, questions: result.questions.map((question: unknown) => {
      if (!object(question) || !object(question.problem) || !Array.isArray(question.sources)) throw new Error('FIXTURE_QUESTION');
      return { ...question, problem: { ...question.problem, options: labels.map(label => ({ label, text: `Graph ${label}: frequency and time.` })), optionsComplete: true }, sources: question.sources.map((source: unknown, index: number) => {
        if (!object(source)) throw new Error('FIXTURE_SOURCE');
        return index ? source : { ...source, kind: 'illustrations', regions: labels.map(label => ({ id: `graph-${label}`, role: 'option', optionLabel: label, alt: `Graph ${label}`, x: .1, y: .1, width: .6, height: .6 })) };
      }) };
    }) };
  });
  await open(page); await process(page); expect(f.calls()).toBe(2);
  await page.getByText('预览导出内容', { exact: true }).click();
  const options = page.locator('[data-pdf-question="1"] .print-copy-options');
  await expect(options).toHaveClass(/has-diagrams/); await expect(options.locator('li')).toHaveCount(8);
  expect(await options.evaluate(element => getComputedStyle(element).display)).toBe('grid');
  const first = await options.locator('li').nth(0).boundingBox(); const second = await options.locator('li').nth(1).boundingBox();
  expect(first).not.toBeNull(); expect(second).not.toBeNull();
  if (!first || !second) throw new Error('OPTION_BOUNDS');
  expect(Math.abs(first.y - second.y)).toBeLessThan(2); expect(first.x).toBeLessThan(second.x);
  const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF', exact: true }).click();
  const download = await downloaded; const path = testInfo.outputPath('graphical-options.pdf'); await download.saveAs(path);
  expect((await readFile(path)).subarray(0, 5).toString()).toBe('%PDF-');
  expect(f.calls()).toBe(2); expect(f.errors).toEqual([]); expect(f.unexpected()).toBe(0);
});

for (const storageFault of [false, true]) test(`explicit enhancement preserves manual geometry and refresh reuse (${storageFault ? 'save retry' : 'normal'})`, async ({ page }, info) => {
  const f = await setup(page, undefined, undefined, false, false, 8); const originals = await history(page);
  await open(page); await process(page); await page.getByText('图片整理', { exact: true }).click();
  await page.getByRole('button', { name: '当前题目', exact: true }).click(); await page.getByRole('option', { name: '第 2 题', exact: true }).click();
  await page.getByRole('button', { name: '图片来源', exact: true }).click(); await page.getByRole('option').filter({ hasText: 'Necessary colour chart' }).click();
  await page.getByLabel('导出题图旋转角度', { exact: true }).fill('6'); await page.getByLabel('导出裁切left', { exact: true }).fill('5');
  await page.getByRole('button', { name: '更新图像预览', exact: true }).click(); await expect(page.getByText('整理结果已保存，后续导出可复用。', { exact: true })).toBeVisible();
  const cached = await page.evaluate(() => new Promise<{ key: string; value: unknown }[]>((resolve, reject) => { const request = indexedDB.open('solveflow-print-cache'); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result, tx = db.transaction('entries'), values = tx.objectStore('entries').getAll(), keys = tx.objectStore('entries').getAllKeys(); tx.oncomplete = () => { db.close(); resolve(keys.result.map((key, index) => { if (typeof key !== 'string') throw new Error('CACHE_KEY'); return { key, value: values.result[index] }; })); }; tx.onerror = () => reject(tx.error); }; }));
  const candidates = cached.map(row => ({ key: row.key, value: PreparedPrintRecordSchema.parse(row.value) })); const saved = candidates.find(row => Object.values(row.value.layouts).some(layout => layout.assets.length)); if (!saved) throw new Error('PREPARED_CROP');
  const asset = Object.values(saved.value.layouts).flatMap(layout => layout.assets)[0]; if (!asset) throw new Error('ASSET'); const expected = saved.value.images[asset.key]; if (!expected) throw new Error('IMAGE');
  expect(saved.value.adjustments[asset.key]?.rotation).toBe(6); expect(saved.value.adjustments[asset.key]?.crop.left).toBe(.05);
  const legacy = await page.evaluate(async ({ saved, assetKey }) => {
    const image = new Image(); await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('IMAGE')); image.src = saved.value.images[assetKey] ?? ''; });
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height; const context = canvas.getContext('2d'); if (!context) throw new Error('CANVAS'); context.drawImage(image, 0, 0); context.fillStyle = 'rgba(130, 85, 145, .35)'; context.fillRect(0, 0, canvas.width, canvas.height); const legacy = canvas.toDataURL('image/jpeg', .94); canvas.width = 0;
    const value = { ...saved.value, images: { ...saved.value.images, [assetKey]: legacy } };
    await new Promise<void>((resolve, reject) => { const request = indexedDB.open('solveflow-print-cache'); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result, tx = db.transaction(['entries', 'metadata'], 'readwrite'); tx.objectStore('entries').put(value, saved.key); tx.objectStore('metadata').put({ key: saved.key, bytes: new TextEncoder().encode(JSON.stringify(value)).byteLength, usedAt: Date.now() }); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); }; }; });
    return legacy;
  }, { saved, assetKey: asset.key });
  await page.addInitScript(() => { let count = 0; const publish = () => document.documentElement?.setAttribute('data-enhancement-draws', String(count)); document.addEventListener('DOMContentLoaded', publish, { once: true }); const draw = CanvasRenderingContext2D.prototype.drawImage; CanvasRenderingContext2D.prototype.drawImage = new Proxy(draw, { apply(target, context, args) { count++; publish(); return Reflect.apply(target, context, args); } }); });
  await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible(); await open(page); await page.getByRole('button', { name: '纯题目', exact: true }).click(); await preview(page);
  await expect(page.getByAltText('Necessary colour chart', { exact: true })).toHaveAttribute('src', legacy); expect(await page.locator('html').getAttribute('data-enhancement-draws')).toBe('0'); expect(f.calls()).toBe(2);
  await page.getByText('图片整理', { exact: true }).click();
  if (storageFault) await page.evaluate(() => { const put = IDBObjectStore.prototype.put; let fault = true; IDBObjectStore.prototype.put = function(this: IDBObjectStore, value, key) { if (fault && this.transaction.db.name === 'solveflow-print-cache' && this.name === 'entries' && typeof key === 'string' && key.startsWith('prepared-paper-')) { fault = false; throw new DOMException('Synthetic enhancement quota', 'QuotaExceededError'); } return Reflect.apply(put, this, [value, key]); }; });
  await page.getByRole('button', { name: '更新本批清晰化', exact: true }).click();
  if (storageFault) {
    await expect(page.getByText(/清晰化结果尚未保存/)).toBeVisible(); for (const name of ['下载 PDF', '打印 / 保存 PDF', '后台导出']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
    const draws = await page.locator('html').getAttribute('data-enhancement-draws'); await page.getByRole('button', { name: '重试保存整理', exact: true }).click(); await expect(page.getByRole('button', { name: '重试保存整理', exact: true })).toHaveCount(0); expect(await page.locator('html').getAttribute('data-enhancement-draws')).toBe(draws);
  } else await expect(page.getByText('已更新 1 张图示清晰化，旋转和裁切保持不变。', { exact: true })).toBeVisible();
  await expect(page.getByAltText('Necessary colour chart', { exact: true })).toHaveAttribute('src', expected);
  await page.getByRole('button', { name: '更新本批清晰化', exact: true }).click(); await expect(page.getByText('图示清晰化已是当前结果，旋转和裁切保持不变。', { exact: true })).toBeVisible();
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF', exact: true }).click(); const download = await pending; const path = info.outputPath('enhanced-figures.pdf'); await download.saveAs(path); expect((await readFile(path)).toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(2);
  await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible(); await open(page); await page.getByRole('button', { name: '纯题目', exact: true }).click(); await preview(page); await expect(page.getByAltText('Necessary colour chart', { exact: true })).toHaveAttribute('src', expected);
  expect(await page.locator('html').getAttribute('data-enhancement-draws')).toBe('0'); expect(await history(page)).toEqual(originals); expect(f.calls()).toBe(2); expect(f.unexpected()).toBe(0); expect(f.errors).toEqual([]);
});

async function perspectiveChart(page: Page) {
  await page.getByText('图片整理', { exact: true }).click();
  await page.getByRole('button', { name: '当前题目', exact: true }).click(); await page.getByRole('option', { name: '第 2 题', exact: true }).click();
  await page.getByRole('button', { name: '图片来源', exact: true }).click(); await page.getByRole('option', { name: /Necessary colour chart/ }).click();
  await page.getByText('四角校正', { exact: true }).click();
  await expect(page.getByTestId('print-perspective-stage')).toHaveAttribute('data-ready', 'true');
}
async function perspectiveCoordinates(page: Page) {
  await page.getByText('精确坐标', { exact: true }).click();
  for (const [name, x, y] of [['左上', 10, 5], ['右上', 90, -5], ['右下', 105, 95], ['左下', 5, 105]] as const) {
    await page.getByLabel(`${name}横向校正坐标`, { exact: true }).fill(String(x));
    await page.getByLabel(`${name}纵向校正坐标`, { exact: true }).fill(String(y));
  }
}
test('explicit four-corner perspective persists, repeats from the source and reaches the PDF', async ({ page }, info) => {
  const f = await setup(page), originals = await history(page); await open(page); await process(page); await perspectiveChart(page);
  const original = await page.getByAltText('导出源图', { exact: true }).getAttribute('src');
  await page.getByLabel('导出题图旋转角度').fill('3'); await page.getByLabel('导出裁切left').fill('5');
  await page.getByRole('button', { name: '更新图像预览', exact: true }).click(); await expect(page.getByText('整理结果已保存，后续导出可复用。', { exact: true })).toBeVisible();
  await perspectiveCoordinates(page); const apply = page.getByRole('button', { name: '应用四角校正', exact: true }); await apply.click();
  await expect(page.getByLabel('导出题图旋转角度')).toHaveValue('0'); await expect(apply).toBeEnabled();
  await expect(page.getByLabel('导出裁切left')).toHaveValue('0'); await expect(page.getByLabel('导出裁切right')).toHaveValue('100');
  const corrected = await page.getByAltText('整理后题图', { exact: true }).getAttribute('src'); expect(corrected).not.toBe(original);
  await apply.click(); await expect(apply).toBeEnabled(); await expect(page.getByAltText('整理后题图', { exact: true })).toHaveAttribute('src', corrected ?? 'MISSING');
  await expect(page.getByAltText('导出源图', { exact: true })).toHaveAttribute('src', original ?? 'MISSING');
  await preview(page); await expect(page.getByAltText('Necessary colour chart', { exact: true })).toHaveAttribute('src', corrected ?? 'MISSING');
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF', exact: true }).click(); const download = await pending;
  const path = info.outputPath('perspective.pdf'); await download.saveAs(path); expect((await readFile(path)).toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(2);
  await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible(); await open(page); await perspectiveChart(page);
  await page.getByText('精确坐标', { exact: true }).click(); await expect(page.getByLabel('左上横向校正坐标')).toHaveValue('10'); await expect(page.getByLabel('右下纵向校正坐标')).toHaveValue('95');
  await expect(page.getByAltText('整理后题图', { exact: true })).toHaveAttribute('src', corrected ?? 'MISSING');
  await page.getByRole('button', { name: '恢复裁片', exact: true }).click(); await expect(page.getByRole('button', { name: '恢复裁片', exact: true })).toBeEnabled();
  await expect(page.getByAltText('整理后题图', { exact: true })).toHaveAttribute('src', original ?? 'MISSING');
  expect(await history(page)).toEqual(originals); expect(f.calls()).toBe(2); expect(f.unexpected()).toBe(0); expect(f.errors).toEqual([]);
});
test('four-corner handles support dragging, keyboard adjustment and invalid-range guards on short screens', async ({ page }, info) => {
  const f = await setup(page), originals = await history(page); await open(page); await process(page); await perspectiveChart(page);
  const before = await page.getByAltText('整理后题图', { exact: true }).getAttribute('src');
  const handle = page.getByRole('button', { name: /^左上校正点/ }); await handle.scrollIntoViewIfNeeded();
  const box = await page.getByAltText('四角校正底图').boundingBox(), hit = await handle.boundingBox(); if (!box || !hit) throw new Error('PERSPECTIVE_BOUNDS');
  await page.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width * .08, box.y + box.height * .12, { steps: 5 }); await page.mouse.up();
  await handle.press('ArrowRight'); await page.getByText('精确坐标', { exact: true }).click();
  await expect(page.getByLabel('左上横向校正坐标')).toHaveValue('8.5'); await expect(page.getByLabel('左上纵向校正坐标')).toHaveValue('12');
  const signed = page.getByLabel('右上纵向校正坐标'); await signed.fill(''); await signed.pressSequentially('-5.5'); await expect(signed).toHaveValue('-5.5');
  await page.getByLabel('右上横向校正坐标').fill('900'); await expect(page.getByRole('button', { name: '应用四角校正', exact: true })).toBeDisabled();
  expect(await page.locator('.pdf-dialog-body').evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await page.getByLabel('右上横向校正坐标').fill('100');
  await page.setViewportSize({ width: 390, height: 320 }); await page.getByLabel('左上横向校正坐标').fill('99'); await page.getByLabel('左上纵向校正坐标').fill('99');
  await expect(page.getByRole('button', { name: '应用四角校正', exact: true })).toBeDisabled(); await expect(page.getByText('四角不可交叉、越界或过于接近。', { exact: true })).toBeVisible();
  await expect(page.getByAltText('整理后题图', { exact: true })).toHaveAttribute('src', before ?? 'MISSING');
  expect(await page.locator('.pdf-dialog-body').evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await page.getByRole('button', { name: '重置四角', exact: true }).click(); await expect(page.getByRole('button', { name: '应用四角校正', exact: true })).toBeEnabled();
  await page.screenshot({ path: info.outputPath('perspective-short-screen.png') }); expect(await history(page)).toEqual(originals); expect(f.calls()).toBe(2); expect(f.errors).toEqual([]);
});
for (const fault of ['processing', 'storage'] as const) test(`four-corner correction retains recoverable state after ${fault} failure`, async ({ page }) => {
  const f = await setup(page), originals = await history(page); await open(page); await process(page); await perspectiveChart(page); await perspectiveCoordinates(page);
  const before = await page.getByAltText('整理后题图', { exact: true }).getAttribute('src');
  await page.evaluate(fault => {
    document.documentElement.dataset.perspectiveDraws = '0'; const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = new Proxy(draw, { apply(target, context, args) { document.documentElement.dataset.perspectiveDraws = String(Number(document.documentElement.dataset.perspectiveDraws) + 1); return Reflect.apply(target, context, args); } });
    if (fault === 'processing') { const read = CanvasRenderingContext2D.prototype.getImageData; let fail = true; CanvasRenderingContext2D.prototype.getImageData = new Proxy(read, { apply(target, context, args) { if (fail) { fail = false; throw new Error('Synthetic perspective processing fault'); } return Reflect.apply(target, context, args); } }); }
    else { const put = IDBObjectStore.prototype.put; let fail = true; IDBObjectStore.prototype.put = function(this: IDBObjectStore, value, key) { if (fail && this.transaction.db.name === 'solveflow-print-cache' && this.name === 'entries' && typeof key === 'string' && key.startsWith('prepared-paper-')) { fail = false; throw new DOMException('Synthetic perspective quota', 'QuotaExceededError'); } return Reflect.apply(put, this, [value, key]); }; }
  }, fault);
  const apply = page.getByRole('button', { name: '应用四角校正', exact: true }); await apply.click(); await expect(page.getByRole('alert')).toBeVisible(); await expect(apply).toBeEnabled();
  if (fault === 'processing') {
    await expect(page.getByAltText('整理后题图', { exact: true })).toHaveAttribute('src', before ?? 'MISSING'); await expect(page.getByRole('button', { name: '重试保存整理', exact: true })).toHaveCount(0);
    await apply.click(); await expect(page.getByRole('alert')).toHaveCount(0); await expect(apply).toBeEnabled();
  } else {
    for (const name of ['下载 PDF', '打印 / 保存 PDF', '后台导出']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
    const corrected = await page.getByAltText('整理后题图', { exact: true }).getAttribute('src'); expect(corrected).not.toBe(before);
    const draws = await page.locator('html').getAttribute('data-perspective-draws'); await page.getByRole('button', { name: '重试保存整理', exact: true }).click(); await expect(page.getByRole('button', { name: '重试保存整理', exact: true })).toHaveCount(0);
    await expect(page.getByAltText('整理后题图', { exact: true })).toHaveAttribute('src', corrected ?? 'MISSING'); expect(await page.locator('html').getAttribute('data-perspective-draws')).toBe(draws);
  }
  const corrected = await page.getByAltText('整理后题图', { exact: true }).getAttribute('src'); expect(corrected).not.toBe(before);
  await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible(); await open(page); await perspectiveChart(page); await expect(page.getByAltText('整理后题图', { exact: true })).toHaveAttribute('src', corrected ?? 'MISSING');
  expect(await history(page)).toEqual(originals); expect(f.calls()).toBe(2); expect(f.unexpected()).toBe(0); expect(f.errors).toEqual([]);
});

for (const [field, text] of [['导出题图旋转角度', '-.75'], ['导出裁切left', '12.55']] as const) test(`manual numeric drafts survive sequential typing and processing retry (${field})`, async ({ page }, info) => {
  const f = await setup(page), originals = await history(page); await open(page); await process(page); await perspectiveChart(page);
  const before = await page.getByAltText('整理后题图', { exact: true }).getAttribute('src');
  const angle = page.getByLabel('导出题图旋转角度'), left = page.getByLabel('导出裁切left');
  await angle.fill('-.75'); await left.fill('12.55'); const typed = page.getByLabel(field); await typed.fill(''); await typed.pressSequentially(text); await expect(typed).toHaveValue(text);
  const enhance = page.getByLabel('清晰化题图'); await enhance.setChecked(!await enhance.isChecked()); await expect(typed).toHaveValue(text);
  await page.evaluate(() => { const draw = CanvasRenderingContext2D.prototype.drawImage; let fail = true; CanvasRenderingContext2D.prototype.drawImage = new Proxy(draw, { apply(target, context, args) { if (fail) { fail = false; throw new Error('Synthetic numeric preview processing fault'); } return Reflect.apply(target, context, args); } }); });
  const apply = page.getByRole('button', { name: '更新图像预览', exact: true }); await apply.click(); await expect(page.getByRole('alert')).toBeVisible(); await expect(apply).toBeEnabled();
  await expect(typed).toHaveValue(text); await expect(page.getByAltText('整理后题图', { exact: true })).toHaveAttribute('src', before ?? 'MISSING');
  await apply.click(); await expect(page.getByRole('alert')).toHaveCount(0); await expect(page.getByText('整理结果已保存，后续导出可复用。', { exact: true })).toBeVisible();
  await expect(angle).toHaveValue('-0.75'); await expect(left).toHaveValue('12.55'); const corrected = await page.getByAltText('整理后题图', { exact: true }).getAttribute('src'); expect(corrected).not.toBe(before);
  await preview(page); await expect(page.getByAltText('Necessary colour chart', { exact: true })).toHaveAttribute('src', corrected ?? 'MISSING');
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF', exact: true }).click(); const path = info.outputPath(field === '导出裁切left' ? 'crop-decimal.pdf' : 'rotation-decimal.pdf'); await (await pending).saveAs(path); expect((await readFile(path)).toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(2);
  await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible(); await open(page); await perspectiveChart(page);
  await expect(angle).toHaveValue('-0.75'); await expect(left).toHaveValue('12.55'); await expect(page.getByAltText('整理后题图', { exact: true })).toHaveAttribute('src', corrected ?? 'MISSING');
  expect(await history(page)).toEqual(originals); expect(f.calls()).toBe(2); expect(f.unexpected()).toBe(0); expect(f.errors).toEqual([]);
});

test('manual numeric drafts guard invalid ranges and recover through Escape, restore and source changes', async ({ page }, info) => {
  const f = await setup(page), originals = await history(page); await open(page); await process(page); await perspectiveChart(page);
  const before = await page.getByAltText('整理后题图', { exact: true }).getAttribute('src'); const angle = page.getByLabel('导出题图旋转角度'), left = page.getByLabel('导出裁切left'), apply = page.getByRole('button', { name: '更新图像预览', exact: true });
  await angle.fill(''); await angle.pressSequentially('-'); await expect(angle).toHaveValue('-'); await expect(apply).toBeDisabled(); await expect(angle).toHaveAttribute('aria-invalid', 'true');
  await angle.fill('16'); await expect(apply).toBeDisabled(); await expect(page.getByText('旋转角度需为 -15° 至 15° 的完整数字。', { exact: true })).toBeVisible(); await expect(page.getByAltText('整理后题图', { exact: true })).toHaveAttribute('src', before ?? 'MISSING');
  await angle.press('Escape'); await expect(angle).toHaveValue('0'); await expect(page.getByRole('button', { name: '关闭导出', exact: true })).toBeVisible(); await expect(apply).toBeEnabled();
  await angle.press('ArrowDown'); await expect(angle).toHaveValue('-0.25'); await angle.press('ArrowUp'); await expect(angle).toHaveValue('0');
  await left.fill('97'); await expect(apply).toBeDisabled(); await expect(page.getByText('裁切边界需为 0% 至 100% 的完整数字，宽高至少保留 5%。', { exact: true })).toBeVisible();
  expect(await page.locator('.pdf-dialog-body').evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true); await page.screenshot({ path: info.outputPath('numeric-range-feedback.png') });
  await left.fill('36.2'); await page.getByLabel('导出裁切right').fill('41.2'); await expect(apply).toBeEnabled();
  await page.getByRole('button', { name: '恢复裁片', exact: true }).click(); await expect(left).toHaveValue('0'); await expect(apply).toBeEnabled();
  await angle.fill('8'); await page.getByRole('button', { name: '应用四角校正', exact: true }).click(); await expect(angle).toHaveValue('0'); await expect(apply).toBeEnabled();
  await angle.fill('-'); await page.getByRole('button', { name: '当前题目', exact: true }).click(); await page.getByRole('option', { name: '第 1 题', exact: true }).click(); await expect(angle).toHaveValue('0'); await expect(apply).toBeEnabled();
  expect(await history(page)).toEqual(originals); expect(f.calls()).toBe(2); expect(f.unexpected()).toBe(0); expect(f.errors).toEqual([]);
});

test('manual numeric preview saves retry without reprocessing the pending geometry', async ({ page }) => {
  const f = await setup(page), originals = await history(page); await open(page); await process(page); await perspectiveChart(page);
  await page.getByLabel('导出题图旋转角度').fill('-.75'); await page.getByLabel('导出裁切left').fill('12.55');
  await page.evaluate(() => {
    document.documentElement.dataset.numericDraws = '0'; const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = new Proxy(draw, { apply(target, context, args) { document.documentElement.dataset.numericDraws = String(Number(document.documentElement.dataset.numericDraws) + 1); return Reflect.apply(target, context, args); } });
    const put = IDBObjectStore.prototype.put; let fail = true; IDBObjectStore.prototype.put = function(this: IDBObjectStore, value, key) { if (fail && this.transaction.db.name === 'solveflow-print-cache' && this.name === 'entries' && typeof key === 'string' && key.startsWith('prepared-paper-')) { fail = false; throw new DOMException('Synthetic numeric quota', 'QuotaExceededError'); } return Reflect.apply(put, this, [value, key]); };
  });
  await page.getByRole('button', { name: '更新图像预览', exact: true }).click(); await expect(page.getByRole('alert')).toBeVisible();
  for (const name of ['下载 PDF', '打印 / 保存 PDF', '后台导出']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
  const corrected = await page.getByAltText('整理后题图', { exact: true }).getAttribute('src'), draws = await page.locator('html').getAttribute('data-numeric-draws');
  await expect(page.getByLabel('导出题图旋转角度')).toHaveValue('-0.75'); await expect(page.getByLabel('导出裁切left')).toHaveValue('12.55');
  await page.getByRole('button', { name: '重试保存整理', exact: true }).click(); await expect(page.getByRole('button', { name: '重试保存整理', exact: true })).toHaveCount(0); expect(await page.locator('html').getAttribute('data-numeric-draws')).toBe(draws);
  await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible(); await open(page); await perspectiveChart(page); await expect(page.getByAltText('整理后题图', { exact: true })).toHaveAttribute('src', corrected ?? 'MISSING');
  await expect(page.getByLabel('导出题图旋转角度')).toHaveValue('-0.75'); await expect(page.getByLabel('导出裁切left')).toHaveValue('12.55');
  expect(await history(page)).toEqual(originals); expect(f.calls()).toBe(2); expect(f.unexpected()).toBe(0); expect(f.errors).toEqual([]);
});

test('paper enhancement retains pale filled diagrams through preparation and cache reuse', async ({ page }, info) => {
  const f = await setup(page);
  await page.evaluate(ids => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('solveflow-local'); request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('documents', 'readwrite'), store = tx.objectStore('documents');
      const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 550;
      const context = canvas.getContext('2d'); if (!context) { db.close(); reject(new Error('CANVAS')); return; }
      context.fillStyle = '#f0f0f0'; context.fillRect(0, 0, 900, 550);
      context.fillStyle = '#dcdcdc'; context.fillRect(490, 185, 220, 220);
      context.strokeStyle = '#222'; context.lineWidth = 2; context.beginPath(); context.moveTo(510, 220); context.lineTo(510, 390); context.lineTo(690, 390); context.stroke();
      context.fillStyle = '#dc1e32'; context.fillRect(680, 210, 8, 8);
      const image = canvas.toDataURL('image/jpeg', .98);
      for (const id of ids) {
        const key = `record.${id}`, read = store.get(key);
        read.onsuccess = () => { try { const value: unknown = JSON.parse(read.result); if (!value || typeof value !== 'object' || Array.isArray(value) || !('image' in value)) throw new Error('RECORD'); value.image = image; store.put(JSON.stringify(value), key); } catch (error) { tx.abort(); reject(error); } };
      }
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), ids);
  await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible();
  const originals = await history(page); await open(page); await process(page); await perspectiveChart(page);
  const raw = await page.getByAltText('导出源图', { exact: true }).getAttribute('src');
  const processed = await page.getByAltText('整理后题图', { exact: true }).getAttribute('src');
  const measurements = await page.evaluate(async uris => {
    return Promise.all(uris.map(async uri => {
      if (!uri) throw new Error('IMAGE_MISSING'); const image = new Image(); image.src = uri; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d'); if (!context) throw new Error('CANVAS'); context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      function patch(x: number, y: number) { let sum = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const index = ((Math.floor(y * canvas.height) + dy) * canvas.width + Math.floor(x * canvas.width) + dx) * 4; for (let channel = 0; channel < 3; channel++) sum += data[index + channel] ?? 0; } return sum / 75; }
      return { paper: patch(.04, .04), fill: patch(.5, .5) };
    }));
  }, [raw, processed]);
  const before = measurements[0], after = measurements[1]; if (!before || !after) throw new Error('MEASUREMENTS');
  await info.attach('pale-fill-contrast', { body: JSON.stringify({ before, after }), contentType: 'application/json' });
  expect(before.paper - before.fill).toBeGreaterThan(15); expect(after.paper).toBeGreaterThan(245);
  expect(after.paper - after.fill).toBeGreaterThanOrEqual((before.paper - before.fill) * .4);
  await page.locator('.pdf-image-review').screenshot({ path: info.outputPath('pale-fill-preview.png') });
  await page.getByRole('button', { name: '更新本批清晰化', exact: true }).click(); await expect(page.getByRole('button', { name: '更新本批清晰化', exact: true })).toBeEnabled();
  await expect(page.getByAltText('整理后题图', { exact: true })).toHaveAttribute('src', processed ?? 'MISSING');
  await preview(page); await expect(page.getByAltText('Necessary colour chart', { exact: true })).toHaveAttribute('src', processed ?? 'MISSING');
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF', exact: true }).click();
  const path = info.outputPath('pale-fill.pdf'); await (await download).saveAs(path);
  expect((await readFile(path)).toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(2);
  await page.addInitScript(() => {
    let draws = 0; const draw = CanvasRenderingContext2D.prototype.drawImage;
    Object.defineProperty(window, '__paleCacheDraws', { get: () => draws });
    CanvasRenderingContext2D.prototype.drawImage = new Proxy(draw, { apply(target, context, args) { draws++; return Reflect.apply(target, context, args); } });
  });
  await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible(); await open(page); await perspectiveChart(page);
  await expect(page.getByAltText('整理后题图', { exact: true })).toHaveAttribute('src', processed ?? 'MISSING');
  const redraws: unknown = await page.evaluate(() => Reflect.get(window, '__paleCacheDraws')); expect(redraws).toBe(0);
  expect(await history(page)).toEqual(originals); expect(f.calls()).toBe(2); expect(f.unexpected()).toBe(0); expect(f.errors).toEqual([]);
});

for (const action of ['恢复裁片', '自动整理本图'] as const) test(`image geometry drafts reset after successful ${action}, including unchanged saved geometry`, async ({ page }, info) => {
  const f = await setup(page), originals = await history(page); await open(page); await process(page); await perspectiveChart(page);
  await page.getByText('精确坐标', { exact: true }).click();
  const x = page.getByLabel('左上横向校正坐标'), y = page.getByLabel('左上纵向校正坐标'), rotation = page.getByLabel('导出题图旋转角度');
  await x.fill('12.5'); await y.fill('8.5'); await rotation.fill('1.25');
  await page.getByLabel('清晰化题图', { exact: true }).uncheck();
  await expect(x).toHaveValue('12.5'); await expect(rotation).toHaveValue('1.25');
  await page.getByRole('button', { name: '更新图像预览', exact: true }).click(); await expect(page.getByRole('button', { name: '更新图像预览', exact: true })).toBeEnabled();
  await expect(x).toHaveValue('12.5');
  const reset = page.getByRole('button', { name: action, exact: true }); await reset.click(); await expect(reset).toBeEnabled();
  await expect(x).toHaveValue('0'); await expect(y).toHaveValue('0'); await expect(rotation).toHaveValue('0');
  await x.fill('-'); await rotation.fill('-'); await expect(page.getByRole('button', { name: '应用四角校正', exact: true })).toBeDisabled();
  await reset.click(); await expect(reset).toBeEnabled();
  await expect(x).toHaveValue('0'); await expect(y).toHaveValue('0'); await expect(rotation).toHaveValue('0');
  await expect(page.getByLabel('右下横向校正坐标')).toHaveValue('100'); await expect(page.getByLabel('右下纵向校正坐标')).toHaveValue('100');
  await expect(page.getByRole('button', { name: '应用四角校正', exact: true })).toBeEnabled();
  await page.screenshot({ path: info.outputPath('geometry-drafts-reset.png') });
  expect(await history(page)).toEqual(originals); expect(f.calls()).toBe(2); expect(f.unexpected()).toBe(0); expect(f.errors).toEqual([]);
});

for (const action of ['自动整理本图', '应用四角校正'] as const) test(`image geometry drafts survive ${action} processing failure until a successful retry`, async ({ page }) => {
  const f = await setup(page), originals = await history(page); await open(page); await process(page); await perspectiveChart(page);
  await page.getByText('精确坐标', { exact: true }).click();
  const x = page.getByLabel('左上横向校正坐标'), rotation = page.getByLabel('导出题图旋转角度'); await x.fill('12.5'); await rotation.fill('-');
  const before = await page.getByAltText('整理后题图', { exact: true }).getAttribute('src');
  await page.evaluate(() => { const read = CanvasRenderingContext2D.prototype.getImageData; let fail = true; CanvasRenderingContext2D.prototype.getImageData = new Proxy(read, { apply(target, context, args) { if (fail) { fail = false; throw new Error('Synthetic geometry draft processing fault'); } return Reflect.apply(target, context, args); } }); });
  const apply = page.getByRole('button', { name: action, exact: true }); await apply.click(); await expect(page.getByRole('alert')).toBeVisible(); await expect(apply).toBeEnabled();
  await expect(x).toHaveValue('12.5'); await expect(rotation).toHaveValue('-');
  await expect(page.getByAltText('整理后题图', { exact: true })).toHaveAttribute('src', before ?? 'MISSING');
  await expect(page.getByRole('button', { name: '重试保存整理', exact: true })).toHaveCount(0);
  await apply.click(); await expect(page.getByRole('alert')).toHaveCount(0); await expect(apply).toBeEnabled();
  await expect(rotation).toHaveValue('0'); await expect(x).toHaveValue(action === '自动整理本图' ? '0' : '12.5');
  expect(await history(page)).toEqual(originals); expect(f.calls()).toBe(2); expect(f.unexpected()).toBe(0); expect(f.errors).toEqual([]);
});

test('image geometry drafts reset on pixel commit but storage retry preserves a later unapplied draft', async ({ page }, info) => {
  const f = await setup(page), originals = await history(page); await open(page); await process(page); await perspectiveChart(page);
  await page.getByText('精确坐标', { exact: true }).click(); const x = page.getByLabel('左上横向校正坐标'); await x.fill('12.5');
  const raw = await page.getByAltText('导出源图', { exact: true }).getAttribute('src');
  await page.evaluate(() => {
    let draws = 0; const draw = CanvasRenderingContext2D.prototype.drawImage;
    Object.defineProperty(window, '__geometryDraftDraws', { get: () => draws });
    CanvasRenderingContext2D.prototype.drawImage = new Proxy(draw, { apply(target, context, args) { draws++; return Reflect.apply(target, context, args); } });
    const put = IDBObjectStore.prototype.put; let fail = true;
    IDBObjectStore.prototype.put = function(this: IDBObjectStore, value, key) { if (fail && this.transaction.db.name === 'solveflow-print-cache' && this.name === 'entries' && typeof key === 'string' && key.startsWith('prepared-paper-')) { fail = false; throw new DOMException('Synthetic geometry draft quota', 'QuotaExceededError'); } return Reflect.apply(put, this, [value, key]); };
  });
  await page.getByRole('button', { name: '恢复裁片', exact: true }).click(); await expect(page.getByRole('alert')).toBeVisible();
  await expect(x).toHaveValue('0'); await expect(page.getByAltText('整理后题图', { exact: true })).toHaveAttribute('src', raw ?? 'MISSING');
  for (const name of ['下载 PDF', '打印 / 保存 PDF', '后台导出']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
  await x.fill('3.5'); await page.getByLabel('导出题图旋转角度').fill('-'); const draws: unknown = await page.evaluate(() => Reflect.get(window, '__geometryDraftDraws'));
  await page.getByRole('button', { name: '重试保存整理', exact: true }).click(); await expect(page.getByRole('button', { name: '重试保存整理', exact: true })).toHaveCount(0);
  await expect(x).toHaveValue('3.5'); await expect(page.getByLabel('导出题图旋转角度')).toHaveValue('-'); expect(await page.evaluate(() => Reflect.get(window, '__geometryDraftDraws'))).toBe(draws);
  await expect(page.getByAltText('整理后题图', { exact: true })).toHaveAttribute('src', raw ?? 'MISSING');
  await preview(page); await expect(page.getByAltText('Necessary colour chart', { exact: true })).toHaveAttribute('src', raw ?? 'MISSING');
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF', exact: true }).click(); const path = info.outputPath('geometry-draft-restored.pdf'); await (await pending).saveAs(path);
  expect((await readFile(path)).toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(2);
  await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible(); await open(page); await perspectiveChart(page); await page.getByText('精确坐标', { exact: true }).click();
  await expect(page.getByLabel('左上横向校正坐标')).toHaveValue('0'); await expect(page.getByLabel('导出题图旋转角度')).toHaveValue('0'); await expect(page.getByAltText('整理后题图', { exact: true })).toHaveAttribute('src', raw ?? 'MISSING');
  expect(await history(page)).toEqual(originals); expect(f.calls()).toBe(2); expect(f.unexpected()).toBe(0); expect(f.errors).toEqual([]);
});

test('image geometry drafts preserve uncommitted corners across equivalent saved geometry and normalize explicit apply', async ({ page }) => {
  const f = await setup(page), originals = await history(page); await open(page); await process(page); await perspectiveChart(page); await perspectiveCoordinates(page);
  const apply = page.getByRole('button', { name: '应用四角校正', exact: true }); await apply.click(); await expect(apply).toBeEnabled();
  const x = page.getByLabel('左上横向校正坐标'), rotation = page.getByLabel('导出题图旋转角度'); await x.fill('12.5'); await rotation.fill('1.25');
  await page.getByLabel('清晰化题图', { exact: true }).uncheck(); await expect(x).toHaveValue('12.5'); await expect(rotation).toHaveValue('1.25');
  await page.getByRole('button', { name: '更新图像预览', exact: true }).click(); await expect(page.getByRole('button', { name: '更新图像预览', exact: true })).toBeEnabled();
  await expect(x).toHaveValue('12.5'); await expect(rotation).toHaveValue('1.25');
  await apply.click(); await expect(apply).toBeEnabled(); await expect(x).toHaveValue('12.5'); await expect(rotation).toHaveValue('0');
  await x.fill('12.500'); await rotation.fill('-'); await apply.click(); await expect(apply).toBeEnabled();
  await expect(x).toHaveValue('12.5'); await expect(rotation).toHaveValue('0');
  const saved = await page.getByAltText('整理后题图', { exact: true }).getAttribute('src'); await x.fill('14.5'); await page.getByLabel('清晰化题图', { exact: true }).check();
  await expect(x).toHaveValue('14.5'); await expect(page.getByAltText('整理后题图', { exact: true })).toHaveAttribute('src', saved ?? 'MISSING');
  await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible(); await open(page); await perspectiveChart(page); await page.getByText('精确坐标', { exact: true }).click();
  await expect(page.getByLabel('左上横向校正坐标')).toHaveValue('12.5'); await expect(page.getByLabel('清晰化题图', { exact: true })).not.toBeChecked();
  await expect(page.getByAltText('整理后题图', { exact: true })).toHaveAttribute('src', saved ?? 'MISSING');
  expect(await history(page)).toEqual(originals); expect(f.calls()).toBe(2); expect(f.unexpected()).toBe(0); expect(f.errors).toEqual([]);
});

async function imageCancelCache(page: Page) {
  return page.evaluate(() => new Promise<{ entries: string; metadata: string }>((resolve, reject) => {
    const request = indexedDB.open('solveflow-print-cache'); request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction(['entries', 'metadata']);
      const entries = tx.objectStore('entries').getAll(undefined, 513), keys = tx.objectStore('entries').getAllKeys(undefined, 513), metadata = tx.objectStore('metadata').getAll(undefined, 513);
      tx.oncomplete = () => {
        db.close(); if (entries.result.length > 512 || metadata.result.length > 512) { reject(new Error('CACHE_CAPACITY')); return; }
        // Serialize in the browser so optional undefined fields do not become null in transport.
        resolve({ entries: JSON.stringify(keys.result.map((key: unknown, index: number) => [key, entries.result[index]])), metadata: JSON.stringify(metadata.result) });
      };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
}
async function installImageCancelGate(page: Page) {
  await page.evaluate(() => {
    const root = document.documentElement, timeout = window.setTimeout.bind(window), nativeGet = IDBObjectStore.prototype.get;
    let draws = 0, puts = 0, aborts = 0, commits = 0, controllerAbortDepth = 0, readSeen = false, heldPixel: (() => void) | null = null, heldStorage: IDBTransaction | null = null, clearPixel = () => {};
    const canvases = new Set<HTMLCanvasElement>(); root.dataset.imageCancelExpired = 'false';
    const publish = () => { root.dataset.imageCancelDraws = String(draws); root.dataset.imageCancelPuts = String(puts); root.dataset.imageCancelAborts = String(aborts); root.dataset.imageCancelCommits = String(commits); }; publish();
    AbortController.prototype.abort = new Proxy(AbortController.prototype.abort, { apply(target, receiver, args) {
      controllerAbortDepth++; try { return Reflect.apply(target, receiver, args); } finally { controllerAbortDepth--; }
    } });
    IDBTransaction.prototype.abort = new Proxy(IDBTransaction.prototype.abort, { apply(target, receiver, args) {
      // The cache timeout also aborts: only the synchronous controller-abort chain proves cancellation caused this call.
      if (receiver === heldStorage) root.dataset.imageCancelAbortFromController = String(controllerAbortDepth > 0);
      return Reflect.apply(target, receiver, args);
    } });
    window.addEventListener('sample-image-cancel-canvases', () => { root.dataset.imageCancelCanvases = String([...canvases].filter(canvas => canvas.width * canvas.height > 0).length); });
    window.addEventListener('release-image-cancel-pixel', () => {
      const callback = heldPixel; if (!callback) throw new Error('NO_PIXEL_GATE'); heldPixel = null; clearPixel(); root.dataset.imageCancelPhase = 'pixel-released'; timeout(callback, 0);
    });
    HTMLCanvasElement.prototype.getContext = new Proxy(HTMLCanvasElement.prototype.getContext, { apply(target, receiver, args) { canvases.add(receiver); return Reflect.apply(target, receiver, args); } });
    CanvasRenderingContext2D.prototype.drawImage = new Proxy(CanvasRenderingContext2D.prototype.drawImage, { apply(target, receiver, args) { draws++; publish(); return Reflect.apply(target, receiver, args); } });
    CanvasRenderingContext2D.prototype.getImageData = new Proxy(CanvasRenderingContext2D.prototype.getImageData, { apply(target, receiver, args) { readSeen = true; return Reflect.apply(target, receiver, args); } });
    window.setTimeout = new Proxy(window.setTimeout, { apply(target, receiver, args) {
      const callback: unknown = args[0];
      if (root.dataset.imageCancelArm === 'pixel' && readSeen && typeof callback === 'function' && Number(args[1]) === 0) {
        root.dataset.imageCancelArm = ''; heldPixel = () => Reflect.apply(callback, window, args.slice(2)); root.dataset.imageCancelPhase = 'pixel-held';
        const safety = timeout(() => { root.dataset.imageCancelExpired = 'true'; window.dispatchEvent(new Event('release-image-cancel-pixel')); }, 10000); clearPixel = () => clearTimeout(safety); return -39001;
      }
      return Reflect.apply(target, receiver, args);
    } });
    IDBObjectStore.prototype.put = new Proxy(IDBObjectStore.prototype.put, { apply(target, receiver, args) {
      const prepared = receiver.transaction.db.name === 'solveflow-print-cache' && receiver.name === 'entries' && typeof args[1] === 'string' && args[1].startsWith('prepared-paper-');
      if (!prepared) return Reflect.apply(target, receiver, args);
      puts++; publish(); const tx: IDBTransaction = receiver.transaction;
      tx.addEventListener('complete', () => { commits++; if (heldStorage === tx) heldStorage = null; publish(); });
      tx.addEventListener('abort', () => { aborts++; if (heldStorage === tx) heldStorage = null; publish(); });
      const request = Reflect.apply(target, receiver, args);
      if (root.dataset.imageCancelArm === 'storage') {
        root.dataset.imageCancelArm = ''; heldStorage = tx; root.dataset.imageCancelPhase = 'storage-held';
        const metadata = tx.objectStore('metadata'), deadline = performance.now() + 10000;
        // A native read chain keeps this real transaction active; a delayed write callback alone would auto-commit.
        const pump = () => {
          if (heldStorage !== tx) return;
          if (performance.now() >= deadline) { root.dataset.imageCancelExpired = 'true'; heldStorage = null; tx.abort(); return; }
          const pending: IDBRequest = Reflect.apply(nativeGet, metadata, ['__image_cancel_keepalive__']); pending.onsuccess = pump;
        }; pump();
      }
      return request;
    } });
  });
}
for (const phase of ['pixel', 'storage'] as const) test(`image adjustment cancellation preserves the correct commit boundary (${phase})`, async ({ page }) => {
  const f = await setup(page), originals = await history(page); await open(page); await process(page); await perspectiveChart(page);
  await page.getByText('精确坐标', { exact: true }).click(); const before = await imageCancelCache(page);
  const x = page.getByLabel('左上横向校正坐标', { exact: true }), rotation = page.getByLabel('导出题图旋转角度', { exact: true }), image = page.getByAltText('整理后题图', { exact: true });
  const previous = await image.getAttribute('src'), raw = await page.getByAltText('导出源图', { exact: true }).getAttribute('src'); if (!previous || !raw) throw new Error('IMAGE_FIXTURE');
  await x.fill('12.5'); await rotation.fill('-'); await installImageCancelGate(page);
  await page.evaluate(phase => { document.documentElement.dataset.imageCancelArm = phase; document.documentElement.dataset.imageCancelPhase = 'armed'; document.documentElement.dataset.imageCancelAbortFromController = 'pending'; }, phase);
  const apply = page.getByRole('button', { name: '应用四角校正', exact: true }), retry = page.getByRole('button', { name: '重试保存整理', exact: true }), html = page.locator('html');
  await page.getByRole('button', { name: phase === 'pixel' ? '应用四角校正' : '恢复裁片', exact: true }).click(); await expect(html).toHaveAttribute('data-image-cancel-phase', `${phase}-held`);
  await expect(image).toHaveAttribute('src', phase === 'pixel' ? previous : raw);
  await page.getByRole('button', { name: '取消导出', exact: true }).click();
  if (phase === 'pixel') {
    await expect(page.getByRole('button', { name: '正在取消…', exact: true })).toBeDisabled(); await expect(apply).toBeDisabled();
    await page.evaluate(() => window.dispatchEvent(new Event('release-image-cancel-pixel')));
  }
  await expect(apply).toBeEnabled(); await expect(page.getByRole('alert')).toHaveCount(0); expect(await imageCancelCache(page)).toEqual(before);
  if (phase === 'pixel') {
    await expect(x).toHaveValue('12.5'); await expect(rotation).toHaveValue('-'); await expect(retry).toHaveCount(0); await expect(image).toHaveAttribute('src', previous);
    await expect(html).toHaveAttribute('data-image-cancel-puts', '0'); await expect(html).toHaveAttribute('data-image-cancel-commits', '0');
    await apply.click(); await expect(apply).toBeEnabled(); await expect(image).not.toHaveAttribute('src', previous); await expect(rotation).toHaveValue('0');
  } else {
    await expect(x).toHaveValue('0'); await expect(rotation).toHaveValue('0'); await expect(retry).toBeVisible();
    await expect(html).toHaveAttribute('data-image-cancel-aborts', '1'); await expect(html).toHaveAttribute('data-image-cancel-commits', '0'); await expect(html).toHaveAttribute('data-image-cancel-abort-from-controller', 'true');
    await expect(page.locator('.pdf-preparation')).toHaveAttribute('data-state', 'unsaved');
    for (const name of ['下载 PDF', '打印 / 保存 PDF', '后台导出']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
    await x.fill('3.5'); await rotation.fill('-'); await page.evaluate(() => { document.documentElement.dataset.imageCancelArm = 'storage'; document.documentElement.dataset.imageCancelPhase = 'armed'; document.documentElement.dataset.imageCancelAbortFromController = 'pending'; }); await retry.click();
    await expect(html).toHaveAttribute('data-image-cancel-phase', 'storage-held'); await page.getByRole('button', { name: '取消导出', exact: true }).click(); await expect(apply).toBeEnabled();
    await expect(retry).toBeVisible(); await expect(html).toHaveAttribute('data-image-cancel-aborts', '2'); await expect(html).toHaveAttribute('data-image-cancel-abort-from-controller', 'true'); expect(await imageCancelCache(page)).toEqual(before);
    for (const name of ['下载 PDF', '打印 / 保存 PDF', '后台导出']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
    await expect(x).toHaveValue('3.5'); await expect(rotation).toHaveValue('-'); await retry.click(); await expect(retry).toHaveCount(0);
    await expect(x).toHaveValue('3.5'); await expect(rotation).toHaveValue('-'); await expect(image).toHaveAttribute('src', raw); await expect(html).toHaveAttribute('data-image-cancel-draws', '0');
    const rows: unknown = JSON.parse((await imageCancelCache(page)).entries); if (!Array.isArray(rows)) throw new Error('CACHE_ROWS');
    const adjustments = rows.flatMap((row: unknown) => {
      if (!Array.isArray(row) || typeof row[0] !== 'string') throw new Error('CACHE_ROW'); if (!row[0].startsWith('prepared-paper-')) return [];
      const value = PreparedPrintRecordSchema.parse(row[1]); return Object.entries(value.images).flatMap(([key, image]) => image === raw ? [value.adjustments[key]] : []);
    });
    expect(adjustments).toEqual([{ rotation: 0, crop: { left: 0, top: 0, right: 1, bottom: 1 }, enhance: false }]);
  }
  await page.evaluate(() => window.dispatchEvent(new Event('sample-image-cancel-canvases'))); await expect(html).toHaveAttribute('data-image-cancel-canvases', '0'); await expect(html).toHaveAttribute('data-image-cancel-expired', 'false');
  await expect(page.getByRole('button', { name: '下载 PDF', exact: true })).toBeEnabled(); const saved = await image.getAttribute('src'), entries = (await imageCancelCache(page)).entries;
  await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible(); await open(page); await perspectiveChart(page); await page.getByText('精确坐标', { exact: true }).click();
  await expect(x).toHaveValue(phase === 'pixel' ? '12.5' : '0'); await expect(rotation).toHaveValue('0'); await expect(image).toHaveAttribute('src', saved ?? 'MISSING'); expect((await imageCancelCache(page)).entries).toBe(entries);
  expect(await history(page)).toEqual(originals); expect(f.calls()).toBe(2); expect(f.unexpected()).toBe(0); expect(f.errors).toEqual([]);
});

async function preparedCacheEntries(page: Page) {
  return page.evaluate(() => new Promise<string>((resolve, reject) => {
    const request = indexedDB.open('solveflow-print-cache'); request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result; const tx = db.transaction('entries'); const read = tx.objectStore('entries').getAll(); const keys = tx.objectStore('entries').getAllKeys();
      tx.oncomplete = () => { db.close(); resolve(JSON.stringify({ keys: keys.result, entries: read.result })); }; tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }));
}
async function installPreparedReadRecovery(page: Page, failure: 'storage' | 'cancel') {
  await page.addInitScript(failure => {
    if (sessionStorage.getItem('prepared-read-recovery-installed')) return;
    sessionStorage.setItem('prepared-read-recovery-installed', 'true');
    const transaction = IDBDatabase.prototype.transaction, put = IDBObjectStore.prototype.put, draw = CanvasRenderingContext2D.prototype.drawImage;
    const descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete'), set = descriptor?.set;
    if (!descriptor || !set) throw new Error('PREPARED_READ_HANDLER');
    let failures = failure === 'storage' ? 2 : 1, armed = true;
    const state = { reads: 0, writes: 0, draws: 0, held: false, released: 0, expired: false, release: () => {} };
    Object.defineProperty(window, '__preparedReadRecovery', { value: state });
    IDBDatabase.prototype.transaction = function(...args: Parameters<IDBDatabase['transaction']>) {
      const stores = typeof args[0] === 'string' ? [args[0]] : Array.from(args[0]);
      if (this.name !== 'solveflow-print-cache' || args[1] !== 'readwrite' || !stores.includes('entries')) return Reflect.apply(transaction, this, args);
      state.reads++; if (failures > 0) { failures--; throw new DOMException('PREPARED_READ_FAILURE', 'UnknownError'); }
      const tx: IDBTransaction = Reflect.apply(transaction, this, args);
      if (armed) {
        armed = false;
        Object.defineProperty(tx, 'oncomplete', { configurable: true, set(callback: unknown) {
          if (typeof callback !== 'function') return Reflect.apply(set, tx, [callback]);
          return Reflect.apply(set, tx, [function(event: Event) {
            state.held = true;
            const timer = window.setTimeout(() => { state.expired = true; state.release(); }, 10000);
            state.release = () => { state.release = () => {}; clearTimeout(timer); state.held = false; state.released++; Reflect.apply(callback, tx, [event]); };
          }]);
        } });
      }
      return tx;
    };
    IDBObjectStore.prototype.put = function(...args: Parameters<IDBObjectStore['put']>) { if (this.transaction.db.name === 'solveflow-print-cache' && this.name === 'entries') state.writes++; return Reflect.apply(put, this, args); };
    CanvasRenderingContext2D.prototype.drawImage = new Proxy(draw, { apply(target, context, args) { state.draws++; return Reflect.apply(target, context, args); } });
  }, failure);
}
for (const configured of [false, true]) for (const failure of ['storage', 'cancel'] as const) test(`cached preparation read ${failure} recovers ${configured ? 'with' : 'without'} configured models without repeating work`, async ({ page }, info) => {
  const f = await setup(page); const originals = await history(page); await open(page); await process(page);
  await perspectiveChart(page); await page.getByLabel('导出题图旋转角度', { exact: true }).fill('3.5'); await page.getByRole('button', { name: '更新图像预览', exact: true }).click();
  await expect(page.getByText('整理结果已保存，后续导出可复用。', { exact: true })).toBeVisible();
  const manualImage = await page.getByAltText('整理后题图', { exact: true }).getAttribute('src'); if (!manualImage) throw new Error('MANUAL_IMAGE');
  const entries = await preparedCacheEntries(page); expect(f.calls()).toBe(2);
  if (!configured) await page.route('**/__solveflow/web-env', route => route.fulfill({ status: 404 }));
  await installPreparedReadRecovery(page, failure); await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible(); await open(page);
  const feedback = page.getByTestId('pdf-operation-feedback'), retry = page.getByRole('button', { name: '重试读取整理结果', exact: true });
  await expect(feedback).toContainText('已整理内容'); await expect(feedback).toBeFocused();
  if (!configured) await expect(page.getByRole('button', { name: '整理题目与图示', exact: true })).toBeDisabled();
  await expect(retry).toBeVisible(); await expect(retry).toBeInViewport(); await expect(retry).toBeEnabled();
  const count = page.getByLabel('导出份数', { exact: true }); await count.fill('-');
  await page.getByText('逐题参照答案与错误作答', { exact: true }).click(); const reference = page.getByLabel('第1题参照答案', { exact: true }); await reference.fill('C');
  try {
    if (failure === 'storage') {
      await retry.click(); await expect(feedback).toContainText('已整理内容'); await expect(feedback).toBeFocused(); await expect(retry).toBeEnabled();
      expect(await page.evaluate(() => Reflect.get(window, '__preparedReadRecovery').reads)).toBe(2);
    }
    await retry.evaluate(button => { if (!(button instanceof HTMLElement)) throw new Error('RETRY_BUTTON'); button.click(); button.click(); });
    await expect.poll(() => page.evaluate(() => Reflect.get(window, '__preparedReadRecovery').held)).toBe(true);
    await expect(retry).toBeDisabled();
    if (failure === 'cancel') await page.getByRole('button', { name: '取消导出', exact: true }).click();
    await page.evaluate(() => Reflect.get(window, '__preparedReadRecovery').release());
    if (failure === 'cancel') {
      await expect(feedback).toHaveCount(0); await expect(retry).toBeEnabled(); await expect(page.locator('.pdf-preparation')).toHaveAttribute('data-state', 'pending'); await retry.click();
    }
    await expect(page.getByText('已整理，可直接复用', { exact: true })).toBeVisible(); await expect(retry).toHaveCount(0);
    await expect(page.getByText('已重新读取整理结果，未调用模型。', { exact: true })).toBeVisible();
    const state = await page.evaluate(() => { const state = Reflect.get(window, '__preparedReadRecovery'); return { reads: state.reads, writes: state.writes, draws: state.draws, released: state.released, expired: state.expired }; });
    expect(state.reads).toBe(4); expect(state.writes).toBe(0); expect(state.draws).toBe(0); expect(state.released).toBe(1); expect(state.expired).toBe(false);
    expect(await preparedCacheEntries(page)).toBe(entries); expect(f.calls()).toBe(2); expect(await history(page)).toEqual(originals);
    await expect(count).toHaveValue('-'); await expect(reference).toHaveValue('C'); await expect(page.locator('iframe')).toHaveCount(0); await count.fill('1');
    await perspectiveChart(page); await expect(page.getByLabel('导出题图旋转角度', { exact: true })).toHaveValue('3.5'); await expect(page.getByAltText('整理后题图', { exact: true })).toHaveAttribute('src', manualImage);
    const downloadEvent = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF', exact: true }).click();
    const download = await downloadEvent; await download.saveAs(info.outputPath('cache-read-recovered.pdf'));
    expect((await readFile(info.outputPath('cache-read-recovered.pdf'))).subarray(0, 5).toString()).toBe('%PDF-');
    await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible(); await open(page);
    await expect(page.getByText('已整理，可直接复用', { exact: true })).toBeVisible(); expect(await preparedCacheEntries(page)).toBe(entries); expect(await history(page)).toEqual(originals);
    expect(f.calls()).toBe(2); expect(f.unexpected()).toBe(0); expect(f.errors).toEqual([]);
  } finally { await page.evaluate(() => Reflect.get(window, '__preparedReadRecovery')?.release()).catch(() => undefined); }
});
