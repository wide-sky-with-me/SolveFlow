import { test, expect, type Page } from '@playwright/test';
import { configureLocalModel, lastModelInput, modelPass, modelSse } from './local-fixture.js';

test.use({ launchOptions: { executablePath: process.env.SOLVEFLOW_TEST_CHROME ?? '/usr/bin/google-chrome', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });
async function openBatchCamera(page: Page) {
  await expect(page.getByRole('button', { name: '批量解题', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '拍照', exact: true }).click();
  await page.getByRole('button', { name: '批量解题', exact: true }).click();
  await page.getByRole('button', { name: '允许使用相机' }).evaluateAll(nodes => { for (const node of nodes) if (node instanceof HTMLElement) node.click(); });
  await expect(page.getByRole('dialog').getByRole('button', { name: '重命名批次', exact: true })).toContainText(/\d{4}-\d{2}-\d{2} \d{2}时 · \d{2}/);
}
test('camera gallery queues three background solves; compact history searches, renames and deletes their batch', async ({ page }) => {
  const releases: (() => void)[] = []; let solvers = 0; let verifiers = 0;
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    const body: unknown = route.request().postDataJSON(); const input = lastModelInput(body);
    if (typeof input !== 'object' || input === null || !('role' in input)) throw new Error('INPUT');
    if (input.role === 'verifier') { verifiers++; await route.fulfill({ contentType: 'text/event-stream', body: modelSse(modelPass) }); return; }
    const index = solvers++; await new Promise<void>(resolve => { releases[index] = resolve; });
    const number = ['19', '7', '11'][index];
    await route.fulfill({ contentType: 'text/event-stream', body: modelSse({ schemaVersion: 1, kind: 'answer', problem: { text: `batch fixture ${number}`, sourceNumber: number, subject: 'math', uncertainties: [] }, answer: `答案 ${number}`, steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] }, body) });
  });
  await page.goto('/'); await configureLocalModel(page); await openBatchCamera(page);
  await page.getByRole('button', { name: '重命名批次', exact: true }).click(); await page.getByRole('textbox', { name: '批次名称' }).fill('SAT 周一'); await page.getByRole('button', { name: '保存名称' }).click();
  const buffer = Buffer.from(await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 300; const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 600, 300); ctx.fillStyle = 'black'; ctx.fillText('19. x+1=3', 40, 100); return canvas.toDataURL('image/jpeg').split(',')[1]!; }), 'base64');
  for (let index = 1; index <= 3; index++) {
    const chooser = page.waitForEvent('filechooser'); await page.getByRole('dialog').getByRole('button', { name: '从相册选择', exact: true }).click(); await (await chooser).setFiles({ name: `batch-${index}.jpg`, mimeType: 'image/jpeg', buffer });
    await expect(page.getByRole('heading', { name: '确认图片顺序', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '导入并解题（1张）', exact: true }).click();
    await expect(page.getByText(`已保存 ${index} 张`, { exact: true })).toBeVisible();
  }
  await expect.poll(() => solvers).toBe(3);
  await page.getByRole('button', { name: '完成拍摄', exact: true }).click();
  await expect(page.getByTestId('current-batch')).toBeVisible();
  await expect(page.getByTestId('current-batch').getByText('SAT 周一', { exact: false })).toBeVisible(); // Queued work remains active.
  await page.getByRole('tab', { name: '历史题目', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '搜索关键词' })).toHaveCount(0);
  const bar = page.getByTestId('history-toolbar'); const box = await bar.boundingBox(); expect(box?.height).toBeLessThanOrEqual(48);
  await page.getByRole('tab', { name: '批量记录', exact: true }).click();
  await expect(page.getByRole('tab', { name: '批量记录', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: '打开批量', exact: true }).getByText('3 张题图', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '批次操作：SAT 周一', exact: true }).click(); await page.getByRole('button', { name: '重命名', exact: true }).click();
  await page.getByRole('textbox', { name: '批次名称' }).fill('SAT 英语与数学'); await page.getByRole('button', { name: '保存名称' }).click();
  releases[2]!(); await expect.poll(() => verifiers).toBe(1); releases[0]!(); releases[1]!(); await expect.poll(() => verifiers).toBe(3);
  await expect(page.getByText('解题中', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: '搜索历史题目', exact: true }).click(); await page.getByRole('textbox', { name: '搜索关键词' }).fill('sat 英语');
  await expect(page.getByRole('button', { name: '打开批量', exact: true }).getByText('SAT 英语与数学', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '搜索关键词' }).fill('找不到的内容'); await expect(page.getByText('没有找到匹配的批次')).toBeVisible();
  await page.getByRole('button', { name: '收起搜索', exact: true }).click(); await expect(page.getByRole('textbox', { name: '搜索关键词' })).toHaveCount(0); await expect(page.getByRole('button', { name: '打开批量', exact: true }).getByText('SAT 英语与数学', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '搜索历史题目', exact: true }).click(); await page.getByRole('textbox', { name: '搜索关键词' }).fill('原题号 7');
  await page.getByRole('button', { name: '打开批量', exact: true }).click(); await expect(page.getByText('题目 · 原题号 7', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: '当前题目', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: '返回', exact: true })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await page.goBack(); await expect(page.getByRole('tab', { name: '历史题目', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('textbox', { name: '搜索关键词' })).toHaveValue('原题号 7');
  await page.goForward(); await expect(page.getByText('题目 · 原题号 7', { exact: true })).toBeVisible();
  await page.goBack(); await page.getByRole('textbox', { name: '搜索关键词' }).fill('原题号 19');
  await page.getByRole('button', { name: '打开批量', exact: true }).click(); await expect(page.getByText('题目 · 原题号 19', { exact: true })).toBeVisible();
  for (const [index, number] of ['19', '7', '11'].entries()) { await page.getByRole('tab', { name: `跳转第${index + 1}题`, exact: true }).click(); await expect(page.getByText(`题目 · 原题号 ${number}`, { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: '校验通过', exact: true })).toBeVisible(); }
  await page.getByRole('navigation', { name: '主导航' }).getByRole('tab', { name: '题目', exact: true }).click();
  await expect(page.getByText('全部题目', { exact: true })).toBeVisible();
  await expect(page.getByText('共 3 题 · 点击快速跳转', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '快速跳转第2题', exact: true }).click();
  await expect(page.getByText('全部题目', { exact: true })).toHaveCount(0);
  await expect(page.getByText('题目 · 原题号 7', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '继续拍摄', exact: true })).toHaveCount(0); await page.getByRole('button', { name: '批次操作', exact: true }).click(); await expect(page.getByRole('button', { name: '继续拍摄', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const abandoned = page.waitForEvent('filechooser'); await page.getByRole('button', { name: '添加相册题图', exact: true }).click();
  const abandonedChooser = await abandoned; await page.goBack();
  await expect(page.getByRole('tab', { name: '历史题目', exact: true })).toHaveAttribute('aria-selected', 'true');
  await abandonedChooser.setFiles({ name: 'abandoned.jpg', mimeType: 'image/jpeg', buffer });
  await page.getByRole('tab', { name: '当前题目', exact: true }).click();
  await page.getByRole('button', { name: '批次操作', exact: true }).click();
  await expect(page.getByRole('button', { name: '添加相册题图', exact: true })).toBeEnabled();
  await expect(page.getByText('3 张题图', { exact: true })).toBeVisible(); expect(solvers).toBe(3);
  await page.reload(); await page.getByRole('tab', { name: '历史题目', exact: true }).click(); await page.getByRole('tab', { name: '批量记录', exact: true }).click(); await expect(page.getByRole('button', { name: '打开批量', exact: true }).getByText('SAT 英语与数学', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '批次操作：SAT 英语与数学', exact: true }).click(); await page.getByRole('button', { name: '删除本批', exact: true }).click(); await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.getByText('还没有批量解题记录。', { exact: true })).toBeVisible(); expect(solvers).toBe(3); expect(verifiers).toBe(3);
});

test('batch capture keeps preview geometry stable while a photo is being saved', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.addInitScript(() => {
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    let held = false;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      return toBlob.call(this, blob => {
        if (held) { callback(blob); return; }
        held = true;
        document.documentElement.dataset.cameraBlobWaiting = 'true';
        window.addEventListener('test:finish-camera-photo', () => callback(blob), { once: true });
      }, type, quality);
    };
  });
  await page.route('https://fixture-model.invalid/v1/chat/completions', route => route.abort());
  await page.goto('/'); await configureLocalModel(page); await openBatchCamera(page);
  const preview = page.locator('video');
  const before = await preview.boundingBox(); expect(before).not.toBeNull();
  await page.getByRole('button', { name: '拍摄', exact: true }).click();
  await expect(page.getByRole('button', { name: '切换镜头', exact: true })).toBeDisabled();
  const during = await preview.boundingBox(); expect(during).not.toBeNull();
  try {
    expect(Math.abs(during!.height - before!.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(during!.y - before!.y)).toBeLessThanOrEqual(1);
  } finally {
    await expect(page.locator('html')).toHaveAttribute('data-camera-blob-waiting', 'true');
    await page.evaluate(() => window.dispatchEvent(new Event('test:finish-camera-photo')));
  }
  await expect(page.getByText('已保存 1 张', { exact: true })).toBeVisible();
  const after = await preview.boundingBox(); expect(after).toEqual(before);
  await page.getByRole('button', { name: '完成拍摄', exact: true }).click();
});

test('continuous capture keeps the camera live, groups shots and finishes in the captured batch', async ({ page }) => {
  let calls = 0;
  const candidate = { schemaVersion: 1, kind: 'answer', problem: { text: 'virtual camera fixture', subject: 'math', uncertainties: [] }, answer: '2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => { calls++; const body: unknown = route.request().postDataJSON(); const input = lastModelInput(body); const verifier = typeof input === 'object' && input !== null && 'role' in input && input.role === 'verifier'; await route.fulfill({ contentType: 'text/event-stream', body: modelSse(verifier ? modelPass : candidate, body) }); });
  await page.goto('/'); await configureLocalModel(page); await openBatchCamera(page);
  const shutter = page.getByRole('button', { name: '拍摄', exact: true }); await expect(shutter).toBeEnabled();
  const stream = await page.locator('video').evaluateHandle(node => node instanceof HTMLVideoElement ? node.srcObject : null);
  for (let index = 1; index <= 2; index++) { await shutter.click(); await expect(page.getByText(`已保存 ${index} 张`, { exact: true })).toBeVisible(); await expect(shutter).toBeEnabled(); expect(await stream.evaluate(value => value instanceof MediaStream && value.getVideoTracks()[0]?.readyState === 'live')).toBe(true); }
  await page.getByRole('button', { name: '完成拍摄', exact: true }).click();
  expect(await stream.evaluate(value => value instanceof MediaStream && value.getTracks().every(track => track.readyState === 'ended'))).toBe(true); await stream.dispose();
  await expect(page.getByTestId('current-batch')).toBeVisible(); await expect.poll(() => calls).toBe(4);
  await page.getByRole('tab', { name: '历史题目', exact: true }).click(); await page.getByRole('tab', { name: '批量记录', exact: true }).click(); await expect(page.getByRole('button', { name: '打开批量', exact: true }).getByText('2 张题图', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '打开批量', exact: true }).click(); await expect(page.getByRole('button', { name: '校验通过', exact: true })).toBeVisible();
  await page.reload(); await page.getByRole('tab', { name: '历史题目', exact: true }).click(); await page.getByRole('tab', { name: '批量记录', exact: true }).click(); await expect(page.getByRole('button', { name: '打开批量', exact: true }).getByText('2 张题图', { exact: false })).toBeVisible(); expect(calls).toBe(4);
});

test('finishing a new batch replaces the previous current batch and empty capture preserves it', async ({ page }) => {
  const candidate = { schemaVersion: 1, kind: 'answer', problem: { text: 'virtual camera fixture', subject: 'math', uncertainties: [] }, answer: '2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    const body: unknown = route.request().postDataJSON(); const input = lastModelInput(body);
    const verifier = typeof input === 'object' && input !== null && 'role' in input && input.role === 'verifier';
    await route.fulfill({ contentType: 'text/event-stream', body: modelSse(verifier ? modelPass : candidate, body) });
  });
  await page.goto('/'); await configureLocalModel(page);
  for (const name of ['旧批次', '本次拍摄']) {
    await openBatchCamera(page);
    await page.getByRole('dialog').getByRole('button', { name: '重命名批次', exact: true }).click();
    await page.getByRole('textbox', { name: '批次名称' }).fill(name); await page.getByRole('button', { name: '保存名称' }).click();
    await page.getByRole('button', { name: '拍摄', exact: true }).click(); await expect(page.getByText('已保存 1 张', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '完成拍摄', exact: true }).click();
    await expect(page.getByTestId('current-batch').getByRole('button', { name: '重命名批次', exact: true })).toContainText(name);
    await expect(page.getByRole('button', { name: '校验通过', exact: true })).toBeVisible();
  }
  await openBatchCamera(page); await page.getByRole('button', { name: '完成拍摄', exact: true }).click();
  await expect(page.getByTestId('current-batch').getByRole('button', { name: '重命名批次', exact: true })).toContainText('本次拍摄');
});
