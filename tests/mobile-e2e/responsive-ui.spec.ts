import { expect, test, type Locator } from '@playwright/test';
import { chooseSyntheticPhoto, configureLocalModel } from './local-fixture.js';

test.use({ reducedMotion: 'reduce' });

async function visibleAndReachable(control: Locator) {
  await expect(control).toBeInViewport({ ratio: 1 });
  await expect.poll(() => control.evaluate(node => {
    const box = node.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return hit !== null && node.contains(hit);
  })).toBe(true);
}

test('short landscape keeps photo and model setup actions on the first screen', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByTestId('launch-screen')).toHaveCount(0);
  for (const viewport of [{ width: 568, height: 320 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    for (const name of ['拍一张', '从相册选择', '配置模型与考试类型']) {
      await visibleAndReachable(page.getByRole('button', { name, exact: true }));
    }
    await page.screenshot({ path: testInfo.outputPath(`home-${viewport.width}.png`) });
  }
});

test('desktop navigation and materials stay aligned with the question area', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByTestId('launch-screen')).toHaveCount(0);
  const panel = await page.getByTestId('empty-camera').boundingBox();
  if (!panel) throw new Error('MISSING_QUESTION_PANEL');
  for (const name of ['题目', '我的']) {
    const tab = page.getByRole('tab', { name, exact: true });
    const box = await tab.boundingBox();
    if (!box) throw new Error('MISSING_NAVIGATION_TAB');
    expect(box.x).toBeGreaterThanOrEqual(panel.x - 10);
    expect(box.x + box.width).toBeLessThanOrEqual(panel.x + panel.width + 10);
    expect(await tab.evaluate(node => {
      const text = [...node.querySelectorAll('*')].find(child => child.children.length === 0 && child.textContent === node.getAttribute('aria-label'));
      return text ? parseFloat(getComputedStyle(text).fontSize) : 0;
    })).toBeGreaterThanOrEqual(12);
  }
  await chooseSyntheticPhoto(page);
  await page.getByRole('button', { name: '保存题目', exact: true }).click();
  const materials = page.getByRole('button', { name: '同题材料 / 补图', exact: true });
  await expect(materials).toBeVisible();
  const box = await materials.boundingBox();
  if (!box) throw new Error('MISSING_MATERIALS_ENTRY');
  expect(box.x).toBeCloseTo(panel.x, 0);
  expect(box.width).toBeCloseTo(panel.width, 0);
});

test('advanced model values survive collapse, save and reopening', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/');
  await configureLocalModel(page);
  await page.getByRole('tab', { name: '我的', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const solver = page.getByRole('region', { name: '解题模型', exact: true });
  const advanced = solver.getByRole('button', { name: '解题高级参数', exact: true });
  await expect(page.getByLabel('解题上下文容量', { exact: true })).toHaveCount(0);
  await advanced.click();
  await page.getByLabel('解题上下文容量', { exact: true }).fill('65536');
  await page.getByLabel('解题最大输出 tokens', { exact: true }).fill('4096');
  await advanced.click();
  await expect(advanced).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await page.getByRole('tab', { name: '我的', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await advanced.click();
  await expect(page.getByLabel('解题上下文容量', { exact: true })).toHaveValue('65536');
  await expect(page.getByLabel('解题最大输出 tokens', { exact: true })).toHaveValue('4096');
  await page.getByLabel('解题最大输出 tokens', { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: '返回', exact: true })).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('advanced-settings.png') });
});
