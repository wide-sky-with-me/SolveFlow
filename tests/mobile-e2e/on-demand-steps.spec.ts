import { expect, test } from '@playwright/test';
import { chooseSyntheticPhoto, configureLocalModel, lastModelInput, modelPass, modelSse } from './local-fixture.js';

test('brief answer stays visible while steps load once and survive reload', async ({ page }) => {
  const calls: unknown[] = []; let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const candidate = { schemaVersion: 1, kind: 'answer', problem: { text: '求 $x+1=3$ 的解。', subject: 'math', uncertainties: [] }, answer: '$x=2$。', steps: [{ id: 'subtract', title: '等式两边减1', explanation: '$x=3-1=2$，代回 $2+1=3$ 成立。\n\n![原题对照](attachment:original)' }], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    const input = lastModelInput(route.request().postDataJSON()); calls.push(input);
    if (calls.length === 2) await gate;
    await route.fulfill({ contentType: 'text/event-stream', body: modelSse(candidate, route.request().postDataJSON()) });
  });
  try {
    await page.goto('/'); await configureLocalModel(page); await chooseSyntheticPhoto(page);
    await page.getByRole('button', { name: '开始解题', exact: true }).click();
    await expect(page.locator('.final-answer')).toContainText('x=2');
    await expect(page.getByText('未校验', { exact: true })).toBeVisible();
    expect(calls).toHaveLength(1); expect(calls[0]).toMatchObject({ answerMode: 'brief' });
    await expect(page.locator('.teaching-steps')).toHaveCount(0);
    await page.locator('.step-details>summary').click();
    await expect.poll(() => calls.length).toBe(2);
    await expect(page.locator('.steps-wait')).toContainText('正在整理步骤');
    await expect(page.locator('.final-answer')).toBeVisible();
    await expect(page.getByTestId('solve-progress')).toHaveCount(0);
    await page.locator('.step-details>summary').click(); await page.locator('.step-details>summary').click();
    expect(calls).toHaveLength(2);
    release(); await expect(page.locator('.teaching-steps')).toContainText('等式两边减1');
    await expect(page.locator('.teaching-steps').getByAltText('原题对照')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
    expect(calls).toHaveLength(2); expect(calls[1]).toMatchObject({ answerMode: 'detailed', focus: { kind: 'explanation', content: expect.stringContaining('x+1=3') } });
    await expect(page.locator('.final-answer')).toHaveCount(1);
    await page.reload(); await page.locator('.step-details>summary').click();
    await expect(page.locator('.teaching-steps')).toContainText('等式两边减1'); expect(calls).toHaveLength(2);
    await page.setViewportSize({ width: 320, height: 844 });
    await expect(page.locator('.katex-error')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { release(); }
});

test('failed explanation keeps the source answer and retries without regenerating it', async ({ page }) => {
  let calls = 0;
  const candidate = { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [{ id: 's1', title: '两边减1', explanation: 'x=3-1=2' }], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    const call = ++calls;
    if (call === 2 || call === 3) return route.fulfill({ status: 503, body: 'fixture failure' });
    await route.fulfill({ contentType: 'text/event-stream', body: modelSse(candidate, route.request().postDataJSON()) });
  });
  await page.goto('/'); await configureLocalModel(page); await chooseSyntheticPhoto(page);
  await page.getByRole('button', { name: '开始解题', exact: true }).click(); await expect(page.locator('.final-answer')).toContainText('x=2');
  await page.locator('.step-details>summary').click(); await expect(page.getByRole('button', { name: '重新生成步骤' })).toBeEnabled();
  await expect(page.locator('.final-answer')).toContainText('x=2'); expect(calls).toBe(3);
  await page.getByRole('button', { name: '重新生成步骤' }).click(); await expect(page.locator('.teaching-steps')).toContainText('两边减1'); expect(calls).toBe(4);
  await page.locator('.step-details>summary').click(); await page.locator('.step-details>summary').click(); expect(calls).toBe(4);
});
