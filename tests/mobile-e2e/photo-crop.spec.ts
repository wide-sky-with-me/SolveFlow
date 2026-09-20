import { test, expect, type Page } from '@playwright/test';
async function drag(page: Page, mobile: boolean, from: { x: number; y: number }, to: { x: number; y: number }) {
  from = { x: Math.round(from.x), y: Math.round(from.y) }; to = { x: Math.round(to.x), y: Math.round(to.y) };
  if (!mobile) { await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 12 }); await page.mouse.up(); return; }
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 0 }] });
    for (let step = 1; step <= 12; step++) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * step / 12, y: from.y + (to.y - from.y) * step / 12, id: 0 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await session.detach(); }
}
async function openPhoto(page: Page) {
  await page.goto('/'); await expect(page.getByRole('button', { name: '拍照', exact: true })).toBeVisible();
  const buffer = Buffer.from(await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 1200; const c = canvas.getContext('2d')!; c.fillStyle = '#f00'; c.fillRect(0, 0, 800, 600); c.fillStyle = '#00f'; c.fillRect(0, 600, 800, 600); return canvas.toDataURL('image/png').split(',')[1]!; }), 'base64');
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: '从相册选择', exact: true }).click(); await (await chooser).setFiles({ name: 'synthetic-crop.png', mimeType: 'image/png', buffer });
  await expect(page.getByRole('img', { name: '裁切预览' })).toBeVisible();
  // Coordinate gestures need the modal slide animation to finish; visibility alone is insufficient.
  await page.getByLabel('拖动左上角', { exact: true }).click({ trial: true });
}
test('drags crop corners and selection with mouse or touch and exports the selected pixels', async ({ page, isMobile }) => {
  await openPhoto(page);
  await expect(page.getByRole('button', { name: '左边界增大' })).toHaveCount(0);
  const preview = await page.getByRole('img', { name: '裁切预览' }).boundingBox(); if (!preview) throw new Error('NO_PREVIEW');
  const point = (x: number, y: number) => ({ x: Math.round(preview.x + preview.width * x), y: Math.round(preview.y + preview.height * y) });
  // Integer pointer deltas avoid browser MouseEvent subpixel rounding.
  const qx = Math.round(preview.width / 4); const qy = Math.round(preview.height / 4);
  const sx = Math.round(preview.width / 10); const sy = Math.round(preview.height / 10);
  await drag(page, isMobile, point(0, 0), { x: point(0, 0).x + qx, y: point(0, 0).y + qy });
  await drag(page, isMobile, point(1, 1), { x: point(1, 1).x - qx, y: point(1, 1).y - qy });
  const selection = page.getByLabel('移动裁切选框', { exact: true });
  await expect.poll(async () => (await selection.boundingBox())?.width ?? 0).toBeCloseTo(preview.width - 2 * qx, 0);
  await drag(page, isMobile, point(.5, .5), { x: point(.5, .5).x + sx, y: point(.5, .5).y + sy });
  const moved = await selection.boundingBox(); if (!moved) throw new Error('NO_SELECTION');
  expect(moved.x).toBeCloseTo(preview.x + qx + sx, 0); expect(moved.y).toBeCloseTo(preview.y + qy + sy, 0);
  expect(moved.width).toBeCloseTo(preview.width - 2 * qx, 0);
  await page.getByRole('button', { name: '使用这张题图', exact: true }).click();
  await expect(page.getByText('确认与裁切题图', { exact: true })).toHaveCount(0);
  const output = page.getByRole('img', { name: '待解答的题目', exact: true }); await expect(output).toBeVisible();
  await expect.poll(() => output.evaluate(node => node instanceof HTMLImageElement ? node.naturalWidth : 0)).toBeLessThan(800);
  const image = await output.evaluate(async node => {
    if (!(node instanceof HTMLImageElement)) throw new Error('IMAGE_REQUIRED');
    await node.decode();
    const c = document.createElement('canvas'); c.width = node.naturalWidth; c.height = node.naturalHeight;
    const ctx = c.getContext('2d')!; ctx.drawImage(node, 0, 0);
    return { width: c.width, height: c.height, top: Array.from(ctx.getImageData(10, 10, 1, 1).data), bottom: Array.from(ctx.getImageData(10, c.height - 10, 1, 1).data) };
  });
  const expectedWidth = Math.ceil((preview.width - qx + sx) / preview.width * 800) - Math.floor((qx + sx) / preview.width * 800);
  const expectedHeight = Math.ceil((preview.height - qy + sy) / preview.height * 1200) - Math.floor((qy + sy) / preview.height * 1200);
  expect(Math.abs(image.width - expectedWidth)).toBeLessThanOrEqual(1); expect(Math.abs(image.height - expectedHeight)).toBeLessThanOrEqual(1);
  expect(image.top[0]).toBeGreaterThan(240); expect(image.top[2]).toBeLessThan(15); expect(image.bottom[2]).toBeGreaterThan(240); expect(image.bottom[0]).toBeLessThan(15);
});
test('crop preview and confirmation fit narrow portrait and landscape screens, with reset and fine controls', async ({ page, isMobile }) => {
  await page.setViewportSize({ width: 320, height: 640 }); await openPhoto(page);
  for (const size of [{ width: 320, height: 640 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size);
    const apply = page.getByRole('button', { name: '使用这张题图', exact: true });
    await expect.poll(async () => { const box = await apply.boundingBox(); return box ? box.y + box.height : 10000; }).toBeLessThanOrEqual(size.height);
    await page.getByLabel('拖动左上角', { exact: true }).click({ trial: true });
    const preview = await page.getByRole('img', { name: '裁切预览' }).boundingBox(); if (!preview) throw new Error('NO_PREVIEW');
    expect(preview.y).toBeGreaterThan(0); expect(preview.y + preview.height).toBeLessThan(size.height);
    const center = { x: Math.round(preview.x), y: Math.round(preview.y + preview.height / 2) };
    const delta = Math.round(preview.width * .2);
    await drag(page, isMobile, center, { ...center, x: center.x + delta });
    await expect.poll(async () => (await page.getByLabel('移动裁切选框', { exact: true }).boundingBox())?.width ?? 0).toBeCloseTo(preview.width - delta, 0);
    await page.getByRole('button', { name: '恢复完整图片' }).click();
    await expect.poll(async () => (await page.getByLabel('移动裁切选框', { exact: true }).boundingBox())?.width ?? 0).toBeCloseTo(preview.width, 0);
  }
  await page.setViewportSize({ width: 320, height: 640 });
  await page.getByRole('button', { name: '精细调整' }).click(); await page.getByRole('button', { name: '左边界增大' }).click(); await expect(page.getByText('左边界 2%', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '收起微调' }).click(); await page.getByRole('button', { name: '取消裁切' }).click();
  await expect(page.getByText('确认与裁切题图', { exact: true })).toHaveCount(0);
  const original = page.getByRole('img', { name: '待解答的题目', exact: true });
  await expect(original).toBeVisible();
  expect(await original.evaluate(node => node instanceof HTMLImageElement ? node.naturalWidth : 0)).toBe(800);
});
