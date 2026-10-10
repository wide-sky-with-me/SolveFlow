import { expect, test } from '@playwright/test';
import { SessionViewSchema } from '../../packages/contracts/src/http.js';
import { seedLocalSession } from './local-fixture.js';

test('history renders formula previews without cutting math source and opens the saved answer', async ({ page }, info) => {
  const id = '20000000-0000-4000-8000-000000000001'; const now = new Date().toISOString();
  const image = await page.screenshot({ type: 'jpeg' });
  const problem = '求解 $x^{2}+2=6$。\n\n' + '这是需要保留完整数学结构的题干。'.repeat(6) + '\\[\\frac{123456789}{987654321}+\\sqrt{2}=y\\]';
  const session = SessionViewSchema.parse({ schemaVersion: 1, id, subject: 'math', createdAt: now,
    upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: image.length, width: 320, height: 700, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` },
    runs: [{ schemaVersion: 1, id: '20000000-0000-4000-8000-000000000002', sessionId: id, status: 'completed', message: '', seq: 5, createdAt: now,
      outcome: { schemaVersion: 1, status: 'completed', verified: true, warning: null, verification: { schemaVersion: 1, verdict: 'pass', checked: ['transcription'], issues: [] }, candidate: { schemaVersion: 1, kind: 'answer', problem: { text: problem, subject: 'math', uncertainties: [] }, answer: '$x=\\pm2$', steps: [{ id: 's1', title: '移项', explanation: '两边减二，再开平方。' }], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } } }] });
  let calls = 0; page.on('request', request => { if (request.method() === 'POST') calls++; });
  await seedLocalSession(page, session, image);
  await page.getByRole('tab', { name: '历史题目', exact: true }).click();
  const history = page.locator('.history-document');
  await expect(history.locator('.katex')).toHaveCount(2);
  await expect(history.locator('.math-inline .katex')).toBeVisible();
  expect(await history.locator('.history-preview').evaluate(node => node.textContent?.includes('$x^{2}'))).toBe(false);
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await history.evaluate(node => node.getBoundingClientRect().right <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: `打开数学题目 ${id}`, exact: true }).click();
  await expect(page.getByRole('tab', { name: '当前题目', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.final-answer .katex')).toBeVisible();
  expect(calls).toBe(0);
  await page.getByRole('tab', { name: '历史题目', exact: true }).click();
  await expect(page.getByRole('heading', { name: '历史题目', exact: true })).toHaveCount(0);
  const row = page.locator(`.history-entry[data-session-id="${id}"]`);
  const bounds = await row.boundingBox(); if (!bounds) throw new Error('MISSING_ROW');
  // Start on the card body, clear of the top-right action button.
  const x = bounds.x + bounds.width - 64; const y = bounds.y + 60;
  if (info.project.name === 'mobile') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - i * 24, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach();
  } else { await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x - 144, y, { steps: 6 }); await page.mouse.up(); }
  await expect(page.getByRole('tab', { name: '历史题目', exact: true })).toHaveAttribute('aria-selected', 'true');
  await row.getByRole('button', { name: '收藏', exact: true }).click();
  await expect(row.getByRole('img', { name: '已收藏', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: '历史题目', exact: true }).click();
  await expect(row.getByRole('img', { name: '已收藏', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '我的', exact: true }).click();
  await page.getByRole('button', { name: '收藏的题目', exact: true }).click();
  await expect(page.getByRole('heading', { name: '收藏的题目', exact: true })).toBeVisible();
  await page.getByRole('button', { name: `打开数学题目 ${id}`, exact: true }).click();
  await expect(page.locator('.final-answer .katex')).toBeVisible();
  await page.getByRole('tab', { name: '历史题目', exact: true }).click();
  await row.getByRole('button', { name: '题目操作', exact: true }).click();
  await row.getByRole('button', { name: '取消收藏', exact: true }).click();
  await expect(row.getByRole('img', { name: '已收藏', exact: true })).toHaveCount(0);
  await row.getByRole('button', { name: '题目操作', exact: true }).click();
  await row.getByRole('button', { name: '移除', exact: true }).click();
  await expect(page.getByText('删除这道题？', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '保留题目', exact: true }).click();
  await expect(row).toBeVisible();
  const otherId = '20000000-0000-4000-8000-000000000003';
  const other = SessionViewSchema.parse({ ...session, id: otherId, upload: { ...session.upload, id: otherId, previewUrl: `/api/v1/uploads/${otherId}/image` }, runs: session.runs.map(run => ({ ...run, sessionId: otherId, id: '20000000-0000-4000-8000-000000000004' })) });
  await seedLocalSession(page, other, image);
  await page.getByRole('tab', { name: '历史题目', exact: true }).click();
  await row.getByRole('button', { name: '题目操作', exact: true }).click();
  await row.getByRole('button', { name: '移除', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(row).toHaveCount(0);
  await expect(page.getByRole('button', { name: `打开数学题目 ${otherId}`, exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '当前题目', exact: true }).click();
  expect(page.url()).toContain(otherId);
  await expect(page.locator('.final-answer .katex')).toBeVisible();
  await page.getByRole('tab', { name: '历史题目', exact: true }).click();
  const otherRow = page.locator(`.history-entry[data-session-id="${otherId}"]`);
  await otherRow.getByRole('button', { name: '题目操作', exact: true }).click();
  await otherRow.getByRole('button', { name: '移除', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.getByText('还没有解题记录', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '我的', exact: true }).click();
  await page.getByRole('button', { name: '收藏的题目', exact: true }).click();
  await expect(page.getByTestId('empty-favorites')).toBeVisible();
  expect(calls).toBe(0);
});


test('history keeps a readable question and photo when the document readiness deadline expires', async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => original(handler, delay === 10000 ? 0 : delay, ...args)) as typeof window.setTimeout;
  });
  const id = '20000000-0000-4000-8000-000000000005'; const now = new Date().toISOString();
  const image = await page.screenshot({ type: 'jpeg' });
  const session = SessionViewSchema.parse({ schemaVersion: 1, id, subject: 'physics', createdAt: now,
    upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: image.length, width: 320, height: 700, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` },
    runs: [{ schemaVersion: 1, id, sessionId: id, status: 'completed', message: '', seq: 1, createdAt: now,
      outcome: { schemaVersion: 1, status: 'completed', verified: true, warning: null, verification: { schemaVersion: 1, verdict: 'pass', checked: ['transcription'], issues: [] }, candidate: { schemaVersion: 1, kind: 'answer', problem: { text: '小球从静止开始自由下落，求三秒后的速度。', subject: 'physics', uncertainties: [] }, answer: '约29.4米每秒', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } } }] });
  let calls = 0; page.on('request', request => { if (request.method() === 'POST') calls++; });
  await seedLocalSession(page, session, image);
  await page.getByRole('tab', { name: '历史题目', exact: true }).click();
  const fallback = page.getByTestId('history-fallback');
  await expect(fallback.getByText('序号 1 · 物理 · 当前题目', { exact: true })).toBeVisible();
  await expect(fallback.getByText(/^保存于 \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)).toBeVisible();
  await expect(fallback.getByText('小球从静止开始自由下落，求三秒后的速度。', { exact: true })).toBeVisible();
  await expect(fallback.getByRole('img', { name: '原题缩略图' })).toBeVisible();
  expect(await fallback.innerText()).not.toContain(id);
  await fallback.getByRole('button', { name: '题目操作', exact: true }).click();
  await fallback.getByRole('button', { name: '收藏', exact: true }).click();
  await expect(fallback.getByLabel('已收藏', { exact: true })).toBeVisible();
  await fallback.getByRole('button', { name: '题目操作', exact: true }).click();
  await fallback.getByRole('button', { name: '移除', exact: true }).click();
  await expect(page.getByText('删除这道题？', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '保留题目', exact: true }).click();
  await fallback.getByRole('button', { name: `打开物理题目 ${id}`, exact: true }).click();
  await expect(page.getByRole('tab', { name: '当前题目', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect(calls).toBe(0);
});
