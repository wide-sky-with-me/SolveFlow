import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { SessionViewSchema } from '../../packages/contracts/src/http.js';
import { LocalHistoryExportLineSchema } from '../../packages/contracts/src/local.js';
import { seedLocalSession } from './local-fixture.js';

test('downloads a complete local archive without model calls or changing saved records', async ({ page }) => {
  const id = '80000000-0000-4000-8000-000000000001'; const now = new Date().toISOString();
  const image = await page.screenshot({ type: 'jpeg' });
  const session = SessionViewSchema.parse({ schemaVersion: 1, id, subject: 'math', createdAt: now, runs: [], upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: image.length, width: 390, height: 844, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` } });
  await seedLocalSession(page, session, image);
  let posts = 0; page.on('request', request => { if (request.method() === 'POST') posts++; });
  await page.getByRole('tab', { name: '我的', exact: true }).click();
  await page.getByRole('button', { name: '导出本地记录', exact: true }).click();
  await expect(page.getByText('导出不会删除历史，也不会发送到网络。可通过「我的 → 恢复本地记录」导回应用。')).toBeVisible();
  const waiting = page.waitForEvent('download'); await page.getByRole('button', { name: '导出到本机', exact: true }).click(); const download = await waiting;
  expect(download.suggestedFilename()).toMatch(/^solveflow-history-.*\.ndjson$/);
  const path = await download.path(); if (!path) throw new Error('DOWNLOAD_MISSING');
  const rows = (await readFile(path, 'utf8')).trim().split('\n').map(line => LocalHistoryExportLineSchema.parse(JSON.parse(line)));
  expect(rows).toHaveLength(3); expect(rows[0]).toMatchObject({ kind: 'header', count: 1 });
  expect(rows[1]).toMatchObject({ kind: 'question', record: { session, image: `data:image/jpeg;base64,${image.toString('base64')}` }, favorite: false, diagnostics: [] });
  expect(rows[2]).toMatchObject({ kind: 'complete', count: 1 });
  await expect(page.getByText(`已导出：${download.suggestedFilename()}`, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page.getByRole('button', { name: '查看历史题目', exact: true })).toContainText('1');
  expect(posts).toBe(0);
});
