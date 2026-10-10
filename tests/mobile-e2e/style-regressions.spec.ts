import { expect, test, type Locator } from '@playwright/test';
import { SessionViewSchema } from '../../packages/contracts/src/http.js';
import { chooseSyntheticPhoto, configureLocalModel, seedLocalSession } from './local-fixture.js';

async function reachable(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect.poll(() => locator.evaluate(node => {
    const box = node.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return hit !== null && node.contains(hit);
  })).toBe(true);
}

test('denied camera permission stays separate from modes and keeps recovery actions reachable on short screens', async ({ page }, testInfo) => {
  await page.addInitScript(() => Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) }));
  await page.setViewportSize({ width: 568, height: 320 }); await page.goto('/');
  await page.getByRole('button', { name: '拍一张', exact: true }).click();
  await page.getByRole('button', { name: '允许使用相机', exact: true }).evaluateAll(nodes => nodes.forEach(node => { if (node instanceof HTMLElement) node.click(); }));
  await expect(page.getByRole('button', { name: '重试相机', exact: true })).toBeVisible();
  const dialog = page.getByRole('dialog');
  for (const viewport of [{ width: 568, height: 320 }, { width: 844, height: 390 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    const note = page.getByText('浏览器相机需要 HTTPS 或 localhost 安全地址', { exact: true });
    await note.scrollIntoViewIfNeeded();
    await expect.poll(async () => {
      const text = (await note.boundingBox())!; const mode = (await page.getByRole('button', { name: '单题拍照', exact: true }).boundingBox())!;
      return text.y + text.height <= mode.y + 1;
    }).toBe(true);
    await reachable(page.getByRole('button', { name: '允许使用相机', exact: true }));
    await reachable(dialog.getByRole('button', { name: '从相册选择', exact: true }));
    await reachable(page.getByRole('button', { name: '关闭相机', exact: true }));
    await page.screenshot({ path: testInfo.outputPath(`camera-${viewport.width}.png`) });
  }
  await page.getByRole('button', { name: '关闭相机', exact: true }).click();
});

test('crop fine adjustment keeps readable labels and a usable preview after rotation', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 }); await page.goto('/');
  await chooseSyntheticPhoto(page); await page.getByRole('button', { name: '裁切题图', exact: true }).click();
  await page.getByRole('button', { name: '精细调整', exact: true }).click();
  const label = page.getByText('左边界 0%', { exact: true });
  expect((await label.boundingBox())!.height).toBeLessThanOrEqual(32);
  for (const viewport of [{ width: 320, height: 568 }, { width: 568, height: 320 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(async () => (await page.getByRole('img', { name: '裁切预览', exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(96);
    for (const edge of ['左边界', '上边界', '右边界', '下边界']) {
      const button = page.getByRole('button', { name: `${edge}增大`, exact: true }); await reachable(button);
    }
    await reachable(page.getByRole('button', { name: '使用这张题图', exact: true }));
    await page.screenshot({ path: testInfo.outputPath(`crop-${viewport.width}.png`) });
  }
  await page.getByRole('button', { name: '左边界增大', exact: true }).click();
  await expect(page.getByText('左边界 2%', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '使用这张题图', exact: true }).click();
  await expect(page.getByRole('img', { name: '待解答的题目', exact: true })).toBeVisible();
});

test('enabled quick questions remain legible in both themes and have a full touch target', async ({ page }, testInfo) => {
  let posts = 0; await page.route('**/*', route => { if (route.request().method() === 'POST') { posts++; return route.abort(); } return route.continue(); });
  const id = '84000000-0000-4000-8000-000000000001'; const now = new Date().toISOString();
  const session = SessionViewSchema.parse({ schemaVersion: 1, id, subject: 'math', createdAt: now,
    upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: 100, width: 390, height: 844, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` },
    runs: [{ schemaVersion: 1, id, sessionId: id, status: 'completed', message: '', seq: 1, createdAt: now, outcome: { schemaVersion: 1, status: 'completed', verified: false, verification: null, warning: null, verificationStatus: 'not_requested', candidate: { schemaVersion: 1, kind: 'answer', problem: { text: '求解 x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } } }] });
  await page.setViewportSize({ width: 390, height: 844 }); await seedLocalSession(page, session, await page.screenshot({ type: 'jpeg' }));
  await configureLocalModel(page);
  const chip = page.getByRole('button', { name: '快捷追问：换一种更简便的解法', exact: true });
  for (const colorScheme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme }); await reachable(chip); await expect(chip).toBeEnabled();
    await expect.poll(() => chip.evaluate(node => {
      const text = node.firstElementChild!;
      const luminance = (color: string) => {
        const values = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => { const c = value / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
        return .2126 * values[0]! + .7152 * values[1]! + .0722 * values[2]!;
      };
      const a = luminance(getComputedStyle(text).color); const b = luminance(getComputedStyle(node).backgroundColor);
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    })).toBeGreaterThanOrEqual(4.5);
    expect((await chip.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: testInfo.outputPath(`quick-question-${colorScheme}.png`) });
  }
  await chip.click(); await expect(page.getByRole('textbox', { name: '继续问这道题', exact: true })).toHaveValue('换一种更简便的解法');
  expect(posts).toBe(0);
});
