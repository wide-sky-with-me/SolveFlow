import { LocalRecordSchema } from '../../packages/contracts/src/local.js';
import { expect, test, type Page } from '@playwright/test';
const batchId = 'd9000000-0000-4000-8000-000000000001';
const oldExport = 'd9000000-0000-4000-8000-000000000099';
async function seed(page: Page, missing = false, full = false) {
  await page.goto('/'); await expect(page.getByTestId('launch-screen')).toBeHidden();
  const records = await page.evaluate(async ({ batchId, missing, full, oldExport }) => {
    const records: unknown[] = [];
    const open = (name: string, stores: string[]) => new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(name, 1); request.onupgradeneeded = () => stores.forEach(store => { if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store); }); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const db = await open('solveflow-local', ['documents']);
    const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 300;
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('CANVAS'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 600, 300); ctx.fillStyle = '#111'; ctx.font = '24px sans-serif'; ctx.fillText('Synthetic preflight: x + 1 = 3', 25, 140);
    const image = canvas.toDataURL('image/jpeg'), createdAt = '2026-10-28T03:00:00.000Z';
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('documents', 'readwrite'), store = tx.objectStore('documents');
      for (let position = 1; position <= (missing ? 3 : 1); position++) {
        const id = `d9100000-0000-4000-8000-${String(position).padStart(12, '0')}`;
        const candidate = { schemaVersion: 1, kind: 'answer', problem: { text: 'Synthetic saved question x+1=3', subject: 'math', uncertainties: missing ? ['选项不完整，需核对原图'] : [], options: [{ label: 'A', text: '1' }, { label: 'B', text: '2' }], ...(missing ? { optionsComplete: false } : {}) }, answer: '2', ...(missing ? {} : { selectedOptions: ['B'] }), steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
        const session = { schemaVersion: 1, id, subject: 'math', createdAt, upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: 2000, width: 600, height: 300, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` }, runs: position === 1 ? [{ schemaVersion: 1, id, sessionId: id, createdAt, seq: 1, status: 'completed', message: '', outcome: { schemaVersion: 1, status: 'completed', verified: false, verificationStatus: 'not_requested', warning: null, verification: null, candidate } }] : [] };
        const record = { schemaVersion: 1, session, image, batch: { id: batchId, title: 'Preflight batch', createdAt, exam: 'general', position } }; records.push(record);
        store.put(JSON.stringify(record), `record.${id}`);
      }
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    }); db.close();
    if (full) {
      const cache = await open('solveflow-exports', ['records', 'files', 'sizes']);
      await new Promise<void>((resolve, reject) => {
        const tx = cache.transaction(['records', 'sizes'], 'readwrite');
        tx.objectStore('sizes').put(512 * 1024 * 1024, oldExport);
        tx.objectStore('records').put({ schemaVersion: 1, id: oldExport, batchId, title: 'Old cached archive', mode: 'answers', layout: 'direct', copies: 1, questionCount: 1, parentId: null, createdAt, startedAt: createdAt, finishedAt: createdAt, status: 'succeeded', progress: '导出完成', error: null, file: { name: 'old.zip', mimeType: 'application/zip', bytes: 512 * 1024 * 1024 } }, oldExport);
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
      }); cache.close();
    }
    return records;
  }, { batchId, missing, full, oldExport });
  for (const record of records) LocalRecordSchema.parse(record);
  await page.goto('/?session=d9100000-0000-4000-8000-000000000001'); await expect(page.getByTestId('current-batch')).toBeVisible();
  await page.getByRole('button', { name: '批次操作', exact: true }).click(); await page.getByRole('button', { name: '导出本批 PDF', exact: true }).click();
}
test('preflight lists every missing stem, opens the exact original and preserves original-image export', async ({ page }, info) => {
  let models = 0; await page.route('https://**', route => { models++; return route.abort(); });
  await seed(page, true); await page.getByRole('button', { name: '纯题目', exact: true }).click(); await page.getByRole('button', { name: '快速原文（最快）', exact: true }).click();
  const check = page.getByTestId('export-preflight'); await expect(check).toContainText('选项不完整，需核对原图');
  await expect(check.getByRole('button', { name: '打开第2题', exact: true })).toBeVisible(); await expect(check.getByRole('button', { name: '打开第3题', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '下载 PDF', exact: true })).toBeDisabled();
  await check.getByRole('button', { name: '打开第3题', exact: true }).click(); await expect(page.getByRole('dialog', { name: '导出 PDF', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '跳转第3题', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: '批次操作', exact: true }).click(); await page.getByRole('button', { name: '导出本批 PDF', exact: true }).click();
  await page.getByRole('button', { name: '整理后的试卷', exact: true }).click(); await expect(page.getByRole('button', { name: '下载 PDF', exact: true })).toBeEnabled();
  await page.screenshot({ path: info.outputPath('preflight-content.png') }); expect(models).toBe(0);
});
test('full export cache blocks generation before it starts and deleting old records restores export', async ({ page }, info) => {
  let models = 0; await page.route('https://**', route => { models++; return route.abort(); });
  await seed(page, false, true); await page.getByRole('button', { name: '快速原文（最快）', exact: true }).click();
  const check = page.getByTestId('export-preflight'); await expect(check).toContainText('512.0 / 512.0 MiB');
  await expect(page.getByRole('button', { name: '下载 PDF', exact: true })).toBeDisabled(); await expect(page.getByRole('button', { name: '后台导出', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '打印 / 保存 PDF', exact: true })).toBeEnabled();
  await check.getByRole('button', { name: '管理导出记录', exact: true }).click();
  const old = page.getByRole('article').filter({ hasText: 'Old cached archive' });
  await old.getByRole('button', { name: '删除记录', exact: true }).click(); await old.getByRole('button', { name: '确认删除文件和记录', exact: true }).click(); await expect(old).toHaveCount(0);
  await page.getByRole('button', { name: '关闭导出记录', exact: true }).click(); await page.getByRole('button', { name: '批次操作', exact: true }).click(); await page.getByRole('button', { name: '导出本批 PDF', exact: true }).click();
  await page.getByRole('button', { name: '快速原文（最快）', exact: true }).click(); await check.locator('summary').click(); await expect(check).toContainText('0.0 / 512.0 MiB');
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF', exact: true }).click(); await (await download).saveAs(info.outputPath('after-cleanup.pdf'));
  expect(models).toBe(0); await page.screenshot({ path: info.outputPath('preflight-after-cleanup.png') });
});

for (const origin of ['history', 'task-center', 'records'] as const) test(`preflight opens the exact question when exported from ${origin}`, async ({ page }) => {
  let models = 0; await page.route('https://**', route => { models++; return route.abort(); });
  await seed(page, true, origin === 'records'); await page.getByRole('button', { name: '关闭导出', exact: true }).click();
  if (origin === 'history') {
    await page.getByRole('tab', { name: '历史题目', exact: true }).click(); await page.getByRole('tab', { name: '批量记录', exact: true }).click();
    await page.getByRole('button', { name: '批次操作：Preflight batch', exact: true }).click(); await page.getByRole('button', { name: '导出 PDF', exact: true }).click();
  } else if (origin === 'task-center') {
    await page.getByTestId('batch-tasks-entry').click(); const row = page.getByTestId(`batch-task-${batchId}`);
    await row.getByRole('button', { name: '任务操作：Preflight batch', exact: true }).click(); await row.getByRole('button', { name: '导出 PDF', exact: true }).click();
  } else {
    await page.getByRole('tab', { name: '我的', exact: true }).click(); await page.getByRole('button', { name: /^导出记录/ }).click();
    await page.getByTestId('export-record').getByRole('button', { name: '重新导出', exact: true }).click();
  }
  await page.getByRole('button', { name: '纯题目', exact: true }).click(); await page.getByRole('button', { name: '快速原文（最快）', exact: true }).click();
  await page.getByTestId('export-preflight').getByRole('button', { name: '打开第3题', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '导出 PDF', exact: true })).toHaveCount(0); await expect(page.getByRole('dialog', { name: '导出记录', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '当前题目', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: '跳转第3题', exact: true })).toHaveAttribute('aria-selected', 'true'); expect(models).toBe(0);
});
