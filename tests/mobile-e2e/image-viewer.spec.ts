import { expect, test } from '@playwright/test';
import { SessionViewSchema } from '../../packages/contracts/src/http.js';
import { seedLocalSession } from './local-fixture.js';

test('original image supports bounded zoom, dragging, reset and reopening without model calls', async ({ page }, info) => {
  const id = '90000000-0000-4000-8000-000000000071';
  const image = await page.screenshot({ type: 'jpeg' });
  const size = page.viewportSize()!;
  const session = SessionViewSchema.parse({ schemaVersion: 1, id, subject: 'math', createdAt: '2026-09-20T08:03:07.000Z', runs: [], upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', ...size, bytes: image.length, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` } });
  let calls = 0; page.on('request', request => { if (request.method() === 'POST') calls++; });
  await seedLocalSession(page, session, image);
  await page.getByRole('button', { name: '放大题图', exact: true }).click();
  const scale = page.getByTestId('image-zoom-scale');
  const viewport = page.getByTestId('image-zoom-viewport');
  const picture = page.getByRole('img', { name: '原始题图大图', exact: true });
  await expect(scale).toHaveText('100%');
  await expect(picture).toBeVisible();
  await expect(page.getByRole('button', { name: '缩小', exact: true })).toBeDisabled();
  // Wait for the Modal slide animation to settle before sending absolute coordinates.
  await viewport.click({ trial: true });
  const box = await viewport.boundingBox(); if (!box) throw new Error('NO_VIEWPORT');
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  if (info.project.name === 'mobile') {
    const cdp = await page.context().newCDPSession(page);
    const points = (distance: number) => [{ id: 1, x: center.x - distance / 2, y: center.y }, { id: 2, x: center.x + distance / 2, y: center.y }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(60) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(120) });
    await expect(scale).toHaveText('200%');
    const zoomed = await picture.boundingBox(); if (!zoomed) throw new Error('NO_IMAGE');
    // Lift one finger, then continue panning with the remaining one, without jumping.
    const lifted = points(120).slice(0, 1);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: lifted });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 2, x: center.x + 100, y: center.y + 30 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => (await picture.boundingBox())!.x - zoomed.x).toBeCloseTo(40, 0);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(60) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(240) });
    await expect(scale).toHaveText('400%');
    await expect(page.getByRole('button', { name: '放大', exact: true })).toBeDisabled();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(10) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(scale).toHaveText('100%');
    expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
    await cdp.detach();
  } else {
    for (let i = 0; i < 6; i++) await page.getByRole('button', { name: '放大', exact: true }).click();
    await expect(scale).toHaveText('400%');
    await expect(page.getByRole('button', { name: '放大', exact: true })).toBeDisabled();
    const zoomed = await picture.boundingBox(); if (!zoomed) throw new Error('NO_IMAGE');
    await page.mouse.move(center.x, center.y); await page.mouse.down();
    await page.mouse.move(center.x + 40, center.y + 30, { steps: 3 }); await page.mouse.up();
    await expect.poll(async () => (await picture.boundingBox())!.x - zoomed.x).toBeCloseTo(40, 0);
  }
  if (await page.getByRole('button', { name: '放大', exact: true }).isEnabled()) await page.getByRole('button', { name: '放大', exact: true }).click();
  await page.getByRole('button', { name: '适应屏幕', exact: true }).click();
  await expect(scale).toHaveText('100%');
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await page.getByRole('button', { name: '关闭大图', exact: true }).click();
  await page.getByRole('button', { name: '放大题图', exact: true }).click();
  await expect(scale).toHaveText('100%');
  await page.setViewportSize({ width: 700, height: 390 });
  await expect.poll(async () => { const view = await viewport.boundingBox(); const img = await picture.boundingBox(); return !!view && !!img && img.width <= view.width + 1 && img.height <= view.height + 1; }).toBe(true);
  await page.getByRole('button', { name: '关闭大图', exact: true }).click();
  await expect(viewport).toHaveCount(0);
  expect(calls).toBe(0);
});
