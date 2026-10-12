import { expect, test } from '@playwright/test';

test('one top-level manual stopwatch continues across pages and restores after reload without model calls', async ({ page }, info) => {
  let posts = 0; page.on('request', request => { if (request.method() === 'POST') posts++; });
  await page.goto('/');
  const timer = page.getByTestId('study-stopwatch'); await expect(timer).toHaveCount(1);
  await expect(timer).toContainText('00:00:00'); await expect(timer.getByRole('button', { name: '开始计时', exact: true })).toBeEnabled();
  await expect(timer.getByRole('button', { name: '重置计时', exact: true })).toBeDisabled();
  const bar = page.getByTestId('workspace-timer-bar'); const box = await bar.boundingBox();
  expect(box?.y).toBeLessThan(80);
  await timer.getByRole('button', { name: '开始计时', exact: true }).click();
  await expect.poll(() => timer.innerText()).not.toContain('00:00:00');
  await page.getByRole('tab', { name: '我的', exact: true }).click();
  await expect(timer.getByRole('button', { name: '停止计时', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '题目', exact: true }).click(); await page.getByRole('tab', { name: '历史题目', exact: true }).click();
  await expect(timer).toHaveCount(1); await expect(timer.getByRole('button', { name: '停止计时', exact: true })).toBeVisible();
  await timer.getByRole('button', { name: '停止计时', exact: true }).click();
  await expect(timer.getByRole('button', { name: '继续计时', exact: true })).toBeEnabled();
  const stopped = await timer.getByLabel('整体做题用时', { exact: true }).innerText();
  await page.reload(); await expect(timer.getByLabel('整体做题用时', { exact: true })).toHaveText(stopped);
  await expect(timer.getByRole('button', { name: '继续计时', exact: true })).toBeEnabled();
  await timer.getByRole('button', { name: '重置计时', exact: true }).click(); await expect(timer).toContainText('00:00:00');
  expect(posts).toBe(0); await page.screenshot({ path: info.outputPath('overall-stopwatch.png') });
});

test('top stopwatch and profile hover stay contained at narrow and wide widths in both themes', async ({ page }, info) => {
  await page.goto('/'); await page.getByRole('tab', { name: '我的', exact: true }).click();
  for (const width of [320, 390, 1100, 1280, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(page.getByTestId('study-stopwatch')).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('button', { name: '开始计时', exact: true })).toBeInViewport({ ratio: 1 });
      const controls = page.getByTestId('stopwatch-controls'); const controlBox = await controls.boundingBox();
      await expect(page.getByTestId('stopwatch-time')).toHaveCSS('font-size', '20px');
      for (const button of await controls.getByRole('button').all()) {
        const box = await button.boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(44); expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(Math.abs(box!.y + box!.height / 2 - controlBox!.y - controlBox!.height / 2)).toBeLessThan(.5);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width === 320) await page.screenshot({ path: info.outputPath(`stopwatch-${width}-${colorScheme}.png`) });
      if (width >= 1100) {
        const timerBox = await page.getByTestId('workspace-timer-bar').boundingBox();
        const brand = await page.getByTestId('desktop-brand').boundingBox();
        const navigation = await page.getByTestId('navigation-items').boundingBox();
        expect(brand!.x + brand!.width).toBeLessThanOrEqual(timerBox!.x);
        expect(timerBox!.x + timerBox!.width).toBeLessThanOrEqual(navigation!.x);
        const menu = page.getByTestId('profile-menu'); const settings = page.getByRole('button', { name: '设置', exact: true });
        const m = await menu.boundingBox(); const b = await settings.boundingBox();
        expect(b!.x - m!.x).toBeGreaterThanOrEqual(8); expect(m!.x + m!.width - b!.x - b!.width).toBeGreaterThanOrEqual(8);
        await settings.hover(); await expect(settings).toHaveCSS('border-radius', '12px');
        await page.screenshot({ path: info.outputPath(`profile-${width}-${colorScheme}.png`) });
      }
    }
  }
});
