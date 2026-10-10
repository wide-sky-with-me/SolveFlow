import { expect, test } from '@playwright/test';
import { SessionViewSchema } from '../../packages/contracts/src/http.js';
import { modelPass, seedLocalSession } from './local-fixture.js';

test('diagnostic touch area, navigation strokes and history action text stay clear in both themes', async ({ page }, testInfo) => {
  const id = '85000000-0000-4000-8000-000000000001'; const now = new Date().toISOString();
  const session = SessionViewSchema.parse({ schemaVersion: 1, id, subject: 'math', createdAt: now,
    upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: 100, width: 390, height: 844, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` },
    runs: [{ schemaVersion: 1, id, sessionId: id, status: 'completed', message: '', seq: 1, createdAt: now, outcome: { schemaVersion: 1, status: 'completed', verified: false, verification: null, warning: null, verificationStatus: 'not_requested', candidate: { schemaVersion: 1, kind: 'answer', problem: { text: '求解 x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } } }] });
  await page.setViewportSize({ width: 390, height: 844 }); await seedLocalSession(page, session, await page.screenshot({ type: 'jpeg' }));
  const diagnostic = page.getByRole('button', { name: '查看解题诊断', exact: true });
  expect.soft((await diagnostic.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  for (const scheme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect(page.locator('.final-answer')).toHaveCSS('background-color', scheme === 'dark' ? 'rgb(24, 34, 50)' : 'rgb(255, 255, 255)');
    await expect.soft(page.getByTestId('nav-camera-shutter')).toHaveCSS('border-top-color', 'rgb(255, 255, 255)');
  }
  await page.getByRole('tab', { name: '历史题目', exact: true }).click();
  await page.getByRole('button', { name: '题目操作', exact: true }).click();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect(page.locator('.history-document')).toHaveCSS('color', scheme === 'dark' ? 'rgb(230, 237, 247)' : 'rgb(23, 35, 56)');
    for (const name of ['收藏', '移除']) {
      const button = page.getByRole('button', { name, exact: true }); await expect(button).toBeEnabled();
      const contrast = await button.evaluate(node => {
        const luminance = (color: string) => {
          const c = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(n => { const s = n / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; });
          return c[0]! * .2126 + c[1]! * .7152 + c[2]! * .0722;
        };
        const style = getComputedStyle(node); const a = luminance(style.color); const b = luminance(style.backgroundColor);
        return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      });
      expect.soft(contrast).toBeGreaterThanOrEqual(4.5);
    }
    await page.screenshot({ path: testInfo.outputPath(`history-${scheme}.png`) });
  }
});

test('verified and unverified status text remains readable in both themes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const image = await page.screenshot({ type: 'jpeg' });
  for (const verified of [false, true]) {
    const id = `85100000-0000-4000-8000-00000000000${verified ? 2 : 1}`;
    const now = new Date().toISOString();
    const session = SessionViewSchema.parse({ schemaVersion: 1, id, subject: 'math', createdAt: now,
      upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: image.length, width: 390, height: 844, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` },
      runs: [{ schemaVersion: 1, id, sessionId: id, status: 'completed', message: '', seq: 1, createdAt: now,
        outcome: { schemaVersion: 1, status: 'completed', verified, warning: null, verification: verified ? modelPass : null,
          ...(verified ? {} : { verificationStatus: 'not_requested' }),
          candidate: { schemaVersion: 1, kind: 'answer', problem: { text: '求解 x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } } }] });
    await seedLocalSession(page, session, image);
    const status = page.getByRole('button', { name: '查看解题诊断', exact: true }).getByText(verified ? '模型独立校验通过' : '未校验', { exact: true });
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(page.locator('.answer-document')).toHaveCSS('color', colorScheme === 'light' ? 'rgb(23, 35, 56)' : 'rgb(230, 237, 247)');
      expect(await status.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(13);
      expect(await status.evaluate(node => {
        const luminance = (color: string) => {
          const values = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
          if (!values || values.length !== 3) throw new Error('MISSING_STATUS_COLOR');
          const c = values.map(value => { const v = value / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
          return .2126 * c[0]! + .7152 * c[1]! + .0722 * c[2]!;
        };
        let background = '';
        for (let parent: Element | null = node; parent; parent = parent.parentElement) {
          const color = getComputedStyle(parent).backgroundColor;
          if (color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') { background = color; break; }
        }
        const a = luminance(getComputedStyle(node).color); const b = luminance(background);
        return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      })).toBeGreaterThanOrEqual(4.5);
    }
  }
});
