import { test, expect } from '@playwright/test';
test.use({ launchOptions: { executablePath: process.env.SOLVEFLOW_TEST_CHROME ?? '/usr/bin/google-chrome', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });
test('RN camera captures actual virtual video pixels, releases tracks and crops without upload', async ({ page }) => {
  let uploads = 0; page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/uploads')) uploads++; });
  await page.goto('/'); await expect(page.getByRole('button', { name: '拍照', exact: true })).toBeVisible(); await page.getByRole('button', { name: '拍一张' }).click();
  await page.getByRole('button', { name: '允许使用相机' }).evaluateAll(nodes => { for (const node of nodes) if (node instanceof HTMLElement) node.click(); });
  const shutter = page.getByRole('button', { name: '拍摄', exact: true }); await expect(shutter).toBeEnabled();
  const stream = await page.locator('video').evaluateHandle(node => node instanceof HTMLVideoElement ? node.srcObject : null);
  expect(await stream.evaluate(value => value instanceof MediaStream && value.getVideoTracks()[0]?.readyState === 'live')).toBe(true);
  expect(await stream.evaluate(value => value instanceof MediaStream && value.getAudioTracks().length)).toBe(0);
  await page.setViewportSize({ width: 844, height: 390 }); await expect.poll(async () => { const box = await shutter.boundingBox(); return box ? box.y + box.height : 10000; }).toBeLessThanOrEqual(390);
  await shutter.click(); await expect(page.getByText('确认与裁切题图', { exact: true })).toBeVisible();
  expect(await stream.evaluate(value => value instanceof MediaStream && value.getTracks().every(track => track.readyState === 'ended'))).toBe(true);
  const pixels = await page.getByRole('img', { name: '裁切预览' }).evaluate(node => {
    if (!(node instanceof HTMLImageElement)) throw new Error('IMAGE_REQUIRED');
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32; const c = canvas.getContext('2d')!; c.drawImage(node, 0, 0, 32, 32); const data = c.getImageData(0, 0, 32, 32).data;
    return new Set(Array.from({ length: 1024 }, (_, i) => `${data[i * 4]},${data[i * 4 + 1]},${data[i * 4 + 2]}`)).size;
  }); expect(pixels).toBeGreaterThan(4);
  await page.getByRole('button', { name: '精细调整' }).click(); await page.getByRole('button', { name: '左边界增大' }).click(); await page.getByRole('button', { name: '使用这张题图' }).click();
  await expect(page.getByRole('img', { name: '待解答的题目' })).toBeVisible(); expect(uploads).toBe(0); await stream.dispose();
});
test('closing the camera releases its active stream and allows reopening', async ({ page }) => {
  await page.goto('/'); await expect(page.getByRole('button', { name: '拍照', exact: true })).toBeVisible(); await page.getByRole('button', { name: '拍一张' }).click();
  await page.getByRole('button', { name: '允许使用相机' }).evaluateAll(nodes => { for (const node of nodes) if (node instanceof HTMLElement) node.click(); });
  await expect(page.getByRole('button', { name: '拍摄', exact: true })).toBeEnabled(); const stream = await page.locator('video').evaluateHandle(node => node instanceof HTMLVideoElement ? node.srcObject : null);
  await page.getByRole('button', { name: '关闭相机' }).click(); expect(await stream.evaluate(value => value instanceof MediaStream && value.getTracks().every(track => track.readyState === 'ended'))).toBe(true);
  await page.getByRole('button', { name: '拍一张' }).click(); await expect(page.getByRole('button', { name: '拍摄', exact: true })).toBeEnabled(); await stream.dispose();
});
test('denied camera permission preserves the gallery fallback', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) }); });
  await page.goto('/'); await expect(page.getByRole('button', { name: '拍照', exact: true })).toBeVisible(); await page.getByRole('button', { name: '拍一张' }).click();
  await page.getByRole('button', { name: '允许使用相机' }).evaluateAll(nodes => { for (const node of nodes) if (node instanceof HTMLElement) node.click(); });
  await expect(page.getByRole('button', { name: '拍摄', exact: true })).toBeDisabled();
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('dialog').getByRole('button', { name: '从相册选择' }).click(); await (await chooser).setFiles([]);
  await expect(page.getByRole('button', { name: '拍一张' })).toBeVisible();
});
test('late camera permission after closing cannot retain active video tracks', async ({ page }) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: (constraints: MediaStreamConstraints) => original(constraints).then(stream => new Promise<MediaStream>(resolve => {
      const track = stream.getVideoTracks()[0]; if (track) track.addEventListener('ended', () => { document.documentElement.dataset.lateTrack = 'ended'; });
      document.documentElement.dataset.lateTrack = 'live';
      window.addEventListener('test:release-camera', () => { resolve(stream); const timer = setInterval(() => { if (stream.getTracks().every(item => item.readyState === 'ended')) { document.documentElement.dataset.lateTrack = 'ended'; clearInterval(timer); } }, 50); }, { once: true });
    })) });
  });
  await page.goto('/'); await expect(page.getByRole('button', { name: '拍照', exact: true })).toBeVisible(); await page.getByRole('button', { name: '拍一张' }).click();
  await page.getByRole('button', { name: '允许使用相机' }).evaluateAll(nodes => { for (const node of nodes) if (node instanceof HTMLElement) node.click(); });
  await expect(page.locator('html')).toHaveAttribute('data-late-track', 'live'); await page.getByRole('button', { name: '关闭相机' }).click();
  await page.evaluate(() => window.dispatchEvent(new Event('test:release-camera')));
  await expect(page.locator('html')).toHaveAttribute('data-late-track', 'ended');
  await expect(page.getByRole('button', { name: '拍一张' })).toBeVisible();
});
