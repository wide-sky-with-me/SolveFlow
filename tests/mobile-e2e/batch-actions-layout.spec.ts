import { expect, test, type Locator } from '@playwright/test';
import { configureLocalModel } from './local-fixture.js';

test.use({ reducedMotion: 'reduce' });

async function reachable(control: Locator) {
  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeInViewport({ ratio: 1 });
  await expect.poll(() => control.evaluate(node => {
    const box = node.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return hit !== null && node.contains(hit);
  })).toBe(true);
}

test('a long batch name keeps the close bar and running batch actions reachable in short landscape', async ({ page }, info) => {
  let release: (() => void) | undefined; let calls = 0;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    calls++; await held; await route.abort();
  });
  try {
    await page.goto('/'); await configureLocalModel(page);
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('solveflow-local', 1); request.onsuccess = () => resolve(request.result); request.onerror = reject; });
      const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 300;
      const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('CANVAS');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 600, 300); ctx.fillStyle = '#111'; ctx.fillText('x + 1 = 3', 50, 150);
      const id = '87000000-0000-4000-8000-000000000001'; const createdAt = '2026-10-07T08:00:00.000Z';
      const batch = { id: '87000000-0000-4000-8000-000000000002', title: '短横屏长批次名称'.repeat(12) + '回归检查', createdAt, exam: 'general', position: 1 };
      const session = { schemaVersion: 1, id, subject: 'math', createdAt, upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: 1000, width: 600, height: 300, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` }, runs: [] };
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('documents', 'readwrite'); const store = tx.objectStore('documents');
        store.put(JSON.stringify({ schemaVersion: 1, session, image: canvas.toDataURL('image/jpeg'), batch }), `record.${id}`);
        store.put(JSON.stringify({ schemaVersion: 1, id, subject: 'math', createdAt, text: '', pending: false, batch }), `summary.${id}`);
        tx.oncomplete = () => resolve(); tx.onerror = reject;
      }); db.close();
    });
    await page.getByRole('tab', { name: '历史题目', exact: true }).click();
    await page.getByRole('tab', { name: '批量记录', exact: true }).click();
    await page.getByRole('button', { name: '打开批量', exact: true }).click();
    await page.getByRole('button', { name: '批次操作', exact: true }).click();
    await page.getByRole('button', { name: '继续待解题', exact: true }).click();
    await expect.poll(() => calls).toBe(1);
    await page.getByRole('button', { name: '批次操作', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: '停止批量解题', exact: true })).toHaveCount(1);
    for (const viewport of [{ width: 568, height: 320 }, { width: 320, height: 568 }]) {
      await page.setViewportSize(viewport);
      const close = dialog.getByRole('button', { name: '关闭', exact: true });
      await expect(close).toBeInViewport({ ratio: 1 });
      for (const name of ['继续拍摄', '添加相册题图', '继续待解题', '重试未完成', '停止批量解题']) {
        await reachable(dialog.getByRole('button', { name, exact: true }));
        await expect(close).toBeInViewport({ ratio: 1 });
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`batch-actions-${viewport.width}.png`) });
    }
    await dialog.getByRole('button', { name: '停止批量解题', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button', { name: '批次操作', exact: true }).click();
    await expect(dialog.getByRole('button', { name: '停止批量解题', exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  } finally {
    release?.(); await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
});
