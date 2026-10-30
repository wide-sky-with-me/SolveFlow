import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { LocalRecordSchema, StoredLocalRecordSchema, StoredLocalImageSchema } from '../../packages/contracts/src/local.js';
import { configureLocalModel, lastModelInput, modelSse } from './local-fixture.js';
import { materialTargetRange } from '../helpers/material-target-range.js';
import { questionConversations } from '../../packages/client/src/question-conversations.js';

test.use({ reducedMotion: 'reduce' });
async function seed(page: Page, grouped = false, count = 3) {
  await page.goto('/'); await expect(page.getByTestId('launch-screen')).toBeHidden();
  const ids = Array.from({ length: count }, () => randomUUID()); const batchId = randomUUID(); const runIds = ids.map(() => randomUUID());
  await page.evaluate(({ ids, batchId, runIds, grouped }) => new Promise<void>((resolve, reject) => {
    const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 300; const context = canvas.getContext('2d'); if (!context) throw new Error('CANVAS');
    context.fillStyle = '#fff'; context.fillRect(0, 0, 600, 300); context.fillStyle = '#222'; context.font = '24px sans-serif'; context.fillText('Original question', 30, 80);
    const image = canvas.toDataURL('image/jpeg'); const createdAt = new Date().toISOString();
    const request = indexedDB.open('solveflow-local'); request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result; const tx = db.transaction('documents', 'readwrite'); const store = tx.objectStore('documents');
      ids.forEach((id, index) => store.put(JSON.stringify({ schemaVersion: 1, image, batch: { id: batchId, title: 'Batch shared supplements', createdAt, exam: 'general', position: index + 1 }, session: { schemaVersion: 1, id, subject: 'math', createdAt, upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', width: 600, height: 300, bytes: atob(image.split(',')[1] ?? '').length, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` }, runs: [{ schemaVersion: 1, id: runIds[index], sessionId: id, seq: 1, createdAt, status: 'completed', imageIds: [id], message: '', outcome: { schemaVersion: 1, status: 'completed', verified: false, verificationStatus: 'not_requested', verification: null, warning: null, candidate: { schemaVersion: 1, kind: 'answer', problem: { text: `Question ${index + 1}: x+1=3`, subject: 'math', uncertainties: [] }, answer: 'OLD x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [], ...(grouped && !index ? { questions: [1, 2].map(number => ({ number, answer: `OLD ${number}`, stepIds: [], figureIds: [] })) } : {}) } } }] } }), `record.${id}`));
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), { ids, batchId, runIds, grouped });
  await page.goto(`/?session=${ids[0]}`); await expect(page.getByTestId('current-batch')).toBeVisible(); await configureLocalModel(page);
  return { ids, batchId };
}
async function readDocument(page: Page, key: string) {
  return page.evaluate(key => new Promise<string>((resolve, reject) => {
    const request = indexedDB.open('solveflow-local'); request.onerror = () => reject(request.error);
    request.onsuccess = () => { const db = request.result; const read = db.transaction('documents').objectStore('documents').get(key); read.onerror = () => reject(read.error); read.onsuccess = () => { db.close(); typeof read.result === 'string' ? resolve(read.result) : reject(new Error('MISSING_DOCUMENT')); }; };
  }), key);
}
async function selectFiles(page: Page, count = 2, onEntry?: () => Promise<void>) {
  await page.getByRole('button', { name: '批次操作', exact: true }).click(); await page.getByRole('button', { name: '批量补图并重答', exact: true }).click();
  await onEntry?.();
  const encoded = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 300; const context = canvas.getContext('2d'); if (!context) throw new Error('CANVAS'); context.fillStyle = '#3366bb'; context.fillRect(0, 0, 600, 300); return canvas.toDataURL('image/jpeg').split(',')[1] ?? ''; });
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: '选择批量补图', exact: true }).click();
  await (await chooser).setFiles(Array.from({ length: count }, (_, index) => ({ name: `shared-${index + 1}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from(encoded, 'base64') })));
  if (count <= 8) await expect(page.getByTestId('material-import-row')).toHaveCount(count);
  else { await expect(page.getByText(`已选择 ${count} 张补图`, { exact: true })).toBeVisible(); await expect(page.getByTestId('material-import-row').first()).toBeVisible(); }
}
async function openPhotoTools(page: Page, image: number) {
  await page.getByRole('button', { name: `编辑第${image}张补图`, exact: true }).click();
  await expect(page.getByTestId('material-photo-tools')).toBeVisible();
}
async function assignRange(page: Page, image: number, range: string) {
  await page.getByRole('button', { name: `分配第${image}张补图`, exact: true }).click();
  await expect(page.getByTestId('material-photo-tools')).toHaveCount(0);
  const checkboxes = await page.getByRole('checkbox', { name: /^第\d+张题图$/ }).all();
  const targets = await Promise.all(checkboxes.map(async checkbox => {
    const position = Number((await checkbox.getAttribute('aria-label'))?.match(/\d+/)?.[0]);
    return { id: String(position), position, text: '' };
  }));
  const selected = new Set(materialTargetRange(range, targets));
  for (const [index, checkbox] of checkboxes.entries()) await checkbox.setChecked(selected.has(targets[index]!.id));
}
async function appendFiles(page: Page, names: string[]) {
  const encoded = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 300; const context = canvas.getContext('2d'); if (!context) throw new Error('CANVAS'); context.fillStyle = '#5a9933'; context.fillRect(0, 0, 600, 300); return canvas.toDataURL('image/jpeg').split(',')[1] ?? ''; });
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: '继续添加补图', exact: true }).click();
  await (await chooser).setFiles(names.map(name => ({ name, mimeType: 'image/jpeg', buffer: Buffer.from(encoded, 'base64') })));
}
async function trackDraftUrls(page: Page) {
  await page.evaluate(() => {
    const active = new Set<string>(), originals = new Set<string>(); const create = URL.createObjectURL.bind(URL); const revoke = URL.revokeObjectURL.bind(URL);
    const publish = () => { document.documentElement.setAttribute('data-supplement-draft-urls', String(active.size)); document.documentElement.setAttribute('data-supplement-original-urls', String(originals.size)); };
    URL.createObjectURL = value => { const uri = create(value); active.add(uri); if (value instanceof File) originals.add(uri); publish(); return uri; };
    URL.revokeObjectURL = uri => { active.delete(uri); originals.delete(uri); publish(); revoke(uri); }; publish();
  });
}
async function completedRecipient(page: Page, id: string) {
  const record = StoredLocalRecordSchema.safeParse(JSON.parse(await readDocument(page, `record.${id}`)));
  return record.success && record.data.session.runs.length === 2 ? record.data.session.runs.at(-1)?.status : 'waiting';
}
function modelFixture(page: Page) {
  const solves: unknown[] = []; let verifications = 0; let unexpected = 0;
  page.route('https://**', route => { unexpected++; return route.abort(); });
  page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    const body: unknown = route.request().postDataJSON(); const input = lastModelInput(body);
    const verifier = typeof input === 'object' && input !== null && 'role' in input && input.role === 'verifier';
    if (verifier) verifications++; else solves.push(input);
    const checked = ['transcription', 'logic', 'arithmetic', 'diagram'];
    const value = verifier ? { schemaVersion: 1, verdict: 'pass', checked, issues: [], coverage: [{ verdict: 'pass', checked }], evidenceStatus: 'sufficient' } : { schemaVersion: 1, kind: 'answer', problem: { text: 'Supplemented x+1=3', subject: 'math', uncertainties: [] }, answer: 'NEW x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
    await route.fulfill({ contentType: 'text/event-stream', body: modelSse(value, body) });
  });
  return { solves, verifications: () => verifications, unexpected: () => unexpected };
}

async function configureTestConcurrency(page: Page, solver: number) {
  await page.evaluate(solver => {
    const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';
    for (const node of document.querySelectorAll('*')) {
      const key = Object.keys(node).find(name => name.startsWith('__reactFiber$')); let fiber: unknown = key ? Reflect.get(node, key) : null;
      for (let depth = 0; object(fiber) && depth < 100; depth++, fiber = fiber.return) {
        const props = fiber.memoizedProps;
        if (object(props) && object(props.runtime) && object(props.runtime.engine) && typeof props.runtime.engine.configureConcurrency === 'function') {
          Reflect.apply(props.runtime.engine.configureConcurrency, props.runtime.engine, [{ solver, verifier: 1 }]); return;
        }
      }
    }
    throw new Error('ISOLATED_RUNTIME_NOT_FOUND');
  }, solver);
}

for (const slots of [1, 2]) test(`manual regeneration works while supplement reanswer is active with ${slots} solver slots and the success notice expires`, async ({ page }) => {
  const solves: string[] = []; let reviews = 0; let held = false; let release = () => {}; let ids: string[] = []; const failedRequests: string[] = [];
  const gate = new Promise<void>(resolve => { release = resolve; });
  page.route('https://**', route => route.abort());
  page.on('requestfailed', request => { if (request.url().includes('fixture-model.invalid')) failedRequests.push(request.failure()?.errorText ?? 'failed'); });
  page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    const body: unknown = route.request().postDataJSON(); const input = lastModelInput(body);
    if (!input || typeof input !== 'object') throw new Error('INPUT');
    const imageCount = body && typeof body === 'object' && 'messages' in body && Array.isArray(body.messages) ? body.messages.flatMap((message: unknown) => message && typeof message === 'object' && 'content' in message && Array.isArray(message.content) ? message.content.filter((part: unknown) => part && typeof part === 'object' && 'type' in part && part.type === 'image_url') : []).length : 0;
    if (imageCount !== 1 && imageCount !== 2) throw new Error('IMAGE_COUNT');
    const id = ids[imageCount === 2 ? 1 : 0]!; const verifier = 'role' in input && input.role === 'verifier';
    if (verifier) reviews++; else { solves.push(id); if (id === ids[1]) { held = true; await gate; } }
    const value = verifier ? { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'logic'], issues: [] } : { schemaVersion: 1, kind: 'answer', problem: { text: 'Independent reanswer', subject: 'math', uncertainties: [] }, answer: 'NEW x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
    await route.fulfill({ contentType: 'text/event-stream', body: modelSse(value, body) });
  });
  try {
    ({ ids } = await seed(page)); await configureTestConcurrency(page, slots);
    const untouched = await readDocument(page, `record.${ids[2]}`);
    await selectFiles(page, 1); await assignRange(page, 1, '2'); await page.clock.install();
    await page.getByRole('button', { name: '保存补图并自动重答', exact: true }).click();
    const notice = page.getByText('已为 1 张题图保存补图，并加入重新解答队列。', { exact: true });
    await expect(notice).toBeVisible(); await expect.poll(() => held).toBe(true);
    const regenerate = page.getByRole('button', { name: '重新解答', exact: true }); await expect(regenerate).toBeEnabled();
    await regenerate.evaluate(node => { if (!(node instanceof HTMLButtonElement)) throw new Error('REGENERATE_BUTTON'); node.click(); node.click(); });
    if (slots === 1) {
      await expect(page.getByTestId('batch-queued-notice')).toHaveText('等待重新解答');
      await expect(regenerate).toBeDisabled(); expect(solves).toEqual([ids[1]]);
    } else await expect.poll(() => completedRecipient(page, ids[0]!)).toBe('completed');
    await page.clock.runFor(5500); await expect(notice).toHaveCount(0);
    expect(solves.filter(id => id === ids[1])).toHaveLength(1); expect(failedRequests).toEqual([]);
    expect(await readDocument(page, `record.${ids[2]}`)).toBe(untouched);
    release(); await expect.poll(() => completedRecipient(page, ids[0]!)).toBe('completed'); await expect.poll(() => completedRecipient(page, ids[1]!)).toBe('completed');
    expect(solves.filter(id => id === ids[0])).toHaveLength(1); await expect.poll(() => reviews).toBe(2);
    expect(await readDocument(page, `record.${ids[2]}`)).toBe(untouched); expect(failedRequests).toEqual([]);
  } finally { release(); }
});

test('supplement success notice expires after real elapsed time and a fresh notice can be dismissed', async ({ page }, info) => {
  const models = modelFixture(page); const { ids } = await seed(page);
  await selectFiles(page, 1); await assignRange(page, 1, '1');
  const text = '已为 1 张题图保存补图，并加入重新解答队列。';
  const notice = page.getByText(text, { exact: true });
  const savedAt = Date.now(); await page.getByRole('button', { name: '保存补图并自动重答', exact: true }).click();
  await expect(notice).toBeVisible();
  await expect.poll(() => completedRecipient(page, ids[0]!)).toBe('completed');
  // Real browser timers: no Playwright clock or forced state updates.
  await expect(notice).toHaveCount(0, { timeout: 8000 });
  expect(Date.now() - savedAt).toBeGreaterThanOrEqual(4500);
  const timing = JSON.stringify({ elapsedMs: Date.now() - savedAt, fakeClock: false, modelRequests: models.solves.length });
  await writeFile(info.outputPath('real-time-expiry.json'), timing);
  await info.attach('real-time-expiry', { contentType: 'application/json', body: timing });
  await selectFiles(page, 1); await assignRange(page, 1, '2');
  await page.getByRole('button', { name: '保存补图并自动重答', exact: true }).click();
  await expect(notice).toBeVisible(); await page.getByRole('button', { name: '关闭提示', exact: true }).click();
  await expect(notice).toHaveCount(0);
  await expect.poll(() => completedRecipient(page, ids[1]!)).toBe('completed');
  expect(models.solves).toHaveLength(2); expect(models.verifications()).toBe(2); expect(models.unexpected()).toBe(0);
});

test('reuses assigned images, automatically reanswers each recipient once, and exports the supplemented batch', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); const models = modelFixture(page); const { ids } = await seed(page);
  const original = await Promise.all(ids.map(id => readDocument(page, `record.${id}`))); const oldRun = LocalRecordSchema.parse(JSON.parse(original[0]!)).session.runs[0];
  await selectFiles(page); await expect(page.getByRole('button', { name: '保存补图并自动重答', exact: true })).toBeDisabled();
  await assignRange(page, 1, '1-2');
  await page.getByRole('button', { name: '分配第2张补图', exact: true }).click(); await expect(page.getByTestId('material-photo-tools')).toHaveCount(0); await page.getByRole('checkbox', { name: '第2张题图', exact: true }).check();
  await page.getByRole('checkbox', { name: '第2张题图', exact: true }).dblclick(); await expect(page.getByRole('button', { name: '关闭大图', exact: true })).toBeVisible(); await page.getByRole('button', { name: '关闭大图', exact: true }).click();
  for (const colorScheme of ['light', 'dark'] as const) { await page.emulateMedia({ colorScheme }); await page.screenshot({ path: info.outputPath(`assignments-${colorScheme}.png`) }); }
  await expect(page.getByText('已分配 2 / 2 张补图 · 2 张题图将重新解答', { exact: true })).toBeVisible(); expect(models.solves).toHaveLength(0);
  await page.getByRole('button', { name: '保存补图并自动重答', exact: true }).click();
  await expect.poll(() => completedRecipient(page, ids[1]!)).toBe('completed');
  const first = StoredLocalRecordSchema.parse(JSON.parse(await readDocument(page, `record.${ids[0]}`))); const second = StoredLocalRecordSchema.parse(JSON.parse(await readDocument(page, `record.${ids[1]}`)));
  expect(first.materials).toHaveLength(1); expect(second.materials).toHaveLength(2); expect(first.materials?.[0]?.id).not.toBe(second.materials?.[0]?.id);
  expect(first.session.runs[0]).toEqual(oldRun); expect(first.session.runs).toHaveLength(2); expect(second.session.runs).toHaveLength(2);
  expect(first.session.runs.at(-1)?.imageIds).toEqual(first.activeImageIds); expect(second.session.runs.at(-1)?.imageIds).toEqual(second.activeImageIds);
  const sharedA = await readDocument(page, `material.${ids[0]}.${first.materials?.[0]?.id}`); const sharedB = await readDocument(page, `material.${ids[1]}.${second.materials?.[0]?.id}`);
  expect(StoredLocalImageSchema.parse(JSON.parse(sharedA)).image).toBe(StoredLocalImageSchema.parse(JSON.parse(sharedB)).image);
  expect(await readDocument(page, `record.${ids[2]}`)).toBe(original[2]); expect(models.solves).toHaveLength(2); expect(models.verifications()).toBe(2); expect(models.unexpected()).toBe(0); expect(errors).toEqual([]);
  await page.getByRole('button', { name: '批次操作', exact: true }).click(); await page.getByRole('button', { name: '导出本批 PDF', exact: true }).click(); await page.getByRole('button', { name: '快速原文（最快）', exact: true }).click();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF', exact: true }).click(); const path = info.outputPath('batch-materials.pdf'); await (await download).saveAs(path);
  expect((await readFile(path)).subarray(0, 5).toString()).toBe('%PDF-'); expect(models.solves).toHaveLength(2);
});

test('cancelling a reusable assignment saves no images and dispatches no models', async ({ page }) => {
  const models = modelFixture(page); const { ids } = await seed(page); const before = await Promise.all(ids.map(id => readDocument(page, `record.${id}`)));
  await selectFiles(page, 1); await assignRange(page, 1, '1-3'); await page.getByRole('button', { name: '取消补图', exact: true }).click();
  await expect(page.getByText('批量补图分配', { exact: true })).toHaveCount(0);
  expect(await Promise.all(ids.map(id => readDocument(page, `record.${id}`)))).toEqual(before); expect(models.solves).toEqual([]); expect(models.verifications()).toBe(0);
});

test('thumbnail clicks only switch bindings and the separate transparent edit button opens the chosen image', async ({ page }, info) => {
  const models = modelFixture(page); const { ids } = await seed(page); const before = await Promise.all(ids.map(id => readDocument(page, `record.${id}`)));
  await selectFiles(page, 2); await assignRange(page, 1, '1'); await assignRange(page, 2, '2-3');
  for (const position of [1, 2, 1]) {
    await page.getByRole('button', { name: `分配第${position}张补图`, exact: true }).click();
    await expect(page.getByTestId('material-photo-tools')).toHaveCount(0);
    await expect(page.getByRole('img', { name: `补图${position}缩略图：shared-${position}.jpg`, exact: true })).toBeVisible();
    expect(await checkedPositions(page)).toEqual(position === 1 ? [1] : [2, 3]);
  }
  const edit = page.getByRole('button', { name: '编辑第2张补图', exact: true });
  expect(await edit.evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  await page.screenshot({ path: info.outputPath('thumbnail-bindings.png') });
  // Editing another card also selects it; closing the tools keeps its binding context.
  await edit.click(); await expect(page.getByTestId('material-photo-tools')).toBeVisible();
  await expect(page.getByTestId('material-photo-tools')).toContainText('shared-2.jpg');
  await expect(page.getByRole('button', { name: '查看补图2', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭图片操作', exact: true }).click();
  expect(await checkedPositions(page)).toEqual([2, 3]);
  await page.getByRole('button', { name: '移除第1张', exact: true }).click();
  await expect(page.getByTestId('material-photo-tools')).toHaveCount(0); await expect(page.getByTestId('material-import-row')).toHaveCount(1);
  await expect(page.getByRole('img', { name: '补图1缩略图：shared-2.jpg', exact: true })).toBeVisible();
  expect(await checkedPositions(page)).toEqual([2, 3]);
  await page.getByRole('button', { name: '取消补图', exact: true }).click();
  expect(await Promise.all(ids.map(id => readDocument(page, `record.${id}`)))).toEqual(before); expect(models.solves).toHaveLength(0);
});

async function targetPoint(page: Page, position: number) {
  const box = await page.getByRole('checkbox', { name: `第${position}张题图`, exact: true }).boundingBox();
  if (!box) throw new Error('TARGET_BOX'); return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
async function checkedPositions(page: Page) {
  return page.getByRole('checkbox', { name: /^第\d+张题图$/ }).evaluateAll(nodes => nodes.filter(node => node.getAttribute('aria-checked') === 'true').map(node => Number(node.getAttribute('aria-label')?.match(/\d+/)?.[0])));
}

test('mouse sweep paints targets once, erases without touching other bindings, and releases outside the grid', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Mouse sweep; touch keeps scrolling and single selection.');
  const models = modelFixture(page); await seed(page, false, 8); await selectFiles(page, 2);
  const first = await targetPoint(page, 1), fifth = await targetPoint(page, 5), second = await targetPoint(page, 2);
  await page.mouse.move(first.x, first.y); await page.mouse.down(); await page.mouse.move(fifth.x, fifth.y); await page.mouse.move(second.x, second.y);
  await expect.poll(() => checkedPositions(page)).toEqual([1, 2, 3, 4, 5]);
  await page.mouse.move(20, 20); await page.mouse.up();
  await expect.poll(() => checkedPositions(page)).toEqual([1, 2, 3, 4, 5]);
  const third = await targetPoint(page, 3);
  await page.mouse.move(third.x, third.y); await page.mouse.down(); await page.mouse.move(fifth.x, fifth.y); await page.mouse.up();
  await expect.poll(() => checkedPositions(page)).toEqual([1, 2]);
  await assignRange(page, 2, '6-8'); await assignRange(page, 1, '1-2');
  await expect(page.getByTestId('material-import-row').nth(1)).toContainText('已绑定 3 题');
  await page.getByRole('checkbox', { name: '第3张题图', exact: true }).check();
  await expect.poll(() => checkedPositions(page)).toEqual([1, 2, 3]);
  await page.getByRole('button', { name: '保存补图并自动重答', exact: true }).click();
  await expect.poll(() => models.verifications()).toBe(6); expect(models.solves).toHaveLength(6); expect(models.unexpected()).toBe(0);
});

test('cancelled mouse sweeps restore the draft and Escape leaves the workbench open', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Mouse cancellation lifecycle.');
  const models = modelFixture(page); const { ids } = await seed(page, false, 6); const before = await Promise.all(ids.map(id => readDocument(page, `record.${id}`)));
  await selectFiles(page, 1); await assignRange(page, 1, '6');
  const pending = await targetPoint(page, 1); await page.mouse.move(pending.x, pending.y); await page.mouse.down(); await page.keyboard.press('Escape'); await page.mouse.up();
  await expect.poll(() => checkedPositions(page)).toEqual([6]);
  for (const cancel of ['escape', 'blur', 'pointercancel']) {
    const first = await targetPoint(page, 1), fourth = await targetPoint(page, 4);
    await page.mouse.move(first.x, first.y); await page.mouse.down(); await page.mouse.move(fourth.x, fourth.y);
    await expect.poll(() => checkedPositions(page)).toEqual([1, 2, 3, 4, 6]);
    if (cancel === 'escape') await page.keyboard.press('Escape');
    else if (cancel === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    else await page.getByRole('group', { name: '补图绑定题号', exact: true }).dispatchEvent('pointercancel', { pointerId: 1 });
    await page.mouse.up();
    await expect(page.getByTestId('batch-material-workbench')).toBeVisible();
    await expect.poll(() => checkedPositions(page)).toEqual([6]);
  }
  await page.getByRole('checkbox', { name: '第2张题图', exact: true }).check();
  await expect.poll(() => checkedPositions(page)).toEqual([2, 6]);
  await page.getByRole('button', { name: '取消补图', exact: true }).click();
  expect(await Promise.all(ids.map(id => readDocument(page, `record.${id}`)))).toEqual(before); expect(models.solves).toHaveLength(0);
});

test('mouse sweep scrolls the bounded workbench and stops scrolling after release', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Mouse edge scrolling.');
  const models = modelFixture(page); await page.setViewportSize({ width: 800, height: 540 }); await seed(page, false, 50); await selectFiles(page, 1);
  await page.getByRole('checkbox', { name: '第1张题图', exact: true }).scrollIntoViewIfNeeded();
  const edge = await page.getByRole('group', { name: '补图绑定题号', exact: true }).evaluate(node => {
    for (let parent = node.parentElement; parent; parent = parent.parentElement) if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight) {
      parent.setAttribute('data-testid', 'material-paint-scroll'); const box = parent.getBoundingClientRect(); return { y: box.bottom - 24, top: parent.scrollTop };
    }
    throw new Error('SCROLL_BODY');
  });
  const first = await targetPoint(page, 1); await page.mouse.move(first.x, first.y); await page.mouse.down(); await page.mouse.move(first.x + 10, first.y); await page.mouse.move(first.x, edge.y);
  await expect.poll(async () => (await checkedPositions(page)).some(position => position >= 34), { timeout: 10000 }).toBe(true);
  await page.mouse.up();
  const body = page.getByTestId('material-paint-scroll'); const top = await body.evaluate(node => node.scrollTop); expect(top).toBeGreaterThan(edge.top);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))));
  expect(await body.evaluate(node => node.scrollTop)).toBe(top);
  await page.getByRole('button', { name: '取消补图', exact: true }).click(); expect(models.solves).toHaveLength(0);
});

test('double click previews either target without changing bindings and keyboard preview is available', async ({ page }) => {
  const models = modelFixture(page); await seed(page); await selectFiles(page, 2); await assignRange(page, 1, '2');
  for (const position of [1, 2]) {
    await page.getByRole('checkbox', { name: `第${position}张题图`, exact: true }).dblclick();
    await expect(page.getByTestId('image-zoom-viewport')).toBeVisible();
    await page.getByRole('button', { name: '关闭大图', exact: true }).click();
    expect(await checkedPositions(page)).toEqual([2]);
  }
  await page.getByRole('checkbox', { name: '第3张题图', exact: true }).press('Alt+Enter');
  await expect(page.getByTestId('image-zoom-viewport')).toBeVisible(); await page.getByRole('button', { name: '关闭大图', exact: true }).click();
  expect(await checkedPositions(page)).toEqual([2]);
  await openPhotoTools(page, 1); await page.getByRole('button', { name: '查看补图1', exact: true }).click();
  await expect(page.getByTestId('image-zoom-viewport')).toBeVisible(); await page.getByRole('button', { name: '关闭大图', exact: true }).click();
  await expect(page.getByTestId('material-photo-tools')).toBeVisible(); await page.getByRole('button', { name: '关闭图片操作', exact: true }).click();
  await page.getByRole('button', { name: '移除第2张', exact: true }).click();
  await expect(page.getByTestId('material-import-row')).toHaveCount(1); await expect(page.getByTestId('material-photo-tools')).toHaveCount(0);
  expect(await checkedPositions(page)).toEqual([2]); expect(models.solves).toHaveLength(0);
  await page.getByRole('button', { name: '取消补图', exact: true }).click();
});

test('continues adding supplements while preserving edits and bindings, and never reuses a removed binding', async ({ page }, info) => {
  const models = modelFixture(page); const { ids } = await seed(page); await trackDraftUrls(page); await selectFiles(page, 1);
  await assignRange(page, 1, '1-2');
  await openPhotoTools(page, 1); await page.getByRole('button', { name: '裁剪第1张', exact: true }).click(); await page.getByRole('button', { name: '精细调整', exact: true }).click(); await page.getByRole('button', { name: '左边界增大', exact: true }).click(); await page.getByRole('button', { name: '使用这张题图', exact: true }).click();
  await openPhotoTools(page, 1); await page.getByRole('button', { name: '旋转第1张', exact: true }).click(); await expect(page.getByRole('button', { name: '关闭图片操作', exact: true })).toBeEnabled(); await page.getByRole('button', { name: '关闭图片操作', exact: true }).click(); await expect(page.getByRole('button', { name: '继续添加补图', exact: true })).toBeEnabled();
  await appendFiles(page, ['extra-2.jpg', 'extra-1.jpg']); await expect(page.getByTestId('material-import-row')).toHaveCount(3);
  await expect(page.getByTestId('material-import-row').first()).toContainText('已绑定 2 题');
  await expect(page.getByTestId('material-import-row').nth(1).getByRole('img', { name: '补图2缩略图：extra-1.jpg', exact: true })).toBeVisible(); await expect(page.getByTestId('material-import-row').nth(1)).toContainText('已绑定 0 题');
  await expect(page.getByTestId('batch-material-assignment-summary')).toHaveText('尚未选择对应题图');
  await expect(page.getByRole('button', { name: '保存补图并自动重答', exact: true })).toBeDisabled();
  await assignRange(page, 2, '2-3'); await assignRange(page, 3, '1');
  await page.getByRole('button', { name: '移除第3张', exact: true }).click();
  await appendFiles(page, ['replacement.jpg']); await expect(page.getByTestId('material-import-row')).toHaveCount(3);
  await expect(page.getByTestId('material-import-row').nth(2).getByRole('img', { name: '补图3缩略图：replacement.jpg', exact: true })).toBeVisible();
  await expect(page.getByTestId('batch-material-assignment-summary')).toHaveText('尚未选择对应题图');
  await expect(page.getByRole('button', { name: '保存补图并自动重答', exact: true })).toBeDisabled();
  await assignRange(page, 3, '1'); expect(models.solves).toHaveLength(0);
  await page.screenshot({ path: info.outputPath('continued-supplements.png') });
  await page.getByRole('button', { name: '保存补图并自动重答', exact: true }).click();
  await expect.poll(() => completedRecipient(page, ids[2]!)).toBe('completed');
  const records = await Promise.all(ids.map(async id => StoredLocalRecordSchema.parse(JSON.parse(await readDocument(page, `record.${id}`)))));
  expect(records.map(record => record.materials?.length)).toEqual([2, 2, 1]);
  expect(records[0]?.materials?.[0]).toMatchObject({ width: 300, height: 588 }); expect(records[1]?.materials?.[0]).toMatchObject({ width: 300, height: 588 });
  expect(models.solves).toHaveLength(3); expect(models.verifications()).toBe(3);
  await expect(page.locator('html')).toHaveAttribute('data-supplement-draft-urls', '0');
  // A second round remains available after the first was submitted.
  await selectFiles(page, 1); await assignRange(page, 1, '3'); await page.getByRole('button', { name: '保存补图并自动重答', exact: true }).click();
  await expect.poll(async () => StoredLocalRecordSchema.parse(JSON.parse(await readDocument(page, `record.${ids[2]}`))).session.runs.length).toBe(3);
  await expect.poll(() => models.verifications()).toBe(4); expect(models.solves).toHaveLength(4);
});

test('cancelled and over-limit additional selections keep the current bindings and release drafts on close', async ({ page }) => {
  const models = modelFixture(page); const { ids } = await seed(page); const before = await Promise.all(ids.map(id => readDocument(page, `record.${id}`)));
  await trackDraftUrls(page); await selectFiles(page, 1); await assignRange(page, 1, '1-2');
  await appendFiles(page, []); await expect(page.getByTestId('material-import-row')).toHaveCount(1); await expect(page.getByTestId('material-import-row').first()).toContainText('已绑定 2 题');
  await appendFiles(page, Array.from({ length: 100 }, (_, index) => `too-many-${index}.jpg`));
  await expect(page.getByRole('alert')).toContainText('本批还可添加99张图片');
  await expect(page.getByTestId('material-import-row')).toHaveCount(1); await expect(page.getByTestId('material-import-row').first()).toContainText('已绑定 2 题');
  await appendFiles(page, ['more.jpg']); await expect(page.getByTestId('material-import-row')).toHaveCount(2);
  await expect(page.locator('html')).toHaveAttribute('data-supplement-original-urls', '2');
  await page.getByRole('button', { name: '取消补图', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-supplement-draft-urls', '0');
  expect(await Promise.all(ids.map(id => readDocument(page, `record.${id}`)))).toEqual(before); expect(models.solves).toHaveLength(0);
});

test('additional selections obey the cumulative original-byte limit and release only the rejected pictures', async ({ page }) => {
  const models = modelFixture(page); await seed(page); await trackDraftUrls(page);
  // Synthetic small JPEGs report 6 MiB each; no large payload or user file is allocated.
  await page.evaluate(() => { Object.defineProperty(File.prototype, 'size', { configurable: true, get: () => 6 * 1024 * 1024 }); });
  await selectFiles(page, 50); await expect(page.getByText('已选择 50 张补图', { exact: true })).toBeVisible();
  await appendFiles(page, Array.from({ length: 40 }, (_, index) => `more-${index}.jpg`));
  await expect(page.getByRole('alert')).toContainText('本次补图累计超过500MB');
  await expect(page.getByText('已选择 50 张补图', { exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-supplement-original-urls', '50');
  await page.getByRole('button', { name: '取消补图', exact: true }).click(); await expect(page.locator('html')).toHaveAttribute('data-supplement-draft-urls', '0');
  expect(models.solves).toHaveLength(0);
});

test('a visual issue rereads the assigned supplement locally and reuses the same crop without an additional model round', async ({ page }) => {
  const imageUrls: string[][] = []; const crops: string[] = []; let reviews = 0; let unexpected = 0;
  page.route('https://**', route => { unexpected++; return route.abort(); });
  page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    const body: unknown = route.request().postDataJSON(); const data = lastModelInput(body);
    const messages = body && typeof body === 'object' && 'messages' in body && Array.isArray(body.messages) ? body.messages : [];
    const urls = messages.flatMap((message: unknown) => message && typeof message === 'object' && 'content' in message && Array.isArray(message.content) ? message.content.flatMap((part: unknown) => part && typeof part === 'object' && 'image_url' in part && part.image_url && typeof part.image_url === 'object' && 'url' in part.image_url && typeof part.image_url.url === 'string' ? [part.image_url.url] : []) : []);
    imageUrls.push(urls);
    const verifier = data && typeof data === 'object' && 'role' in data && data.role === 'verifier';
    if (data && typeof data === 'object' && 'derivedViews' in data) {
      expect(data.derivedViews).toMatchObject({ source: 'issue-regions', count: 1, regions: [{ imageIndex: 1 }] });
      expect(urls).toHaveLength(3); crops.push(urls[2]!);
    }
    const value = verifier ? ++reviews === 1
      ? { schemaVersion: 1, verdict: 'fail', checked: ['transcription'], issues: [{ code: 'TRANSCRIPTION', message: 'Recheck the number in the supplement.', imageRegion: { imageIndex: 1, x: .2, y: .2, width: .4, height: .4 } }] }
      : { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'arithmetic'], issues: [] }
      : { schemaVersion: 1, kind: 'answer', problem: { text: 'Supplemented x+1=3', subject: 'math', uncertainties: [] }, answer: 'NEW x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
    await route.fulfill({ contentType: 'text/event-stream', body: modelSse(value, body) });
  });
  const { ids } = await seed(page, false, 1); await selectFiles(page, 1); await assignRange(page, 1, '1');
  await page.getByRole('button', { name: '保存补图并自动重答', exact: true }).click();
  await expect.poll(() => completedRecipient(page, ids[0]!)).toBe('completed');
  expect(imageUrls).toHaveLength(4); expect(imageUrls.map(urls => urls.length)).toEqual([2, 2, 3, 3]);
  for (const urls of imageUrls) expect(urls.slice(0, 2)).toEqual(imageUrls[0]);
  expect(crops).toHaveLength(2); expect(crops[0]).toBe(crops[1]); expect(unexpected).toBe(0);
  const pixels = await page.evaluate(async uri => {
    const image = new Image(); await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('CROP_LOAD')); image.src = uri; });
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d'); if (!context) throw new Error('CANVAS'); context.drawImage(image, 0, 0);
    return { width: canvas.width, height: canvas.height, center: [...context.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data] };
  }, crops[0]!);
  expect(pixels.width).toBeGreaterThan(600); expect(pixels.height).toBeGreaterThan(300);
  for (const [index, expected] of [51, 102, 187].entries()) expect(Math.abs(pixels.center[index]! - expected)).toBeLessThan(8);
  const record = StoredLocalRecordSchema.parse(JSON.parse(await readDocument(page, `record.${ids[0]}`)));
  expect(record.materials).toHaveLength(1); expect(record.session.runs.at(-1)?.outcome).toMatchObject({ status: 'completed', verified: true });
});

test('a grouped recipient reanswers each original question without adding duplicate question roots', async ({ page }, info) => {
  const models = modelFixture(page); const { ids } = await seed(page, true);
  await selectFiles(page, 1); await assignRange(page, 1, '1'); await page.getByRole('button', { name: '保存补图并自动重答', exact: true }).click();
  await expect.poll(async () => {
    const record = StoredLocalRecordSchema.safeParse(JSON.parse(await readDocument(page, `record.${ids[0]}`)));
    return record.success && record.data.session.runs.length === 3 && record.data.session.runs.every(run => run.status === 'completed');
  }).toBe(true);
  const record = StoredLocalRecordSchema.parse(JSON.parse(await readDocument(page, `record.${ids[0]}`)));
  expect(record.materials).toHaveLength(1); expect(questionConversations(record.session.runs)).toHaveLength(2);
  expect(record.session.runs.slice(1).map(run => run.context && 'number' in run.context ? run.context.number : null)).toEqual([1, 2]);
  expect(models.solves).toHaveLength(2); expect(models.verifications()).toBe(2);
  await page.getByRole('button', { name: '批次操作', exact: true }).click(); await page.getByRole('button', { name: '导出本批 PDF', exact: true }).click(); await page.getByRole('button', { name: '快速原文（最快）', exact: true }).click();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF', exact: true }).click(); const path = info.outputPath('grouped-materials.pdf'); await (await download).saveAs(path);
  expect((await readFile(path)).subarray(0, 5).toString()).toBe('%PDF-'); expect(models.unexpected()).toBe(0);
});

test('a failed shared-image transaction preserves every question and can be retried without duplicate supplements', async ({ page }) => {
  const models = modelFixture(page); const { ids } = await seed(page); const before = await Promise.all(ids.map(id => readDocument(page, `record.${id}`)));
  await page.evaluate(second => {
    let fault = true; const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(this: IDBObjectStore, ...args) {
      if (fault && this.name === 'documents' && typeof args[1] === 'string' && args[1].startsWith(`material.${second}.`)) throw new DOMException('SYNTHETIC_QUOTA', 'QuotaExceededError');
      return Reflect.apply(put, this, args);
    };
    Object.defineProperty(window, '__restoreSharedMaterialStorage', { value: () => { fault = false; } });
  }, ids[1]);
  await selectFiles(page, 1); await assignRange(page, 1, '1-2'); await page.getByRole('button', { name: '保存补图并自动重答', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('本地保存失败'); expect(models.solves).toEqual([]);
  expect(await Promise.all(ids.map(id => readDocument(page, `record.${id}`)))).toEqual(before);
  await page.evaluate('window.__restoreSharedMaterialStorage()'); await page.getByRole('button', { name: '保存补图并自动重答', exact: true }).click();
  await expect.poll(() => completedRecipient(page, ids[1]!)).toBe('completed');
  for (const id of ids.slice(0, 2)) expect(StoredLocalRecordSchema.parse(JSON.parse(await readDocument(page, `record.${id}`))).materials).toHaveLength(1);
  expect(models.solves).toHaveLength(2); expect(models.verifications()).toBe(2); expect(await readDocument(page, `record.${ids[2]}`)).toBe(before[2]);
});

test('one reusable image can be assigned to fifty recipients and each recipient is answered exactly once', async ({ page }, info) => {
  test.setTimeout(90000);
  const models = modelFixture(page); const { ids } = await seed(page, false, 50);
  await selectFiles(page, 1); await assignRange(page, 1, '1-50');
  await expect(page.getByText('已分配 1 / 1 张补图 · 50 张题图将重新解答', { exact: true })).toBeVisible();
  const summaryBox = await page.getByTestId('batch-material-assignment-summary').boundingBox(); if (!summaryBox) throw new Error('ASSIGNMENT_SUMMARY');
  expect(summaryBox.height).toBeLessThanOrEqual(44);
  const started = Date.now(); await page.getByRole('button', { name: '保存补图并自动重答', exact: true }).click();
  await expect.poll(async () => {
    const values = await Promise.all(ids.map(id => readDocument(page, `record.${id}`)));
    return values.filter(value => { const record = StoredLocalRecordSchema.safeParse(JSON.parse(value)); return record.success && record.data.materials?.length === 1 && record.data.session.runs.length === 2 && record.data.session.runs.at(-1)?.status === 'completed'; }).length;
  }, { timeout: 60000 }).toBe(50);
  expect(models.solves).toHaveLength(50); expect(models.verifications()).toBe(50); expect(models.unexpected()).toBe(0);
  await info.attach('synthetic-fifty-recipient-result', { contentType: 'application/json', body: JSON.stringify({ recipients: 50, solves: models.solves.length, verifications: models.verifications(), elapsedMs: Date.now() - started, realModelRequests: 0 }) });
});

for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1440, height: 1000 }, { width: 1920, height: 1080 }]) for (const scheme of ['light', 'dark'] as const) test(`batch material style ${size.width}x${size.height} ${scheme}`, async ({ page }, info) => {
  await page.setViewportSize(size); await page.emulateMedia({ colorScheme: scheme });
  const models = modelFixture(page); await seed(page); let entryX = 0;
  await selectFiles(page, 2, async () => {
    const heading = await page.getByText('批量补图', { exact: true }).boundingBox(); if (!heading) throw new Error('ENTRY_HEADING'); entryX = heading.x;
    await page.screenshot({ path: info.outputPath('entry.png') });
  });
  const heading = await page.getByText('批量补图分配', { exact: true }).boundingBox(); if (!heading) throw new Error('DRAFT_HEADING');
  expect.soft(Math.abs(heading.x - entryX)).toBeLessThan(1);
  const importRadius = await page.getByTestId('material-import-row').first().evaluate(node => getComputedStyle(node).borderRadius);
  await page.screenshot({ path: info.outputPath('draft.png') });
  const checkbox = page.getByRole('checkbox', { name: '第2张题图', exact: true }); const row = page.getByTestId('batch-material-target').nth(1);
  const normal = await row.evaluate(node => ({ border: getComputedStyle(node).borderColor, background: getComputedStyle(node).backgroundColor, radius: getComputedStyle(node).borderRadius }));
  expect.soft(normal.radius).toBe(importRadius);
  const borderContrast = await checkbox.evaluate(node => {
    const square = node.firstElementChild; if (!square) throw new Error('CHECKBOX_SQUARE'); const style = getComputedStyle(square);
    function luminance(color: string) { const rgb = color.match(/[\d.]+/g)?.slice(0, 3).map(Number); if (!rgb || rgb.length !== 3) throw new Error('COLOR'); const c = rgb.map(v => { const n = v / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }); return .2126 * c[0]! + .7152 * c[1]! + .0722 * c[2]!; }
    const a = luminance(style.borderTopColor), b = luminance(style.backgroundColor); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  });
  expect.soft(borderContrast).toBeGreaterThanOrEqual(3);
  await checkbox.focus(); await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  expect.soft(await row.evaluate(node => getComputedStyle(node).borderColor)).not.toBe(normal.border);
  await checkbox.press('Space'); await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  expect.soft(await checkbox.isChecked()).toBe(true);
  await checkbox.check();
  expect.soft(await row.evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe(normal.background);
  const selectedContrast = await checkbox.evaluate(node => {
    const square = node.firstElementChild, label = square?.firstElementChild;
    if (!square || !label) throw new Error('SELECTED_LABEL');
    const luminance = (color: string) => {
      const rgb = color.match(/[\d.]+/g)?.slice(0, 3).map(Number); if (!rgb || rgb.length !== 3) throw new Error('COLOR');
      const c = rgb.map(v => { const n = v / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; });
      return .2126 * c[0]! + .7152 * c[1]! + .0722 * c[2]!;
    };
    const a = luminance(getComputedStyle(label).color), b = luminance(getComputedStyle(square).backgroundColor);
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  });
  expect.soft(selectedContrast).toBeGreaterThanOrEqual(4.5);
  await expect(page.getByLabel('对应题图序号范围', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^确认分配/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '全选本批', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '裁剪第1张', exact: true })).toHaveCount(0);
  const card = await page.getByTestId('material-import-row').first().boundingBox();
  const remove = await page.getByRole('button', { name: '移除第1张', exact: true }).boundingBox();
  if (!card || !remove) throw new Error('CARD_REMOVE');
  expect.soft(remove.x + remove.width).toBeLessThanOrEqual(card.x + card.width);
  expect.soft(Math.abs(remove.y - card.y)).toBeLessThanOrEqual(1);
  expect.soft(remove.width).toBeLessThanOrEqual(32); expect.soft(remove.height).toBeLessThanOrEqual(32);
  await page.screenshot({ path: info.outputPath('selection.png') });
  await openPhotoTools(page, 1);
  await expect(page.getByRole('button', { name: '裁剪第1张', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: '旋转第1张', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: '查看补图1', exact: true })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: info.outputPath('photo-tools.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '关闭图片操作', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消补图', exact: true })).toBeInViewport({ ratio: 1 });
  await page.getByRole('button', { name: '取消补图', exact: true }).click(); expect(models.solves).toHaveLength(0);
});

test('the binding workbench replaces only its active and waiting recipients while other questions continue', async ({ page }, info) => {
  const models = modelFixture(page); const { ids } = await seed(page, false, 4);
  const runIds = await Promise.all(ids.map(async id => LocalRecordSchema.parse(JSON.parse(await readDocument(page, `record.${id}`))).session.runs[0]!.id));
  await page.evaluate(async ({ ids, runIds }) => {
    const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';
    let runtime: Record<string, unknown> | null = null;
    for (const node of document.querySelectorAll('*')) {
      const key = Object.keys(node).find(name => name.startsWith('__reactFiber$')); let fiber: unknown = key ? Reflect.get(node, key) : null;
      for (let depth = 0; object(fiber) && depth < 100; depth++, fiber = fiber.return) {
        const props = fiber.memoizedProps;
        if (object(props) && object(props.runtime) && object(props.runtime.batch) && object(props.runtime.engine)) { runtime = props.runtime; break; }
      }
      if (runtime) break;
    }
    if (!runtime || !object(runtime.engine) || typeof runtime.engine.configureConcurrency !== 'function' || !object(runtime.batch) || typeof runtime.batch.enqueue !== 'function') throw new Error('ISOLATED_BATCH_RUNTIME_NOT_FOUND');
    Reflect.apply(runtime.engine.configureConcurrency, runtime.engine, [{ solver: 2, verifier: 1 }]);
    const execute = async (input: unknown, signal: AbortSignal) => {
      if (!object(input) || !object(input.identity) || typeof input.identity.sessionId !== 'string') throw new Error('ISOLATED_INPUT');
      const identity = input.identity.sessionId;
      const index = ids.findIndex(id => id === identity); document.documentElement.setAttribute(`data-supplement-old-start-${index}`, 'true');
      if (index === 0) await new Promise<void>(resolve => signal.addEventListener('abort', () => { document.documentElement.setAttribute('data-supplement-target-aborted', 'true'); resolve(); }, { once: true }));
      if (index === 1) {
        signal.addEventListener('abort', () => document.documentElement.setAttribute('data-supplement-other-aborted', 'true'), { once: true });
        await new Promise<void>(resolve => window.addEventListener('test:release-supplement-other', () => resolve(), { once: true }));
      }
      return { schemaVersion: 1, status: 'completed', verified: false, verificationStatus: 'not_requested', verification: null, warning: null,
        candidate: { schemaVersion: 1, kind: 'answer', problem: { text: 'Synthetic old request', subject: 'math', uncertainties: [] }, answer: 'LATE OLD', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } };
    };
    for (const [index, id] of ids.entries()) await Reflect.apply(runtime.batch.enqueue, runtime.batch, [id, execute, false, { message: 'Synthetic original queued task', context: { kind: 'regenerate', sourceRunId: runIds[index] } }]);
  }, { ids, runIds });
  await expect(page.locator('html')).toHaveAttribute('data-supplement-old-start-1', 'true');
  const otherBefore = await readDocument(page, `record.${ids[1]}`);
  await selectFiles(page, 1); await expect(page.getByTestId('batch-material-workbench')).toBeVisible();
  await assignRange(page, 1, '1、4');
  await expect(page.getByText(/其中 1 题将停止旧任务/)).toBeVisible();
  await page.screenshot({ path: info.outputPath('binding-while-solving.png') });
  await page.getByRole('button', { name: '保存补图并自动重答', exact: true }).click();
  await expect(page.getByTestId('batch-material-workbench')).toHaveCount(0);
  await expect.poll(() => completedRecipient(page, ids[3]!)).toBe('completed');
  const target = StoredLocalRecordSchema.parse(JSON.parse(await readDocument(page, `record.${ids[0]}`)));
  expect(target.session.runs.map(run => run.status)).toEqual(['completed', 'cancelled', 'completed']);
  expect(target.session.runs.at(-1)?.imageIds).toEqual(target.activeImageIds); expect(target.materials).toHaveLength(1);
  await expect(page.locator('html')).toHaveAttribute('data-supplement-target-aborted', 'true');
  expect(await page.locator('html').getAttribute('data-supplement-other-aborted')).toBeNull();
  await expect(page.locator('html')).toHaveAttribute('data-supplement-old-start-2', 'true');
  expect(await page.locator('html').getAttribute('data-supplement-old-start-3')).toBeNull();
  expect(await readDocument(page, `record.${ids[1]}`)).toBe(otherBefore);
  expect(models.solves).toHaveLength(2); expect(models.verifications()).toBe(2); expect(models.unexpected()).toBe(0);
  await page.evaluate(() => window.dispatchEvent(new Event('test:release-supplement-other')));
  await expect.poll(() => completedRecipient(page, ids[1]!)).toBe('completed');
});
