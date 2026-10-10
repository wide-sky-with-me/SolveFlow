import { expect, test } from '@playwright/test';
import { chooseSyntheticPhoto, configureLocalModel, modelSse } from './local-fixture.js';

test('renders currency and Chinese quantity labels without losing prose or dollar signs', async ({ page }) => {
  await page.route('https://fixture-model.invalid/v1/chat/completions', route => route.fulfill({
    contentType: 'text/event-stream',
    body: modelSse({
      schemaVersion: 1, kind: 'answer',
      problem: { text: String.raw`票价 \(\$25\)，求合计。`, subject: 'math', uncertainties: [] },
      answer: String.raw`成人票$12，再买儿童票$7，合计$19。另一个例子的费用为 $\$50$；物理量为 $R_{总}=R_1+R_2$。`,
      steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [],
    }),
  }));
  await page.goto('/'); await configureLocalModel(page); await chooseSyntheticPhoto(page);
  await page.getByRole('button', { name: '开始解题', exact: true }).click();
  const answer = page.locator('.final-answer');
  await expect(answer).toContainText('成人票$12，再买儿童票$7，合计$19。');
  await expect(answer.locator('.katex')).toHaveCount(2);
  await expect(answer.locator('.katex-html').first()).toContainText('$50');
  await expect(answer.locator('.katex-html').last()).toContainText('总');
  await expect(page.locator('.problem-statement .katex-html')).toContainText('$25');
  await expect(page.locator('.math-fallback')).toHaveCount(0);
});
