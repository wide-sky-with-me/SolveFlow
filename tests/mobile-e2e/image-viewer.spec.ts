import { expect, test } from '@playwright/test';
import { SessionViewSchema } from '../../packages/contracts/src/http.js';
import { seedLocalSession } from './local-fixture.js';

test('keyboard panning reaches image edges, stays bounded and resets with zoom', async ({ page }) => {
  await page.setViewportSize({ width: 568, height: 320 });
  const id = '90000000-0000-4000-8000-000000000072';
  const image = await page.screenshot({ type: 'jpeg' });
  const session = SessionViewSchema.parse({ schemaVersion: 1, id, subject: 'math', createdAt: '2026-10-07T08:03:07.000Z', runs: [], upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', width: 568, height: 320, bytes: image.length, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` } });
  let calls = 0; page.on('request', request => { if (request.method() === 'POST') calls++; });
  await seedLocalSession(page, session, image);
  await page.getByRole('button', { name: '查看题目图片', exact: true }).click();
  const viewport = page.getByTestId('image-zoom-viewport');
  const picture = page.getByRole('img', { name: '原始题图大图', exact: true });
  await viewport.focus(); await page.keyboard.press('+'); await page.keyboard.press('+');
  await expect(viewport).toHaveAttribute('aria-valuenow', '200');
  const centered = await picture.boundingBox(); if (!centered) throw new Error('NO_IMAGE');
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await picture.boundingBox())!.x).toBeLessThan(centered.x - 1);
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await picture.boundingBox())!.y).toBeLessThan(centered.y - 1);
  await expect(viewport).toHaveAttribute('aria-valuenow', '200');
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await picture.boundingBox())!.x).toBeCloseTo(centered.x, 0);
  await expect.poll(async () => (await picture.boundingBox())!.y).toBeCloseTo(centered.y, 0);
  const view = await viewport.boundingBox(); if (!view) throw new Error('NO_VIEWPORT');
  for (let index = 0; index < 20; index++) await page.keyboard.press('ArrowRight');
  await expect.poll(async () => { const box = (await picture.boundingBox())!; return box.x + box.width; }).toBeCloseTo(view.x + view.width, 0);
  const rightEdge = await picture.boundingBox();
  await page.keyboard.press('ArrowRight'); expect(await picture.boundingBox()).toEqual(rightEdge);
  for (let index = 0; index < 40; index++) await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await picture.boundingBox())!.x).toBeCloseTo(view.x, 0);
  for (let index = 0; index < 20; index++) await page.keyboard.press('ArrowDown');
  await expect.poll(async () => { const box = (await picture.boundingBox())!; return box.y + box.height; }).toBeCloseTo(view.y + view.height, 0);
  const bottomEdge = await picture.boundingBox();
  await page.keyboard.press('ArrowDown'); expect(await picture.boundingBox()).toEqual(bottomEdge);
  for (let index = 0; index < 40; index++) await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await picture.boundingBox())!.y).toBeCloseTo(view.y, 0);
  await page.keyboard.press('0'); await expect(viewport).toHaveAttribute('aria-valuenow', '100');
  await expect.poll(async () => { const box = (await picture.boundingBox())!; return Math.abs(box.x + box.width / 2 - view.x - view.width / 2) + Math.abs(box.y + box.height / 2 - view.y - view.height / 2); }).toBeLessThan(1);
  await page.keyboard.press('-'); await expect(viewport).toHaveAttribute('aria-valuenow', '100');
  await page.getByRole('button', { name: '关闭大图', exact: true }).click();
  expect(calls).toBe(0);
});

test('original image supports bounded zoom, dragging, reset and reopening without model calls', async ({ page }, info) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: (data: ShareData) => !!data.files?.length });
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (data: ShareData) => {
      const file = data.files?.[0];
      document.documentElement.dataset.sharedImage = JSON.stringify({ type: file?.type, size: file?.size, name: file?.name });
      document.documentElement.dataset.shareCount = String(Number(document.documentElement.dataset.shareCount ?? 0) + 1);
    } });
  });
  const id = '90000000-0000-4000-8000-000000000071';
  const image = await page.screenshot({ type: 'jpeg' });
  const size = page.viewportSize()!;
  const session = SessionViewSchema.parse({ schemaVersion: 1, id, subject: 'math', createdAt: '2026-09-20T08:03:07.000Z', runs: [], upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', ...size, bytes: image.length, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` } });
  let calls = 0; page.on('request', request => { if (request.method() === 'POST') calls++; });
  await seedLocalSession(page, session, image);
  await page.getByRole('button', { name: '查看题目图片', exact: true }).click();
  const viewport = page.getByTestId('image-zoom-viewport');
  const picture = page.getByRole('img', { name: '原始题图大图', exact: true });
  await expect(viewport).toHaveAttribute('aria-valuenow', '100');
  await expect(picture).toBeVisible();
  await viewport.click({ delay: 650 });
  await expect.poll(() => page.evaluate(() => Number(document.documentElement.dataset.shareCount))).toBe(1);
  expect(await page.evaluate(() => JSON.parse(document.documentElement.dataset.sharedImage!))).toEqual({ type: 'image/jpeg', size: image.length, name: 'solveflow-question.jpg' });
  await expect(page.getByRole('button', { name: /^(放大|缩小|适应屏幕|放大原题图)$/ })).toHaveCount(0);
  // Wait for the Modal animation to settle before sending absolute coordinates.
  await viewport.click({ trial: true });
  const box = await viewport.boundingBox(); if (!box) throw new Error('NO_VIEWPORT');
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const fittedWidth = (await picture.boundingBox())!.width;
  if (info.project.name === 'mobile') {
    const cdp = await page.context().newCDPSession(page);
    const points = (distance: number) => [{ id: 1, x: center.x - distance / 2, y: center.y }, { id: 2, x: center.x + distance / 2, y: center.y }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(60) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(120) });
    await expect(viewport).toHaveAttribute('aria-valuenow', '200');
    await expect.poll(async () => (await picture.boundingBox())!.width).toBeCloseTo(fittedWidth * 2, 0);
    const zoomed = await picture.boundingBox(); if (!zoomed) throw new Error('NO_IMAGE');
    // Lift one finger, then continue panning with the remaining one, without jumping.
    const lifted = points(120).slice(0, 1);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: lifted });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 2, x: center.x + 100, y: center.y + 30 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => (await picture.boundingBox())!.x - zoomed.x).toBeCloseTo(40, 0);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(60) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(240) });
    await expect(viewport).toHaveAttribute('aria-valuenow', '400');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(10) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(viewport).toHaveAttribute('aria-valuenow', '100');
    expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
    await cdp.detach();
  } else {
    await viewport.dblclick();
    await expect(viewport).toHaveAttribute('aria-valuenow', '200');
    await expect.poll(async () => (await picture.boundingBox())!.width).toBeCloseTo(fittedWidth * 2, 0);
    const zoomed = await picture.boundingBox(); if (!zoomed) throw new Error('NO_IMAGE');
    await page.mouse.move(center.x, center.y); await page.mouse.down();
    await page.mouse.move(center.x + 40, center.y + 30, { steps: 3 }); await page.mouse.up();
    await expect.poll(async () => (await picture.boundingBox())!.x - zoomed.x).toBeCloseTo(40, 0);
  }
  // Double tap toggles zoom without a visible toolbar.
  await viewport.dblclick();
  const expected = info.project.name === 'mobile' ? '200' : '100';
  await expect(viewport).toHaveAttribute('aria-valuenow', expected);
  await page.getByRole('button', { name: '关闭大图', exact: true }).click();
  await page.getByRole('button', { name: '查看题目图片', exact: true }).click();
  await expect(viewport).toHaveAttribute('aria-valuenow', '100');
  if (info.project.name === 'desktop') {
    await viewport.focus(); await page.keyboard.press('+');
    await expect(viewport).toHaveAttribute('aria-valuenow', '150');
    await page.keyboard.press('0');
    await expect(viewport).toHaveAttribute('aria-valuenow', '100');
  }
  await page.setViewportSize({ width: 700, height: 390 });
  await expect.poll(async () => { const view = await viewport.boundingBox(); const img = await picture.boundingBox(); return !!view && !!img && img.width <= view.width + 1 && img.height <= view.height + 1; }).toBe(true);
  await page.getByRole('button', { name: '关闭大图', exact: true }).click();
  await expect(viewport).toHaveCount(0);
  // Zoom, drag, quick taps and closing never trigger additional shares.
  expect(await page.evaluate(() => Number(document.documentElement.dataset.shareCount))).toBe(1);
  expect(calls).toBe(0);
});
