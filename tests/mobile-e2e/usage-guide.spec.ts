import { expect, test } from '@playwright/test';

test('illustrated usage guide explains current exports and stays readable with a fixed exit', async ({ page }, info) => {
  let modelRequests = 0; let posts = 0; const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message)); page.on('request', request => { if (request.method() === 'POST') posts++; });
  await page.route('**/__solveflow/web-env/model/**', route => { modelRequests++; return route.abort(); });
  await page.goto('/'); await expect(page.getByTestId('launch-screen')).toBeHidden();
  await page.getByRole('tab', { name: '我的', exact: true }).click(); const help = page.getByRole('button', { name: '使用说明', exact: true }); await help.click();
  const guide = page.getByTestId('usage-guide'); await expect(guide).toBeVisible();
  for (const title of ['快速开始', '批量导入与顺序', '查看、补图与核对', '网页版：导出试卷', '网页版：标记错题与自动续页', '网页版：下载与导出记录', '历史与图片', '保存与恢复']) await expect(guide.getByRole('heading', { name: title, exact: true })).toHaveCount(1);
  await expect(guide).toContainText('默认计对是导出假定，不代表答案已核实'); await expect(guide).toContainText('表格续页重复表头');
  await expect(guide).toContainText('默认全部计对，忽略原有失败或红色警告');
  await expect(guide).toContainText('本地估计的复杂度随机分散选题');
  await expect(guide).toContainText('没有保存作答的题保持空白');
  await expect(guide).toContainText('通知8秒后收起'); await expect(guide).toContainText('备份不包含模型密钥或模型设置');
  const figures = guide.getByTestId('usage-guide-figure'); await expect(figures).toHaveCount(9);
  for (const [title, count] of [['快速开始', 2], ['批量导入与顺序', 1], ['查看、补图与核对', 1], ['历史与图片', 1], ['保存与恢复', 1]] as const) {
    await expect(guide.getByRole('region', { name: title, exact: true }).getByTestId('usage-guide-figure')).toHaveCount(count);
  }
  const images = figures.locator('img'); await expect(images).toHaveCount(9);
  await expect.poll(() => images.evaluateAll(nodes => nodes.every(node => node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0))).toBe(true);
  const imagesFit = () => images.evaluateAll(nodes => nodes.every(node => {
    if (!(node instanceof HTMLImageElement) || !node.parentElement) return false;
    const box = node.parentElement.getBoundingClientRect();
    return box.width > 0 && Math.abs(box.height - box.width * node.naturalHeight / node.naturalWidth) <= 3;
  }));
  await expect.poll(imagesFit).toBe(true);
  const close = guide.getByRole('button', { name: '返回', exact: true });
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme }); await guide.getByRole('heading', { name: '网页版：导出试卷', exact: true }).scrollIntoViewIfNeeded();
    await figures.first().scrollIntoViewIfNeeded(); await expect.poll(imagesFit).toBe(true);
    await expect(close).toBeInViewport({ ratio: 1 });
    expect(await guide.getByTestId('usage-guide-scroll').evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    for (const figure of await figures.all()) expect(await figure.evaluate(node => { const parent = node.parentElement; if (!parent) throw new Error('GUIDE_FIGURE_PARENT'); return node.getBoundingClientRect().width <= parent.getBoundingClientRect().width + 1; })).toBe(true);
    await page.screenshot({ path: info.outputPath(`usage-guide-${colorScheme}.png`) });
  }
  await page.setViewportSize({ width: 320, height: 700 }); await guide.getByRole('button', { name: '明白了', exact: true }).scrollIntoViewIfNeeded();
  await expect.poll(imagesFit).toBe(true);
  await expect(close).toBeInViewport({ ratio: 1 });
  expect(await guide.getByTestId('usage-guide-scroll').evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('usage-guide-narrow-end.png') });
  await guide.getByRole('button', { name: '明白了', exact: true }).click(); await expect(guide).toBeHidden();
  await help.click(); await expect(guide).toBeVisible(); await close.click(); await expect(guide).toBeHidden();
  await help.focus(); await page.keyboard.press('Enter'); await expect(guide).toBeVisible();
  await expect(page.getByRole('dialog').filter({ has: guide })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(guide).toBeHidden();
  expect(modelRequests).toBe(0); expect(posts).toBe(0); expect(errors).toEqual([]);
});
