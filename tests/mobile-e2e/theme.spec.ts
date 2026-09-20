import { expect, test } from '@playwright/test';
import { configureLocalModel, chooseSyntheticPhoto, modelSse, modelPass } from './local-fixture.js';

test('system appearance switches live and explicit choice persists without losing an active solve', async ({ page }, info) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/'); await configureLocalModel(page); await chooseSyntheticPhoto(page);
  let release = () => {}; const gate = new Promise<void>(r => { release = r; }); let calls = 0;
  const candidate = { schemaVersion: 1, kind: 'answer', problem: { text: '求 $x^2=4$ 的解', subject: 'math', uncertainties: [] }, answer: '$x=\\pm2$', steps: [{ id: 's1', title: '开方', explanation: '$x=\\pm\\sqrt4$' }], knowledgePoints: [], citationIds: [], clarificationQuestions: [], figures: [{ schemaVersion: 1, kind: 'coordinate', id: 'f', title: '$y=x^2$', description: '图上关键点为 $(2,4)$。', xRange: [0, 2], yRange: [0, 4], elements: [{ kind: 'polynomial', coefficients: [0, 0, 1], label: 'y=x²' }] }] };
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => { const n = ++calls; if (n === 1) await gate; await route.fulfill({ contentType: 'text/event-stream', body: modelSse(candidate, route.request().postDataJSON()) }); });
  try {
    await page.getByRole('button', { name: '开始解题', exact: true }).click(); await expect.poll(() => calls).toBe(1);
    await page.getByRole('tab', { name: '我的', exact: true }).click(); await page.getByRole('button', { name: '外观', exact: true }).click();
    await expect(page.getByRole('radio', { name: '跟随系统' })).toBeChecked();
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.getByRole('heading', { name: '外观', exact: true })).toHaveCSS('color', 'rgb(230, 237, 247)');
    await page.getByRole('button', { name: '完成', exact: true }).click(); await page.getByRole('tab', { name: '题目', exact: true }).click();
    await expect(page.getByRole('heading', { name: '外观', exact: true })).toBeHidden();
    release(); await expect(page.locator('.final-answer .katex')).toHaveCount(3);
    await expect(page.locator('.final-answer')).toHaveCSS('background-color', 'rgb(24, 34, 50)');
    await expect(page.locator('.final-answer .answer-figure')).toBeVisible();
    await page.locator('.step-details summary').click();
    await expect(page.locator('.step-details .answer-figure')).toBeVisible();
    await expect(page.locator('.answer-figure')).toHaveCount(2);
    expect(Number((await page.locator('.final-answer svg[role=img]').getAttribute('viewBox'))!.split(' ')[2])).toBeLessThan(640);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('dark-answer.png') });
    await page.emulateMedia({ colorScheme: 'light' }); await expect(page.locator('.final-answer')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await page.getByRole('tab', { name: '我的', exact: true }).click(); await page.getByRole('button', { name: '外观', exact: true }).click();
    await page.getByRole('radio', { name: '暗色', exact: true }).click(); await page.getByRole('button', { name: '完成', exact: true }).click();
    await page.reload(); await expect(page.locator('.final-answer')).toHaveCSS('background-color', 'rgb(24, 34, 50)');
    expect(calls).toBe(2);
  } finally { release(); }
});
