import { expect, test } from '@playwright/test';
import { configureLocalModel, lastModelInput, modelSse } from './local-fixture.js';
test.use({ reducedMotion: 'reduce' });
test('compact wide batch aligns actions and retains answers after bounded verifier retries without replaying on reload', async ({ page }, info) => {
  let solves = 0; let checks = 0;
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    const input = lastModelInput(route.request().postDataJSON());
    if (input && typeof input === 'object' && 'role' in input && input.role === 'verifier') { checks++; await route.fulfill({ status: 503, body: 'private-provider-canary' }); return; }
    solves++; await route.fulfill({ contentType: 'text/event-stream', body: modelSse({ schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] }, route.request().postDataJSON()) });
  });
  await page.setViewportSize({ width: 1600, height: 900 }); await page.goto('/'); await configureLocalModel(page);
  await page.getByRole('tab', { name: '我的', exact: true }).click(); await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: 'ESAT', exact: true }).click(); await page.getByRole('button', { name: '保存设置', exact: true }).click(); await page.getByRole('tab', { name: '题目', exact: true }).click();
  await expect(page.getByTestId('desktop-exam')).toContainText('ESAT');
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('solveflow-local', 1); request.onsuccess = () => resolve(request.result); request.onerror = reject; });
    const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 300; const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('CANVAS'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 600, 300); ctx.fillStyle = '#111'; ctx.fillText('x+1=3', 50, 150);
    const createdAt = '2026-10-08T08:00:00.000Z'; const image = canvas.toDataURL('image/jpeg');
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('documents', 'readwrite'); const store = tx.objectStore('documents');
      for (let n = 1; n <= 2; n++) {
        const id = `89000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
        const batch = { id: '89000000-0000-4000-8000-000000000003', title: '宽屏批量回归', createdAt, exam: 'general', position: n };
        const session = { schemaVersion: 1, id, subject: 'math', createdAt, upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: 1000, width: 600, height: 300, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` }, runs: [] };
        store.put(JSON.stringify({ schemaVersion: 1, session, image, batch }), `record.${id}`); store.put(JSON.stringify({ schemaVersion: 1, id, subject: 'math', createdAt, text: '', pending: false, batch }), `summary.${id}`);
      }
      tx.oncomplete = () => resolve(); tx.onerror = reject;
    }); db.close();
  });
  await page.getByRole('tab', { name: '历史题目', exact: true }).click(); await page.getByRole('tab', { name: '批量记录', exact: true }).click(); await page.getByRole('button', { name: '打开批量', exact: true }).click();
  await page.getByRole('button', { name: '批次操作', exact: true }).click(); await page.getByRole('button', { name: '继续待解题', exact: true }).click();
  await expect(page.getByText('校验服务暂不可用，已保留解答；答案尚未验证。', { exact: true }).first()).toBeVisible();
  await expect.poll(() => [solves, checks]).toEqual([2, 4]);
  await expect(page.getByText('这次没能完成解题', { exact: true })).toHaveCount(0); await expect(page.getByText('private-provider-canary', { exact: false })).toHaveCount(0);
  for (const width of [1280, 1600, 1920]) {
    await page.setViewportSize({ width, height: 900 }); await expect(page.getByTestId('desktop-intro')).toHaveCount(0);
    const header = await page.getByTestId('batch-header').boundingBox(); const title = await page.getByRole('button', { name: '重命名批次', exact: true }).boundingBox(); const tab = await page.getByRole('tab', { name: '当前题目', exact: true }).boundingBox(); const pager = await page.getByTestId('question-pager-navigation').first().boundingBox();
    if (!header || !title || !tab || !pager) throw new Error('LAYOUT');
    expect(header.y).toBeLessThan(150); expect(title.x).toBeCloseTo(tab.x, 0); expect(header.x).toBeCloseTo(pager.x, 0); expect(header.width).toBeCloseTo(pager.width, 0);
    await expect(page.getByRole('button', { name: '批次操作', exact: true })).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: info.outputPath('compact-batch.png') });
  await page.reload(); await expect(page.getByRole('tab', { name: '题目', exact: true })).toBeVisible(); expect([solves, checks]).toEqual([2, 4]);
});
