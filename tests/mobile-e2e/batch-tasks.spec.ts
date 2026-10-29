import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { configureLocalModel, lastModelInput, modelPass, modelSse } from './local-fixture.js';

const batches = ['a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001'];
async function seed(page: Page) {
  await page.goto('/'); await configureLocalModel(page);
  await page.getByRole('tab', { name: '我的', exact: true }).click(); await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('答题并发', { exact: true }).fill('1'); await page.getByLabel('校验并发', { exact: true }).fill('1');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  const ids = await page.evaluate(async batches => {
    const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 300;
    const context = canvas.getContext('2d'); if (!context) throw new Error('CANVAS');
    context.fillStyle = '#fff'; context.fillRect(0, 0, 600, 300); context.fillStyle = '#111'; context.font = '24px sans-serif'; context.fillText('x + 1 = 3. A: 1 B: 2', 40, 140);
    const image = canvas.toDataURL('image/jpeg'), createdAt = '2026-10-28T01:00:00.000Z';
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const open = indexedDB.open('solveflow-local', 1); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
    const ids: string[][] = [[], [], []];
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('documents', 'readwrite'), store = tx.objectStore('documents');
      for (const [group, count] of [2, 3, 2].entries()) for (let position = 1; position <= count; position++) {
        const id = `${group + 1}1000000-0000-4000-8000-${String(position).padStart(12, '0')}`; ids[group]!.push(id);
        const candidate = { schemaVersion: 1, kind: 'answer', problem: { text: `Synthetic saved question ${position}: x+1=3`, subject: 'math', uncertainties: [], options: [{ label: 'A', text: '1' }, { label: 'B', text: '2' }] }, answer: '2', selectedOptions: ['B'], steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
        const session = { schemaVersion: 1, id, subject: 'math', createdAt, upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: 2000, width: 600, height: 300, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` }, runs: group === 0 ? [{ schemaVersion: 1, id, sessionId: id, createdAt, seq: 1, status: 'completed', message: '', outcome: { schemaVersion: 1, status: 'completed', verified: true, warning: null, verification: { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'logic', 'diagram'], issues: [] }, candidate } }] : [] };
        store.put(JSON.stringify({ schemaVersion: 1, session, image, exam: 'general', batch: { id: batches[group], title: ['Completed A', 'Running B', 'Queued C'][group], createdAt, exam: 'general', position } }), `record.${id}`);
      }
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    }); db.close(); return ids;
  }, batches);
  await page.goto(`/?session=${ids[1]![0]}`); await configureLocalModel(page); await expect(page.getByTestId('current-batch')).toBeVisible();
  return ids;
}

test('batch task overview dispatches and stops independently; completed batch exports while another is solving', async ({ page }, info) => {
  const releases: (() => void)[] = []; let solves = 0;
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    const body: unknown = route.request().postDataJSON(), input = lastModelInput(body);
    if (!input || typeof input !== 'object' || !('role' in input)) throw new Error('MODEL_INPUT');
    if (input.role === 'verifier') { await route.fulfill({ contentType: 'text/event-stream', body: modelSse(modelPass) }); return; }
    solves++; await new Promise<void>(resolve => { releases.push(resolve); });
    await route.fulfill({ contentType: 'text/event-stream', body: modelSse({ schemaVersion: 1, kind: 'answer', problem: { text: 'Synthetic batch solve x+1=3', subject: 'math', uncertainties: [] }, answer: '2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] }, body) }).catch(() => {}); // A stopped request may already be closed by the browser.
  });
  const ids = await seed(page);
  try {
    await page.getByRole('button', { name: '批次操作', exact: true }).click(); await page.getByRole('button', { name: '继续待解题', exact: true }).click();
    await expect.poll(() => solves).toBe(1);
    await page.getByTestId('batch-tasks-entry').click();
    const center = page.getByTestId('batch-task-center'), b = page.getByTestId(`batch-task-${batches[1]}`), c = page.getByTestId(`batch-task-${batches[2]}`);
    await expect(b).toContainText('等待 2'); await expect(b).toContainText('答题中 1');
    await b.getByRole('button', { name: '任务操作：Running B', exact: true }).click(); await expect(b.getByRole('button', { name: '导出 PDF', exact: true })).toBeDisabled();
    await c.getByRole('button', { name: '任务操作：Queued C', exact: true }).click(); await c.getByRole('button', { name: '继续待解题', exact: true }).click();
    await expect(c).toContainText('等待 2'); expect(solves).toBe(1);
    await center.getByRole('button', { name: '查看批次：Completed A', exact: true }).click();
    await expect(page.getByTestId('batch-photo-count')).not.toContainText('后台处理中');
    await page.getByRole('button', { name: '批次操作', exact: true }).click(); await expect(page.getByRole('button', { name: '导出本批 PDF', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '导出本批 PDF', exact: true }).click(); await page.getByRole('button', { name: '快速原文（最快）', exact: true }).click();
    const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF', exact: true }).click();
    const download = await downloadPromise, path = info.outputPath('completed-A.pdf'); await download.saveAs(path);
    expect((await readFile(path)).subarray(0, 5).toString()).toBe('%PDF-'); expect(solves).toBe(1);
    await page.getByRole('button', { name: '关闭导出', exact: true }).click(); await page.getByTestId('batch-tasks-entry').click();
    await b.getByRole('button', { name: '任务操作：Running B', exact: true }).click(); await b.getByRole('button', { name: '停止本批', exact: true }).click();
    await expect.poll(() => solves).toBe(2); await expect(c).toContainText('答题中 1'); await expect(c).toContainText('等待 1');
    await expect(b).not.toContainText('等待 2'); await expect(b).not.toContainText('答题中'); await expect(b).toContainText('已停止 1'); await expect(b).not.toContainText('失败 1');
    // Releasing the remaining test model requests finishes C without restarting B.
    releases.forEach(release => release()); await expect.poll(() => solves).toBe(3); releases.forEach(release => release());
    await expect(c).toContainText('已校验 2'); await expect(b).toContainText('待解题 2');
    await page.screenshot({ path: info.outputPath('task-center.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const statuses = await page.evaluate(async ids => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const open = indexedDB.open('solveflow-local'); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
      const values = await Promise.all(ids.map(id => new Promise<string | null>((resolve, reject) => { const request = db.transaction('documents').objectStore('documents').get(`record.${id}`); request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : null); request.onerror = () => reject(request.error); }))); db.close();
      return values.map(value => value ? JSON.parse(value).session.runs.at(-1)?.status ?? 'unstarted' : 'missing');
    }, ids[1]!);
    expect(statuses).toEqual(['cancelled', 'unstarted', 'unstarted']);
  } finally { releases.forEach(release => release()); }
});

test('task overview stays reachable from profile in dark short viewports and preserves unstarted records', async ({ page }, info) => {
  await seed(page); await page.emulateMedia({ colorScheme: 'dark' }); await page.setViewportSize({ width: 740, height: 420 });
  await page.getByRole('tab', { name: '我的', exact: true }).click(); await page.getByRole('button', { name: '批量任务', exact: true }).click();
  const center = page.getByTestId('batch-task-center'); await expect(center).toBeVisible();
  await page.getByTestId(`batch-task-${batches[0]}`).getByRole('button', { name: '任务操作：Completed A', exact: true }).click();
  await expect(page.getByTestId(`batch-task-${batches[0]}`).getByRole('button', { name: '导出 PDF', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '进行中 0', exact: true }).click(); await expect(center.getByText('没有进行中的批次', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '全部 3', exact: true }).click(); await expect(center.getByText('待解题 3', { exact: true })).toBeVisible();
  const box = await center.boundingBox(); expect(box).not.toBeNull(); expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(421);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('task-center-dark-short.png') });
  await page.getByRole('button', { name: '关闭任务', exact: true }).click(); await expect(center).toHaveCount(0);
});

test('answer-ready count remains accurate while independent verification is still running', async ({ page }, info) => {
  const releases: (() => void)[] = [];
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    const body: unknown = route.request().postDataJSON(), input = lastModelInput(body);
    if (!input || typeof input !== 'object' || !('role' in input)) throw new Error('MODEL_INPUT');
    if (input.role === 'verifier') {
      await new Promise<void>(resolve => { releases.push(resolve); });
      await route.fulfill({ contentType: 'text/event-stream', body: modelSse(modelPass) }).catch(() => {}); return;
    }
    await route.fulfill({ contentType: 'text/event-stream', body: modelSse({ schemaVersion: 1, kind: 'answer', problem: { text: 'Synthetic ready answer x+1=3', subject: 'math', uncertainties: [] }, answer: '2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] }, body) });
  });
  await seed(page);
  try {
    await page.getByRole('button', { name: '批次操作', exact: true }).click(); await page.getByRole('button', { name: '继续待解题', exact: true }).click();
    await page.getByTestId('batch-tasks-entry').click(); const row = page.getByTestId(`batch-task-${batches[1]}`);
    await expect(row).toContainText('校验中 3'); await expect(row).toContainText('已出答案 3 / 3 张题图');
    await page.screenshot({ path: info.outputPath('answer-ready-verifying.png') });
    await row.getByRole('button', { name: '任务操作：Running B', exact: true }).click(); await row.getByRole('button', { name: '停止本批', exact: true }).click();
    await expect(row).toContainText('已停止 3'); await expect(row).not.toContainText('失败 3');
  } finally { releases.forEach(release => release()); }
});
