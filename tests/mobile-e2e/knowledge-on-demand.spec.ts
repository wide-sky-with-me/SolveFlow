import { expect, test } from '@playwright/test';
import { chooseSyntheticPhoto, configureLocalModel, lastModelInput, modelSse, seedLocalSession } from './local-fixture.js';
import { SessionViewSchema } from '../../packages/contracts/src/http.js';

test('knowledge points load on demand after the brief answer and survive reload', async ({ page }) => {
  const calls: unknown[] = [];
  const answer = { schemaVersion: 1, kind: 'answer', problem: { text: '求 $x+1=3$ 的解。', subject: 'math', uncertainties: [] }, answer: '$x=2$。', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
  const withKnowledge = { ...answer, knowledgePoints: ['等式性质'], knowledgeDetails: [{ name: '等式性质', explanation: '两边同减一个数仍相等。', application: '本题两边减1。', pitfall: '不要漏掉符号。' }] };
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    const input = lastModelInput(route.request().postDataJSON()); calls.push(input);
    const focused = (input as { focus?: { kind?: string } } | null)?.focus?.kind === 'knowledge-list';
    await route.fulfill({ contentType: 'text/event-stream', body: modelSse(focused ? withKnowledge : answer, route.request().postDataJSON()) });
  });
  await page.goto('/'); await configureLocalModel(page); await chooseSyntheticPhoto(page);
  await page.getByRole('button', { name: '开始解题', exact: true }).click();
  await expect(page.locator('.final-answer')).toContainText('x=2');
  expect(calls).toHaveLength(1);
  // The brief answer carries no knowledge points; they are requested on demand.
  await expect(page.locator('.knowledge-panel')).toHaveCount(0);
  await page.locator('.knowledge-toggle>summary').click();
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[1]).toMatchObject({ answerMode: 'detailed', focus: { kind: 'knowledge-list' } });
  await expect(page.locator('.knowledge-panel')).toContainText('等式性质');
  await expect(page.locator('.knowledge-panel')).toContainText('两边同减一个数仍相等');
  await page.reload();
  await expect(page.locator('.knowledge-panel')).toContainText('等式性质');
  // A finished knowledge list must not keep the startup overlay waiting for a panel it never renders.
  await expect(page.getByTestId('launch-screen')).toHaveCount(0);
  expect(calls).toHaveLength(2);
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(page.locator('.katex-error')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('legacy knowledge names can generate real explanations without replacing the saved answer', async ({ page }) => {
  const id = '71000000-0000-4000-8000-000000000001'; const now = new Date().toISOString(); const image = await page.screenshot({ type: 'jpeg' });
  const candidate = { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: ['等式性质'], citationIds: [], clarificationQuestions: [] };
  const session = SessionViewSchema.parse({ schemaVersion: 1, id, subject: 'math', createdAt: now, upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: image.length, width: 390, height: 844, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` }, runs: [{ schemaVersion: 1, id, sessionId: id, createdAt: now, status: 'completed', message: '', seq: 1, outcome: { schemaVersion: 1, status: 'completed', verified: false, verificationStatus: 'not_requested', warning: null, verification: null, candidate } }] });
  let calls = 0;
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    calls++; expect(lastModelInput(route.request().postDataJSON())).toMatchObject({ focus: { kind: 'knowledge-list', sourceRunId: id } });
    await route.fulfill({ contentType: 'text/event-stream', body: modelSse({ ...candidate, knowledgeDetails: [{ name: '等式性质', explanation: '两边同减一个数仍相等。', application: '两边减1得到x=2。' }] }, route.request().postDataJSON()) });
  });
  await seedLocalSession(page, session, image); await configureLocalModel(page);
  await page.getByRole('button', { name: '生成知识点讲解', exact: true }).click();
  await page.locator('.knowledge-panel summary').click();
  await expect(page.locator('.knowledge-detail')).toContainText('两边同减一个数仍相等');
  await expect(page.locator('.final-answer')).toContainText('x=2'); expect(calls).toBe(1);
  await page.reload(); await expect(page.locator('.knowledge-panel')).toContainText('两边同减一个数仍相等'); expect(calls).toBe(1);
});
