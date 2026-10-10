import { expect, test } from '@playwright/test';
import { chooseSyntheticPhoto, configureLocalModel, modelSse, seedLocalSession } from './local-fixture.js';
import { SessionViewSchema } from '../../packages/contracts/src/http.js';

test('a failed final write can be saved again without another model request', async ({ page }) => {
  let calls = 0;
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    calls++; await route.fulfill({ contentType: 'text/event-stream', body: modelSse({ schemaVersion: 1, kind: 'answer', problem: { text: '求 x+1=3 的解。', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] }, route.request().postDataJSON()) });
  });
  await page.goto('/'); await configureLocalModel(page); await chooseSyntheticPhoto(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put; let fail = true;
    window.addEventListener('restore-test-storage', () => { fail = false; });
    IDBObjectStore.prototype.put = function(value: unknown, key?: IDBValidKey) {
      if (fail && typeof key === 'string' && key.startsWith('record.') && typeof value === 'string' && value.includes('"status":"completed"')) throw new DOMException('synthetic quota', 'QuotaExceededError');
      return put.call(this, value, key);
    };
  });
  await page.getByRole('button', { name: '开始解题', exact: true }).click();
  await expect(page.getByText('1 个结果尚未保存', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '重试保存结果', exact: true }).click();
  await expect(page.getByText('仍未能保存。', { exact: false })).toBeVisible(); expect(calls).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event('restore-test-storage')));
  await page.getByRole('button', { name: '重试保存结果', exact: true }).click();
  await expect(page.getByText('1 个结果尚未保存', { exact: true })).toHaveCount(0);
  await expect(page.getByText('未校验', { exact: true })).toBeVisible(); expect(calls).toBe(1);
  await page.reload(); await expect(page.getByText('未校验', { exact: true })).toBeVisible(); expect(calls).toBe(1);
});

for (const damaged of ['favorite', 'record', 'image', 'material'] as const) test(`isolates and repairs a damaged ${damaged} without replacing other history`, async ({ page }) => {
  const id = '93000000-0000-4000-8000-000000000001'; const otherId = '93000000-0000-4000-8000-000000000002';
  const image = Buffer.from(await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2; return canvas.toDataURL('image/jpeg').split(',')[1]!; }), 'base64');
  const session = SessionViewSchema.parse({ schemaVersion: 1, id, subject: 'math', createdAt: new Date().toISOString(), runs: [], upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: image.length, width: 2, height: 2, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` } });
  await seedLocalSession(page, session, image);
  const materialId = '93000000-0000-4000-8000-000000000003';
  const record = { schemaVersion: 1, session, image: `data:image/jpeg;base64,${image.toString('base64')}`, ...(damaged === 'material' ? { materials: [{ id: materialId, image: `data:image/jpeg;base64,${image.toString('base64')}`, width: 2, height: 2, bytes: image.length }] } : {}) };
  const healthy = { ...record, session: { ...session, id: otherId, upload: { ...session.upload, id: otherId, previewUrl: `/api/v1/uploads/${otherId}/image` } } };
  await page.evaluate(async ({ healthy, record, id, damaged }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('solveflow-local', 1); request.onsuccess = () => resolve(request.result); request.onerror = reject; });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('documents', 'readwrite'); const store = tx.objectStore('documents'); store.put(JSON.stringify(healthy), `record.${healthy.session.id}`);
      if (damaged === 'image' || damaged === 'material') {
        const { image, materials, ...metadata } = record;
        store.put(JSON.stringify({ ...metadata, schemaVersion: 2, ...(materials ? { materials: materials.map(({ image: _image, ...info }) => info) } : {}) }), `record.${id}`);
        if (damaged === 'material') store.put(JSON.stringify({ schemaVersion: 1, image }), `image.${id}`);
      }
      else store.delete(`summary.${id}`);
      store.put('{broken', damaged === 'material' ? `material.${id}.${record.materials![0]!.id}` : `${damaged}.${id}`); tx.oncomplete = () => resolve(); tx.onerror = reject;
    }); db.close();
  }, { healthy, record, id, damaged });
  let posts = 0; page.on('request', request => { if (request.method() === 'POST') posts++; });
  await page.reload(); await page.getByRole('button', { name: '查看记录维护', exact: true }).click();
  if (damaged === 'favorite') {
    await page.getByRole('button', { name: '修复附加信息', exact: true }).click();
    await expect(page.getByText('重置这道题损坏的收藏状态？', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '确认修复', exact: true }).click();
    await expect(page.getByText('已检测的问题均已处理。', { exact: true })).toBeVisible();
  } else {
    await page.getByRole('button', { name: '从备份恢复这道题', exact: true }).click();
    const archive = [ { schemaVersion: 1, kind: 'header', format: 'solveflow-history', createdAt: session.createdAt, count: 1 }, { schemaVersion: 1, kind: 'question', record, favorite: false, diagnostics: [] }, { schemaVersion: 1, kind: 'complete', count: 1 } ].map(row => JSON.stringify(row)).join('\n') + '\n';
    if (damaged === 'record') {
      await page.evaluate(id => {
        const put = IDBObjectStore.prototype.put; let fail = true;
        window.addEventListener('restore-test-transaction', () => { fail = false; });
        IDBObjectStore.prototype.put = function(value: unknown, key?: IDBValidKey) {
          if (fail && key === `image.${id}`) throw new DOMException('PRIVATE_STORAGE_DETAIL', 'QuotaExceededError');
          return put.call(this, value, key);
        };
      }, id);
      const failingChoice = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: '确认选择备份恢复此题', exact: true }).click();
      await (await failingChoice).setFiles({ name: 'question-backup.ndjson', mimeType: 'application/x-ndjson', buffer: Buffer.from(archive) });
      await expect(page.getByText(/PRIVATE_STORAGE_DETAIL|本地保存失败/)).toBeVisible();
      const saved = await page.evaluate(async id => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => { const open = indexedDB.open('solveflow-local', 1); open.onsuccess = () => resolve(open.result); open.onerror = reject; });
        try { return await new Promise<unknown>((resolve, reject) => { const request = db.transaction('documents').objectStore('documents').get(`record.${id}`); request.onsuccess = () => resolve(request.result); request.onerror = reject; }); }
        finally { db.close(); }
      }, id);
      expect(saved).toBe('{broken');
      await expect(page.getByText('PRIVATE_STORAGE_DETAIL', { exact: true })).toHaveCount(0);
      await page.evaluate(() => window.dispatchEvent(new Event('restore-test-transaction')));
    }
    const choosing = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '确认选择备份恢复此题', exact: true }).click();
    await (await choosing).setFiles({ name: 'question-backup.ndjson', mimeType: 'application/x-ndjson', buffer: Buffer.from(archive) });
    await expect(page.getByText('已恢复 1 道题，跳过 0 道已有题目。', { exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page.getByRole('button', { name: '查看记录维护', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: '我的', exact: true }).click();
  await expect(page.getByRole('button', { name: '查看历史题目', exact: true })).toContainText('2'); expect(posts).toBe(0);
  if (damaged === 'material') {
    await page.reload();
    await page.getByRole('tab', { name: '题目', exact: true }).click();
    await page.getByRole('tab', { name: '历史题目', exact: true }).click();
    await page.getByRole('button', { name: `打开数学题目 ${id}`, exact: true }).click();
    await page.getByRole('button', { name: '同题材料 / 补图', exact: true }).click();
    await expect(page.getByRole('button', { name: '查看材料 1', exact: true })).toBeVisible();
  }
});
