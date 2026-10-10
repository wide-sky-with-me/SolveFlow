import { expect, test, type Locator } from '@playwright/test';
import { SessionViewSchema } from '../../packages/contracts/src/http.js';
import { seedLocalSession } from './local-fixture.js';

async function reachable(control: Locator) {
  await control.scrollIntoViewIfNeeded();
  await expect.poll(() => control.evaluate(node => {
    const box = node.getBoundingClientRect(); const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return hit !== null && node.contains(hit);
  })).toBe(true);
}

test('answer actions use compact control sizing and the same theme roles as the app', async ({ page }) => {
  const id = '86000000-0000-4000-8000-000000000001'; const now = new Date().toISOString();
  const session = SessionViewSchema.parse({ schemaVersion: 1, id, subject: 'math', createdAt: now,
    upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: 100, width: 390, height: 844, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` },
    runs: [{ schemaVersion: 1, id, sessionId: id, status: 'completed', message: '', seq: 1, createdAt: now, outcome: { schemaVersion: 1, status: 'completed', verified: false, verification: null, warning: null, verificationStatus: 'not_requested', candidate: { schemaVersion: 1, kind: 'answer', problem: { text: '求解 x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } } }] });
  await seedLocalSession(page, session, await page.screenshot({ type: 'jpeg' }));
  await page.setViewportSize({ width: 320, height: 700 });
  for (const name of ['重新解答', '校验']) {
    const button = page.getByRole('button', { name, exact: true });
    expect.soft((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect.soft(button).toHaveCSS('font-size', '13px');
    await expect.soft(button).toHaveCSS('border-radius', '12px');
  }
  for (const scheme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect.poll(() => page.locator('.answer-document').first().evaluate(node => {
      const style = getComputedStyle(node);
      return ['ink', 'muted', 'line', 'accent'].map(role => style.getPropertyValue(`--sf-${role}`).trim());
    })).toEqual(scheme === 'dark'
      ? ['#e6edf7', '#a6b5ca', '#334156', '#8bb5ff']
      : ['#172338', '#607087', '#e3eaf3', '#2867dd']);
  }
  const contrast = await page.locator('.answer-document').first().evaluate(node => {
    const s = getComputedStyle(node);
    const l = (h: string) => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return c[0]! * .2126 + c[1]! * .7152 + c[2]! * .0722; };
    return (l(s.getPropertyValue('--sf-bg').trim()) + .05) / (l(s.getPropertyValue('--sf-muted').trim()) + .05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
});

test('export and restore pages share a readable width and remain scrollable on short screens', async ({ page }, testInfo) => {
  await page.goto('/'); await page.getByRole('tab', { name: '我的', exact: true }).click();
  for (const name of ['导出本地记录', '恢复本地记录']) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name, exact: true }).click();
    const title = page.getByText(name, { exact: true }).last();
    expect.soft((await title.boundingBox())!.width).toBeLessThanOrEqual(680);
    await page.setViewportSize({ width: 568, height: 320 });
    const back = page.getByRole('button', { name: '返回', exact: true });
    await reachable(back);
    await page.screenshot({ path: testInfo.outputPath(`${name}-short.png`) });
    await back.click();
  }
});

test('appearance dialog is bounded, centered and usable in short landscape', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/'); await page.getByRole('tab', { name: '我的', exact: true }).click();
  await page.getByRole('button', { name: '外观', exact: true }).click();
  const title = page.getByRole('heading', { name: '外观', exact: true });
  const bounds = await title.evaluate(node => {
    const box = node.parentElement!.getBoundingClientRect();
    return { width: box.width, centerX: box.x + box.width / 2, centerY: box.y + box.height / 2 };
  });
  expect.soft(bounds.width).toBeLessThanOrEqual(420);
  expect(bounds.centerX).toBeCloseTo(720, 0);
  expect(bounds.centerY).toBeCloseTo(450, 0);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme }); await page.setViewportSize({ width: 568, height: 320 });
    await reachable(page.getByRole('radio', { name: '跟随系统', exact: true }));
    await reachable(page.getByRole('button', { name: '完成', exact: true }));
    await page.screenshot({ path: testInfo.outputPath(`appearance-${scheme}.png`) });
  }
  await page.getByRole('button', { name: '完成', exact: true }).click();
});
