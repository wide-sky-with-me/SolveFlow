import { expect, test } from '@playwright/test';
import { SessionViewSchema } from '../../packages/contracts/src/http.js';
import { seedLocalSession } from './local-fixture.js';
test('clarification and follow-up messages render TeX safely after reload', async ({ page }) => {
  const id = '20000000-0000-4000-8000-000000000001'; const now = new Date().toISOString();
  const image = await page.screenshot({ type: 'jpeg' });
  const session = SessionViewSchema.parse({ schemaVersion: 1, id, subject: 'math', createdAt: now,
    upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: image.length, width: 320, height: 500, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` },
    runs: [{ schemaVersion: 1, id, sessionId: id, createdAt: now, status: 'needs_clarification', seq: 1, message: '为什么 $x^2=4$？', outcome: { schemaVersion: 1, status: 'needs_clarification', verified: false,
      candidate: { schemaVersion: 1, kind: 'clarification', problem: { text: '已知 $x^2=4$', subject: 'math', uncertainties: [] }, answer: null, steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: ['是求 $x^2=4$ 的全部解吗？<img src=x onerror=alert(1)>'] } } }] });
  await seedLocalSession(page, session, image);
  for (let i = 0; i < 2; i++) {
    await expect(page.locator('.clarification .katex')).toHaveCount(1);
    await expect(page.getByRole('region', { name: '对话内容' }).locator('.katex')).toHaveCount(1);
    await expect(page.locator('.clarification img')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (i === 0) await page.reload();
  }
});
