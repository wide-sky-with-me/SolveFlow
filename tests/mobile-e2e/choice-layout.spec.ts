import { expect, test } from '@playwright/test';
import { chooseSyntheticPhoto, configureLocalModel, modelSse } from './local-fixture.js';
for (const labels of [['A','B','C','D'], ['F','G','H','J']]) test(`structured choice rows and answer-first layout survive reload (${labels.join('')})`, async ({ page }) => {
  let calls = 0;
  const options = [{ label: 'A', text: '$0.4$' }, { label: 'B', text: '$1.5$' }, { label: 'C', text: '$2.4$' }, { label: 'D', text: 'A deliberately long option that wraps naturally on a narrow screen, including $\\frac{33}{10}$.' }];
  options.forEach((option, index) => { option.label = labels[index]!; });
  const selected = labels[2]!;
  const text = 'At $x=32$, which choice is closest to the predicted value?';
  const candidate = { schemaVersion: 1, kind: 'answer', problem: { text, options, subject: 'math', uncertainties: [] }, selectedOptions: [selected], answer: 'Reading the line gives $y\\approx2$, closest to $2.4$.', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
  await page.route('https://fixture-model.invalid/v1/chat/completions', route => { calls++; return route.fulfill({ contentType: 'text/event-stream', body: modelSse(candidate, route.request().postDataJSON()) }); });
  await page.goto('/'); await configureLocalModel(page); await chooseSyntheticPhoto(page);
  await page.getByRole('button', { name: '开始解题', exact: true }).click();
  await expect(page.locator('.final-answer h3')).toHaveText(`答案：${selected}`);
  await expect(page.locator('.choice-options li')).toHaveCount(4);
  await expect(page.locator('.answer-explanation')).toContainText('Reading the line');
  await expect(page.locator('.teaching-steps')).toHaveCount(0);
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme }); await page.setViewportSize({ width: 320, height: 844 });
    expect(await page.locator('.choice-options li').evaluateAll(nodes => nodes.every((node, i) => i === 0 || node.getBoundingClientRect().top >= nodes[i - 1]!.getBoundingClientRect().bottom))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('.katex-error')).toHaveCount(0);
  }
  await page.getByRole('button', { name: '识别有误？更正题干' }).click();
  await expect(page.getByLabel('更正后的题干', { exact: true })).toHaveValue(new RegExp(`${labels[0]}[.)].*0.4`, 's'));
  await page.reload(); await expect(page.locator('.final-answer h3')).toHaveText(`答案：${selected}`);
  await expect(page.locator('.choice-options li')).toHaveCount(4); expect(calls).toBe(1);
  await expect(page.getByTestId('launch-screen')).toBeHidden();
  await page.locator('.problem-statement').screenshot({ path: `.runtime/recent-answer-review/choice-${labels.join('')}-${test.info().project.name}.png` });
});
