import { expect, test } from '@playwright/test';
import { chooseSyntheticPhoto, configureLocalModel, lastModelInput, modelPass, modelSse } from './local-fixture.js';

for (const verdict of ['pass', 'fail'] as const) test(`verification is opt-in, preserves the answer while checking and saves ${verdict}`, async ({ page }) => {
  const inputs: unknown[] = []; let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const candidate = { schemaVersion: 1, kind: 'answer', problem: { text: '求解 $x+1=3$。', subject: 'math', uncertainties: [] }, answer: '两边减1，**$x=2$**。', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    const body: unknown = route.request().postDataJSON(); const input = lastModelInput(body); inputs.push(input);
    if (inputs.length === 1) return route.fulfill({ contentType: 'text/event-stream', body: modelSse(candidate) });
    expect(input).toMatchObject({ role: 'verifier', candidate }); expect(body).not.toHaveProperty('tools');
    await gate;
    await route.fulfill({ contentType: 'text/event-stream', body: modelSse(verdict === 'pass' ? modelPass : { schemaVersion: 1, verdict: 'fail', checked: ['transcription', 'arithmetic'], issues: [{ code: 'ARITHMETIC', message: '测试校验问题：请核对计算。' }] }) });
  });
  try {
    await page.goto('/'); await configureLocalModel(page); await chooseSyntheticPhoto(page);
    await page.getByRole('button', { name: '开始解题', exact: true }).click();
    await expect(page.locator('.final-answer strong')).toContainText('x=2');
    await expect(page.locator('.final-answer strong .katex')).toHaveCSS('font-weight', '700');
    await expect(page.getByRole('button', { name: '校验', exact: true })).toBeEnabled();
    expect(inputs).toHaveLength(1); expect(inputs[0]).toMatchObject({ verificationMode: 'manual' });
    await page.getByRole('button', { name: '校验', exact: true }).click();
    await expect(page.getByRole('button', { name: '校验中', exact: true })).toBeDisabled();
    await expect(page.locator('.final-answer')).toBeVisible(); await expect(page.getByTestId('solve-progress')).toHaveCount(0);
    expect(inputs).toHaveLength(2);
    release();
    await expect(page.getByRole('button', { name: verdict === 'pass' ? '校验通过' : '发现问题', exact: true })).toBeDisabled();
    if (verdict === 'fail') await expect(page.getByText('测试校验问题：请核对计算。', { exact: true })).toBeVisible();
    await page.reload(); await expect(page.getByTestId('launch-screen')).toHaveCount(0);
    await expect(page.getByRole('button', { name: verdict === 'pass' ? '校验通过' : '发现问题', exact: true })).toBeVisible();
    expect(inputs).toHaveLength(2);
  } finally { release(); }
});
