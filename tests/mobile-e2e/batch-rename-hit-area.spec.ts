import { expect, test } from '@playwright/test';

test.use({ reducedMotion: 'reduce' });

test('batch rename only responds to its title and edit icon, preserving keyboard access and long names', async ({ page }, info) => {
  let modelRequests = 0;
  page.on('request', request => { if (request.method() === 'POST') modelRequests++; });
  await page.goto('/');
  await page.getByRole('button', { name: '拍照', exact: true }).waitFor();
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('solveflow-local', 1); request.onsuccess = () => resolve(request.result); request.onerror = reject; });
    const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 300;
    const id = '86100000-0000-4000-8000-000000000001'; const createdAt = '2026-10-10T08:00:00.000Z';
    const batch = { id: '86100000-0000-4000-8000-000000000002', title: '周末练习', createdAt, exam: 'general', position: 1 };
    const session = { schemaVersion: 1, id, subject: 'math', createdAt, upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: 1000, width: 600, height: 300, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` }, runs: [] };
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('documents', 'readwrite'); tx.objectStore('documents').put(JSON.stringify({ schemaVersion: 1, session, image: canvas.toDataURL('image/jpeg'), batch }), `record.${id}`); tx.oncomplete = () => resolve(); tx.onerror = reject; });
    db.close();
  });
  await page.goto('/?session=86100000-0000-4000-8000-000000000001');
  await page.getByTestId('batch-header').waitFor();
  await page.getByTestId('launch-screen').waitFor({ state: 'hidden' });
  const rename = page.getByRole('button', { name: '重命名批次', exact: true });
  const dialog = page.getByRole('dialog');
  for (const width of [1920, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByTestId('batch-photo-count').click();
    await expect(dialog).toHaveCount(0);
    const button = await rename.boundingBox(); const icon = await page.getByTestId('batch-edit-icon').boundingBox(); const more = await page.getByTestId('batch-more').boundingBox();
    if (!button || !icon || !more) throw new Error('HEADER_NOT_VISIBLE');
    expect(button.height).toBeGreaterThanOrEqual(44);
    expect(button.x + button.width).toBeCloseTo(icon.x + icon.width, 0);
    await page.mouse.click(more.x - 12, button.y + button.height / 2);
    await expect(dialog).toHaveCount(0);
    for (const target of [page.getByTestId('batch-title'), page.getByTestId('batch-edit-icon')]) {
      await target.click(); await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      await expect(dialog).toHaveCount(0);
    }
    await page.getByTestId('batch-header').screenshot({ path: info.outputPath(`rename-${width}.png`) });
  }
  await rename.focus(); await page.keyboard.press('Enter'); await expect(dialog).toBeVisible();
  const name = '长批次名称'.repeat(20);
  await page.getByRole('textbox', { name: '批次名称', exact: true }).fill(name);
  await dialog.getByRole('button', { name: '保存名称', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('batch-title')).toHaveText(name);
  await page.reload(); await expect(page.getByTestId('batch-title')).toHaveText(name);
  for (const width of [1920, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByTestId('batch-more')).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('batch-edit-icon')).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('batch-photo-count')).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(modelRequests).toBe(0);
});
