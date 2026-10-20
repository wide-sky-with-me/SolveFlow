import { expect, test, type Locator, type Page } from '@playwright/test';
import { LocalRecordSchema } from '../../packages/contracts/src/local.js';

const batchId = '95000000-0000-4000-8000-000000000001';
const idFor = (position: number) => `95100000-0000-4000-8000-${String(position).padStart(12, '0')}`;
const sizes = [{ width: 1440, height: 900 }, { width: 1100, height: 600 }, { width: 390, height: 844 }, { width: 320, height: 568 }, { width: 568, height: 320 }, { width: 740, height: 390 }];

async function seed(page: Page, batch = true) {
  const requests: string[] = []; let origin: string | undefined;
  await page.route('**/*', route => {
    const request = route.request(); const url = new URL(request.url());
    if (!origin && request.isNavigationRequest()) origin = url.origin;
    if (url.origin === origin && url.pathname === '/__solveflow/web-env') return route.fulfill({ status: 404, json: {} });
    if (url.origin !== origin || !['GET', 'HEAD'].includes(request.method())) {
      requests.push(`${request.method()} ${url.origin}${url.pathname}`);
      return route.abort();
    }
    return route.continue();
  });
  await page.goto('/'); await expect(page.getByTestId('launch-screen')).toBeHidden();
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 240;
    const context = canvas.getContext('2d'); if (!context) throw new Error('CANVAS');
    context.fillStyle = '#fff'; context.fillRect(0, 0, 600, 240); context.fillStyle = '#172338'; context.font = '28px sans-serif'; context.fillText('Synthetic: x + 1 = 3', 20, 100);
    return canvas.toDataURL('image/jpeg');
  });
  const createdAt = '2026-10-13T10:00:00.000Z';
  const records = Array.from({ length: batch ? 11 : 1 }, (_, index) => {
    const id = idFor(index + 1);
    return LocalRecordSchema.parse({ schemaVersion: 1, image,
      ...(batch ? { batch: { id: batchId, title: '样式回归：合成代数题', createdAt, exam: 'general', position: index + 1 } } : {}),
      session: { schemaVersion: 1, id, subject: 'math', createdAt,
        upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: 2000, width: 600, height: 240, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` },
        runs: [{ schemaVersion: 1, id, sessionId: id, status: 'completed', message: '', seq: 1, createdAt,
          outcome: { schemaVersion: 1, status: 'completed', verified: false, verification: null, warning: null, verificationStatus: 'not_requested',
            candidate: { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [], ...(batch ? { options: [{ label: 'A', text: '1' }, { label: 'B', text: '2' }] } : {}) }, answer: '$x = 2$', ...(batch ? { selectedOptions: ['B'] } : {}), steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } } }] } });
  });
  await page.evaluate(records => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('solveflow-local', 1); request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result; const tx = db.transaction('documents', 'readwrite');
      for (const record of records) tx.objectStore('documents').put(JSON.stringify(record), `record.${record.session.id}`);
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }), records);
  await page.goto(`/?session=${idFor(1)}`);
  await expect(page.locator('.answer-document').first()).toBeVisible();
  return requests;
}

async function openPdf(page: Page) {
  await page.getByRole('button', { name: '批次操作', exact: true }).click();
  await page.getByRole('button', { name: '导出本批 PDF', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '导出 PDF', exact: true })).toBeVisible();
}

async function reachable(control: Locator) {
  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeInViewport({ ratio: 1 });
  await control.click({ trial: true });
}

async function stored(page: Page) {
  return page.evaluate(() => new Promise<unknown[]>((resolve, reject) => {
    const request = indexedDB.open('solveflow-local'); request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result; const tx = db.transaction('documents'); const read = tx.objectStore('documents').getAll();
      tx.oncomplete = () => { db.close(); resolve(read.result); }; tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }));
}

test('a reopened long PDF picker keeps the selected keyboard option fully visible', async ({ page }, info) => {
  const requests = await seed(page); const before = await stored(page); await openPdf(page);
  await page.getByText('图片整理', { exact: true }).click();
  const trigger = page.getByRole('button', { name: '当前题目', exact: true });
  for (const colorScheme of ['light', 'dark'] as const) for (const size of [sizes[0]!, sizes[3]!, sizes[4]!, sizes[5]!]) {
    await page.setViewportSize(size); await page.emulateMedia({ colorScheme });
    await trigger.focus(); await page.keyboard.press('ArrowDown');
    const menu = page.getByRole('listbox', { name: '当前题目', exact: true });
    await expect(menu).toBeVisible(); await expect(menu.locator('[aria-selected="true"]')).toBeFocused();
    await page.keyboard.press('End'); await expect(page.getByRole('option', { name: '第 11 题', exact: true })).toBeFocused();
    await page.keyboard.press('Enter'); await expect(menu).toHaveCount(0); await expect(trigger).toBeFocused();
    await expect(trigger).toHaveText('第 11 题');
    await page.keyboard.press('ArrowDown');
    const selected = page.getByRole('option', { name: '第 11 题', exact: true });
    await expect(selected).toBeFocused();
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await expect(selected).toBeFocused();
    await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => undefined))); });
    await page.screenshot({ path: info.outputPath(`selected-${size.width}x${size.height}-${colorScheme}.png`) });
    await expect(selected).toBeInViewport({ ratio: 1 });
    await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
    await expect(page.getByRole('dialog', { name: '导出 PDF', exact: true })).toBeVisible();
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: '图示归属', exact: true })).toBeFocused();
    await expect(page.getByRole('listbox')).toHaveCount(0);
  }
  await trigger.focus(); await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option', { name: '第 11 题', exact: true })).toBeFocused();
  await page.setViewportSize({ width: 720, height: 390 }); await expect(page.getByRole('listbox')).toHaveCount(0);
  expect(await stored(page)).toEqual(before); expect(requests).toEqual([]);
});

test('inline PDF copy settings keep footer actions reachable in both themes without a nested dialog', async ({ page }, info) => {
  const requests = await seed(page); const before = await stored(page);
  for (const colorScheme of ['light', 'dark'] as const) for (const size of sizes) {
    await page.setViewportSize(size); await page.emulateMedia({ colorScheme }); await openPdf(page);
    const dialog = page.getByRole('dialog', { name: '导出 PDF', exact: true });
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await dialog.getByLabel('导出份数', { exact: true }).fill('10');
    await dialog.getByText('逐题参照答案与错误作答', { exact: true }).click();
    await reachable(dialog.getByLabel('第11题参照答案', { exact: true }));
    await expect(dialog.getByRole('button', { name: '下载 PDF 压缩包', exact: true })).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole('button', { name: '关闭导出', exact: true })).toBeInViewport({ ratio: 1 });
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => undefined))); });
    await page.screenshot({ path: info.outputPath(`settings-bottom-${size.width}x${size.height}-${colorScheme}.png`) });
    await page.keyboard.press('Escape'); await expect(dialog).toBeHidden();
  }
  expect(await stored(page)).toEqual(before); expect(requests).toEqual([]);
});

test('answer controls stay compact and fully reachable after desktop to narrow resizing', async ({ page }, info) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const requests = await seed(page, false); const before = await stored(page);
  await page.getByLabel('继续问这道题', { exact: true }).fill('为什么两边要同时减去 1？');
  for (const colorScheme of ['light', 'dark'] as const) for (const size of [...sizes, { width: 390, height: 1000 }]) {
    await page.setViewportSize(size); await page.emulateMedia({ colorScheme });
    for (const name of ['重新解答', '校验']) {
      const control = page.getByRole('button', { name, exact: true });
      expect.soft(await control.evaluate(node => getComputedStyle(node).fontSize)).toBe('13px');
      expect.soft((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    const send = page.getByRole('button', { name: '发送同题追问', exact: true });
    await send.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`answer-bottom-${size.width}x${size.height}-${colorScheme}.png`) });
    await expect(send).toBeInViewport({ ratio: 1 });
    await expect(page.getByLabel('继续问这道题', { exact: true })).toHaveValue('为什么两边要同时减去 1？');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(await stored(page)).toEqual(before); expect(requests).toEqual([]);
});

test('Escape during export entrance closes the single dialog and reopening resets unsaved copy settings', async ({ page }, info) => {
  const requests = await seed(page); const before = await stored(page);
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    await page.emulateMedia({ reducedMotion }); await openPdf(page);
    const dialog = page.getByRole('dialog', { name: '导出 PDF', exact: true });
    await page.getByLabel('导出份数').fill('3'); await page.keyboard.press('Escape'); await expect(dialog).toBeHidden();
    await openPdf(page); await expect(page.getByRole('dialog')).toHaveCount(1); await expect(page.getByLabel('导出份数')).toHaveValue('1');
    await page.screenshot({ path: info.outputPath(`settings-early-escape-${reducedMotion}.png`) });
    await page.getByRole('button', { name: '关闭导出', exact: true }).click();
  }
  expect(await stored(page)).toEqual(before); expect(requests).toEqual([]);
});

test('invalid PDF quantities consume one Escape to restore the last valid value, then close without saving', async ({ page }) => {
  const requests = await seed(page); const before = await stored(page);
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    await page.emulateMedia({ reducedMotion });
    for (const field of ['导出份数', '第1份答错题数']) {
      await openPdf(page);
      const dialog = page.getByRole('dialog', { name: '导出 PDF', exact: true });
      const input = dialog.getByLabel(field, { exact: true });
      await input.fill('3');
      await input.fill(field === '导出份数' ? '21' : '12');
      await expect(input).toHaveAttribute('aria-invalid', 'true');
      await input.press('Escape');
      await expect(input).toHaveValue('3');
      await expect(input).toHaveAttribute('aria-invalid', 'false');
      await expect(input).toBeFocused();
      await expect(dialog).toBeVisible();
      await input.press('Escape');
      await expect(dialog).toBeHidden();
      await openPdf(page);
      await expect(page.getByRole('dialog')).toHaveCount(1);
      await expect(dialog.getByLabel('导出份数', { exact: true })).toHaveValue('1');
      await expect(dialog.getByLabel('第1份答错题数', { exact: true })).toHaveValue('0');
      await dialog.getByRole('button', { name: '关闭导出', exact: true }).click();
    }
  }
  expect(await stored(page)).toEqual(before); expect(requests).toEqual([]);
});

test('copy count and per-copy errors share aligned compact columns across themes and viewport sizes', async ({ page }, info) => {
  const requests = await seed(page); const before = await stored(page); await openPdf(page);
  const dialog = page.getByRole('dialog', { name: '导出 PDF', exact: true });
  const count = dialog.getByLabel('导出份数', { exact: true });
  await count.fill('3');
  await dialog.getByLabel('第1份答错题数', { exact: true }).fill('3');
  await expect(dialog.getByLabel('第1份答对题数', { exact: true })).toHaveText('对 8 题');
  await expect(dialog.getByLabel('第2份答错题数', { exact: true })).toHaveValue('0');
  for (const colorScheme of ['light', 'dark'] as const) for (const size of sizes) {
    await page.setViewportSize(size); await page.emulateMedia({ colorScheme }); await count.scrollIntoViewIfNeeded();
    const wrong = dialog.getByLabel('第1份答错题数', { exact: true });
    const correct = dialog.getByLabel('第1份答对题数', { exact: true });
    const first = (await count.boundingBox())!; const second = (await wrong.boundingBox())!; const third = (await correct.boundingBox())!;
    expect(Math.abs(first.x - second.x)).toBeLessThan(1);
    expect(Math.abs(first.width - second.width)).toBeLessThan(1);
    expect(Math.abs(first.height - second.height)).toBeLessThan(1);
    expect(second.height).toBeGreaterThanOrEqual(44);
    expect(Math.abs(second.y + second.height / 2 - third.y - third.height / 2)).toBeLessThan(1);
    expect(third.x - second.x - second.width).toBeGreaterThanOrEqual(8);
    expect(third.x - second.x - second.width).toBeLessThanOrEqual(16);
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await dialog.locator('.pdf-copy-list').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await wrong.focus(); await expect(wrong).toBeFocused(); await page.keyboard.press('Tab');
    await expect(dialog.getByLabel('第2份答错题数', { exact: true })).toBeFocused();
    await count.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`copy-alignment-${size.width}x${size.height}-${colorScheme}.png`) });
  }
  await count.fill('20'); await expect(dialog.locator('.pdf-copy-row')).toHaveCount(20);
  await reachable(dialog.getByLabel('第20份答错题数', { exact: true }));
  await expect(dialog.getByRole('button', { name: '下载 PDF 压缩包', exact: true })).toBeInViewport({ ratio: 1 });
  expect(await stored(page)).toEqual(before); expect(requests).toEqual([]);
});
