import { expect, test, type Page } from '@playwright/test';
import { SessionViewSchema } from '../../packages/contracts/src/http.js';
import { chooseSyntheticPhoto, configureLocalModel, modelSse, seedLocalSession } from './local-fixture.js';

const firstId = '97000000-0000-4000-8000-000000000001';
const secondId = '97000000-0000-4000-8000-000000000002';

async function seedQuestion(page: Page, id = firstId) {
  await page.goto('/');
  const image = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 8;
    return canvas.toDataURL('image/jpeg').split(',')[1]!;
  }), 'base64');
  const session = SessionViewSchema.parse({ schemaVersion: 1, id, subject: 'math', createdAt: new Date().toISOString(), runs: [], upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: image.length, width: 8, height: 8, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` } });
  await seedLocalSession(page, session, image);
}

async function writeDocument(page: Page, key: string, value: unknown) {
  await page.evaluate(async ({ key, value }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const open = indexedDB.open('solveflow-local', 1); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
    try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('documents', 'readwrite'); tx.objectStore('documents').put(value, key); tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error); }); }
    finally { db.close(); }
  }, { key, value });
}

async function readDocument(page: Page, key: string): Promise<unknown> {
  return page.evaluate(async key => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const open = indexedDB.open('solveflow-local', 1); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
    try { return await new Promise<unknown>((resolve, reject) => { const request = db.transaction('documents').objectStore('documents').get(key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
    finally { db.close(); }
  }, key);
}

test('isolates a non-string bookmark and preserves healthy history until explicit repair', async ({ page }) => {
  await seedQuestion(page); await seedQuestion(page, secondId);
  const damaged = { broken: true }; await writeDocument(page, `favorite.${firstId}`, damaged);
  await page.reload(); await expect(page.getByRole('button', { name: '查看记录维护', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '历史题目', exact: true }).click();
  await page.getByRole('button', { name: `打开数学题目 ${secondId}`, exact: true }).click();
  await expect(page.getByTestId('current-exam')).toBeVisible();
  expect(await readDocument(page, `favorite.${firstId}`)).toEqual(damaged);
  await page.getByRole('button', { name: '查看记录维护', exact: true }).click();
  await page.getByRole('button', { name: '修复附加信息', exact: true }).click();
  await page.getByRole('button', { name: '确认修复', exact: true }).click();
  await expect(page.getByText('已检测的问题均已处理。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('tab', { name: '历史题目', exact: true }).click();
  await expect(page.getByRole('button', { name: `打开数学题目 ${firstId}`, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: `打开数学题目 ${secondId}`, exact: true })).toBeVisible();
});

for (const [name, damaged] of [['invalid JSON', '{broken'], ['invalid schema', JSON.stringify({ schemaVersion: 999 })], ['non-string value', { broken: true }]] as const) {
  test(`damaged settings (${name}) preserve their bytes and allow history, export and reconfiguration`, async ({ page }) => {
    await seedQuestion(page); await writeDocument(page, 'settings', damaged);
    let posts = 0; page.on('request', request => { if (request.method() === 'POST') posts++; });
    await page.reload();
    await expect(page.getByText(/模型设置已损坏/)).toBeVisible();
    await expect(page.getByTestId('current-exam')).toBeVisible();
    expect(await readDocument(page, 'settings')).toEqual(damaged);
    await page.getByRole('tab', { name: '我的', exact: true }).click();
    await page.getByRole('button', { name: '导出本地记录', exact: true }).click();
    const download = page.waitForEvent('download'); await page.getByRole('button', { name: '导出到本机', exact: true }).click();
    await download; await expect(page.getByText(/^已导出：/)).toBeVisible();
    expect(await readDocument(page, 'settings')).toEqual(damaged);
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await page.getByRole('button', { name: '重新配置模型', exact: true }).click();
    await configureLocalModel(page);
    await expect(page.getByText(/模型设置已损坏/)).toHaveCount(0);
    expect(await readDocument(page, 'settings')).toEqual(expect.any(String));
    expect(await readDocument(page, 'settings')).not.toEqual(damaged);
    await page.reload(); await expect(page.getByText(/模型设置已损坏/)).toHaveCount(0);
    await expect(page.getByTestId('current-exam')).toBeVisible(); expect(posts).toBe(0);
  });
}

test('a settings transaction failure remains a startup failure rather than corruption recovery', async ({ page }) => {
  await seedQuestion(page);
  await page.addInitScript(() => {
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function(key: IDBValidKey | IDBKeyRange) {
      if (key === 'settings') throw new DOMException('PRIVATE_STORAGE_DETAIL', 'InvalidStateError');
      return get.call(this, key);
    };
  });
  await page.reload(); await expect(page.getByText('暂时无法打开题目', { exact: true })).toBeVisible();
  await expect(page.getByText(/模型设置已损坏/)).toHaveCount(0);
  await page.getByRole('button', { name: '重新打开', exact: true }).click();
  await expect(page.getByText('暂时无法打开题目', { exact: true })).toBeVisible();
});

for (const operation of ['read', 'write'] as const) test(`recent-session cache ${operation} failure warns without blocking history or solving`, async ({ page }) => {
  await seedQuestion(page);
  await page.addInitScript(operation => {
    const get = Storage.prototype.getItem; const set = Storage.prototype.setItem; const remove = Storage.prototype.removeItem;
    let unavailable = true; window.addEventListener('restore-recent-session-cache', () => { unavailable = false; });
    Storage.prototype.getItem = function(key: string) { if (unavailable && operation === 'read' && key === 'solveflow.local-last-session') throw new DOMException('PRIVATE_CACHE_DETAIL', 'SecurityError'); return get.call(this, key); };
    Storage.prototype.setItem = function(key: string, value: string) { if (unavailable && operation === 'write' && key === 'solveflow.local-last-session') throw new DOMException('PRIVATE_CACHE_DETAIL', 'QuotaExceededError'); set.call(this, key, value); };
    Storage.prototype.removeItem = function(key: string) { if (unavailable && operation === 'write' && key === 'solveflow.local-last-session') throw new DOMException('PRIVATE_CACHE_DETAIL', 'SecurityError'); remove.call(this, key); };
  }, operation);
  await page.goto('/');
  if (operation === 'read') await expect(page.getByText(/最近题目位置.*无法/)).toBeVisible();
  await page.getByRole('tab', { name: '历史题目', exact: true }).click();
  await page.getByRole('button', { name: `打开数学题目 ${firstId}`, exact: true }).click();
  await expect(page.getByTestId('current-exam')).toBeVisible();
  if (operation === 'write') await expect(page.getByText(/最近题目位置.*无法/)).toBeVisible();
  await expect(page.getByText('PRIVATE_CACHE_DETAIL', { exact: true })).toHaveCount(0);
  let calls = 0;
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    calls++; await route.fulfill({ contentType: 'text/event-stream', body: modelSse({ schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] }, route.request().postDataJSON()) });
  });
  await configureLocalModel(page); await page.getByRole('button', { name: '换一道题', exact: true }).click();
  await chooseSyntheticPhoto(page); await page.getByRole('button', { name: '开始解题', exact: true }).click();
  await expect(page.getByText('未校验', { exact: true })).toBeVisible(); expect(calls).toBe(1);
  await page.reload(); await page.getByRole('tab', { name: '历史题目', exact: true }).click();
  await expect(page.getByRole('button', { name: /^打开数学题目/ })).toHaveCount(2); expect(calls).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event('restore-recent-session-cache')));
  await page.getByRole('button', { name: `打开数学题目 ${firstId}`, exact: true }).click();
  await expect(page.getByTestId('current-exam')).toBeVisible();
  await expect(page.getByText(/最近题目位置.*无法/)).toHaveCount(0);
});
