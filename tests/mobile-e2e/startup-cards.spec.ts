import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { SessionViewSchema } from '../../packages/contracts/src/http.js';
import { seedLocalSession } from './local-fixture.js';

for (const fontMode of ['delayed', 'stalled'] as const) test(`startup handles ${fontMode} restored answer layout with readable cards`, async ({ page }, info) => {
  const id = '20000000-0000-4000-8000-000000000001'; const now = new Date().toISOString();
  const image = await page.screenshot({ type: 'jpeg' });
  const session = SessionViewSchema.parse({ schemaVersion: 1, id, subject: 'math', createdAt: now, upload: { schemaVersion: 1, id: '20000000-0000-4000-8000-000000000002', mimeType: 'image/jpeg', bytes: image.length, width: 320, height: 700, expiresAt: new Date(Date.now() + 3600000).toISOString(), previewUrl: '/api/v1/uploads/20000000-0000-4000-8000-000000000002/image' }, runs: [{ schemaVersion: 1, id: '20000000-0000-4000-8000-000000000003', sessionId: id, status: 'completed', message: '', seq: 5, createdAt: now, outcome: { schemaVersion: 1, status: 'completed', verified: true, warning: null, verification: { schemaVersion: 1, verdict: 'pass', checked: ['transcription'], issues: [] }, candidate: { schemaVersion: 1, kind: 'answer', problem: { text: '求解 $x+1=3$', subject: 'math', uncertainties: [] }, answer: '$x=2$', steps: [{ id: 's1', title: '移项', explanation: '等式两边同时减一。' }], knowledgePoints: ['等式性质'], citationIds: [], clarificationQuestions: [] } } }] });
  await seedLocalSession(page, session, image);
  let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; });
  const font = await readFile('apps/mobile/node_modules/katex/dist/fonts/KaTeX_Main-Regular.woff2');
  let requested = false;
  await page.route('**/startup-fixture.woff2', async route => { requested = true; await gate; await route.fulfill({ contentType: 'font/woff2', body: font }); });
  await page.addInitScript(() => {
    const font = new FontFace('StartupFixture', 'url(/startup-fixture.woff2)'); document.fonts.add(font); void font.load();
  });
  let calls = 0; page.on('request', request => { if (request.method() === 'POST') calls++; });
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect.poll(() => requested).toBe(true);
    await expect(page.locator('article.answer-document')).toBeAttached();
    // Committed answers are readable even when a font request has not finished.
    await expect(page.getByTestId('launch-screen')).toBeHidden();
    if (fontMode === 'stalled') await page.waitForTimeout(11000);
    await expect(page.getByText('图文解答加载失败', { exact: false })).toHaveCount(0);
    await expect(page.getByText('正在显示解答…')).toHaveCount(0);
    await expect(page.locator('.final-answer .katex')).toHaveCount(1);
    expect(calls).toBe(0);
    release();
    const cards = page.locator('.answer-document > .reading-card');
    await expect(cards).toHaveCount(4);
    await expect(cards.nth(0)).toContainText('题目'); await expect(cards.nth(1)).toContainText('答案');
    await expect(cards.nth(2)).toContainText('详细步骤'); await expect(cards.nth(3)).toContainText('知识点');
    for (let index = 0; index < 4; index++) {
      await expect(cards.nth(index)).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await expect(cards.nth(index)).toHaveCSS('border-radius', '16px');
      if (index) { const previous = await cards.nth(index - 1).boundingBox(); const next = await cards.nth(index).boundingBox(); expect(next!.y - previous!.y - previous!.height).toBeGreaterThanOrEqual(11); }
    }
    await expect(cards.nth(0).getByRole('button', { name: '识别有误？更正题干' })).toBeVisible();
    await expect(page.locator('.teaching-steps')).toBeHidden();
    await page.locator('.step-details>summary').click(); await expect(page.locator('.teaching-steps')).toBeVisible();
    await page.setViewportSize({ width: 320, height: 700 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('.step-details>summary').click();
    await page.screenshot({ path: `.runtime/screenshots/${info.project.name}-reading-cards.png`, fullPage: true });
    expect(calls).toBe(0);
  } finally { release(); }
});
