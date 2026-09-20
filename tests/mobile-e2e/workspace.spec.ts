import { configureLocalModel, chooseSyntheticPhoto, modelSse, modelPass } from './local-fixture.js';
import { test, expect } from '@playwright/test';
test('RN Web local photo → Pi → follow-up → reload → delete', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let calls = 0;
  const candidate = { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x = 2', steps: [{ id: 'a', title: '移项', explanation: '两边同时减1。' }], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
  await page.route('https://fixture-model.invalid/v1/chat/completions', route => route.fulfill({ contentType: 'text/event-stream', body: modelSse((++calls, candidate), route.request().postDataJSON()) }));
  await page.goto('/'); await configureLocalModel(page); await chooseSyntheticPhoto(page);
  await expect(page.getByRole('img', { name: '待解答的题目' })).toBeVisible();
  await page.getByRole('button', { name: '开始解题', exact: true }).click();
  await expect(page.getByRole('heading', { name: '答案', exact: true }).first()).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('x = 2', { exact: true })).toBeVisible(); await expect(page.getByText('未校验', { exact: true })).toBeVisible();
  const url = page.url(); expect(url).toContain('?session=');
  await expect(page.getByRole('img', { name: '待解答的题目' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '删除这道题', exact: true })).toHaveCount(0);
  await expect(page.locator('.teaching-steps')).toBeHidden();
  await page.locator('.step-details>summary').click();
  await expect(page.locator('.teaching-steps')).toBeVisible();
  await page.locator('.step-details>summary').click();
  await expect(page.locator('.teaching-steps')).toBeHidden();
  // Knowledge points are requested on demand, so the toggle is what the brief answer shows.
  await expect(page.getByLabel('知识点', { exact: true })).toBeVisible();
  await expect(page.locator('.problem-heading').getByRole('button', { name: '查看原图' })).toBeVisible();
  await page.getByRole('button', { name: '查看原图' }).click(); await expect(page.getByRole('img', { name: '原始题图大图' })).toBeVisible();
  await page.getByRole('button', { name: '放大查看', exact: true }).click();
  expect(await page.getByRole('img', { name: '原始题图大图' }).evaluate(node => node.getBoundingClientRect().width)).toBeGreaterThanOrEqual(900);
  await page.getByRole('button', { name: '适应屏幕' }).click(); await page.getByRole('button', { name: '关闭大图' }).click();
  await page.getByLabel('继续问这道题').fill('为什么要减去3？'); await page.getByRole('button', { name: '发送同题追问' }).click();
  await expect(page.getByRole('heading', { name: '追问解答' })).toBeVisible({ timeout: 20000 });
  await page.reload(); await expect(page.getByRole('heading', { name: '追问解答' })).toBeVisible();
  await page.getByRole('button', { name: '历史解答', exact: true }).click(); await page.getByRole('radio', { name: '第1次解答', exact: true }).click(); await expect(page.getByRole('heading', { name: '答案', exact: true }).first()).toBeVisible();
  await page.setViewportSize({ width: 320, height: 700 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('tab', { name: '历史题目', exact: true }).click(); await expect(page.getByRole('tab', { name: '历史题目', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: /^打开数学题目/ }).first().click();
  await page.screenshot({ path: `.runtime/screenshots/${info.project.name}-rn-workspace.png`, fullPage: true });
  await page.getByRole('tab', { name: '历史题目', exact: true }).click(); await page.getByRole('button', { name: '题目操作', exact: true }).click(); await page.getByRole('button', { name: '移除', exact: true }).click(); await page.getByRole('button', { name: '确认删除' }).click();
  await page.getByRole('tab', { name: '当前题目', exact: true }).click(); await expect(page.getByRole('button', { name: '拍一张' })).toBeVisible();
  await page.goto(url); await expect(page.getByRole('alert')).toContainText('本地题目不存在或已删除'); expect(errors).toEqual([]);
});
test('gallery validates decoded images before submission and preserves capture path', async ({ page }) => {
  await page.goto('/'); await expect(page.getByRole('button', { name: '拍照', exact: true })).toBeVisible();
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: '从相册选择' }).click();
  await (await chooser).setFiles({ name: 'fake.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('<svg/>') });
  await expect(page.getByRole('alert')).toContainText('无法读取图片');
  await expect(page.getByRole('button', { name: '保存题目', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '拍一张' })).toBeEnabled();
});

test('rotation swaps decoded image dimensions without submitting a solver request', async ({ page }) => {
  let calls = 0; page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/runs')) calls++; });
  await page.goto('/'); await expect(page.getByRole('button', { name: '拍照', exact: true })).toBeVisible(); await chooseSyntheticPhoto(page);
  const image = page.getByRole('img', { name: '待解答的题目' });
  const size = await image.evaluate(node => { if (!(node instanceof HTMLImageElement)) throw new Error('IMAGE_REQUIRED'); return [node.naturalWidth, node.naturalHeight]; });
  await page.getByRole('button', { name: '旋转图片' }).click();
  await expect.poll(() => image.evaluate(node => node instanceof HTMLImageElement ? [node.naturalWidth, node.naturalHeight] : [])).toEqual([size[1], size[0]]);
  expect(calls).toBe(0);
});
