import { configureLocalModel, chooseSyntheticPhoto, modelSse, modelPass } from './local-fixture.js';
import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
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
  await page.getByRole('button', { name: '查看题目图片', exact: true }).click();
  await expect(page.getByRole('img', { name: '原始题图大图' })).toBeVisible();
  await page.getByRole('button', { name: '关闭大图' }).click();
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

test('saving a cropped photo preserves the preview JPEG without recompressing it', async ({ page }) => {
  await page.addInitScript(() => {
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = value => {
      const uri = create(value);
      if (value instanceof Blob && value.type === 'image/jpeg') {
        const reader = new FileReader();
        reader.onload = () => { if (typeof reader.result === 'string') sessionStorage.setItem('solveflow-test-preview-jpeg', reader.result); };
        reader.readAsDataURL(value);
      }
      return uri;
    };
  });
  await page.goto('/'); await expect(page.getByRole('button', { name: '拍照', exact: true })).toBeVisible();
  const image = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 600;
    const context = canvas.getContext('2d'); if (!context) throw new Error('CANVAS_REQUIRED');
    const pixels = context.createImageData(canvas.width, canvas.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const n = i / 4; pixels.data[i] = (n * 31) % 256; pixels.data[i + 1] = (n * 17) % 256; pixels.data[i + 2] = (n * 7) % 256; pixels.data[i + 3] = 255;
    }
    context.putImageData(pixels, 0, 0); return canvas.toDataURL('image/png').split(',')[1]!;
  });
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: '从相册选择' }).click();
  await (await chooser).setFiles({ name: 'synthetic-detail.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
  await page.getByRole('button', { name: '精细调整', exact: true }).click();
  await page.getByRole('button', { name: '左边界增大', exact: true }).click();
  await page.getByRole('button', { name: '使用这张题图', exact: true }).click();
  const preview = page.getByRole('img', { name: '待解答的题目' }); await expect(preview).toBeVisible();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('solveflow-test-preview-jpeg'))).not.toBeNull();
  const encoded = await page.evaluate(() => sessionStorage.getItem('solveflow-test-preview-jpeg'));
  if (!encoded) throw new Error('PREVIEW_JPEG_REQUIRED');
  const hash = (value: string | null) => createHash('sha256').update(value ?? '').digest('hex');
  await page.getByRole('button', { name: '保存题目', exact: true }).click();
  await page.getByRole('button', { name: '查看题目图片', exact: true }).click();
  const saved = page.getByRole('img', { name: '原始题图大图' }); await expect(saved).toBeVisible();
  expect(hash(await saved.getAttribute('src'))).toBe(hash(encoded));
  await page.getByRole('button', { name: '关闭大图', exact: true }).click();
  await page.reload(); await page.getByRole('button', { name: '查看题目图片', exact: true }).click();
  await expect.poll(async () => hash(await page.getByRole('img', { name: '原始题图大图' }).getAttribute('src'))).toBe(hash(encoded));
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
