import { expect, test } from '@playwright/test';
import { chooseSyntheticPhoto, configureLocalModel, lastModelInput, modelSse } from './local-fixture.js';

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
