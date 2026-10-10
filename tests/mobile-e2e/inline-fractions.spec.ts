import { expect, test } from '@playwright/test';
import { chooseSyntheticPhoto, configureLocalModel, modelSse } from './local-fixture.js';

test('short inline fractions remain fully visible without vertical scrollbars, while long formulas scroll horizontally', async ({ page }, info) => {
  await page.route('**/__solveflow/web-env', route => route.fulfill({ status: 404 }));
  let calls = 0;
  const fractions = [String.raw`-\frac{13}{2}`, String.raw`-\frac{85}{16}`, String.raw`-\frac{13}{8}`, '-1', String.raw`-\frac{1}{4}`, String.raw`\frac{7}{4}`, '7'];
  const long = Array.from({ length: 24 }, (_, n) => `x_{${n + 1}}`).join('+');
  const candidate = { schemaVersion: 1, kind: 'answer', problem: { text: 'Find the value of the integral.', subject: 'math', uncertainties: [], options: fractions.map((value, n) => ({ label: String.fromCharCode(65 + n), text: `$${value}$` })) }, answer: `$${long}$`, selectedOptions: ['D'], steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
  await page.route('https://fixture-model.invalid/v1/chat/completions', route => { calls++; return route.fulfill({ contentType: 'text/event-stream', body: modelSse(candidate, route.request().postDataJSON()) }); });
  await page.goto('/'); await configureLocalModel(page); await chooseSyntheticPhoto(page); await page.getByRole('button', { name: '开始解题', exact: true }).click();
  await expect(page.locator('.choice-options li')).toHaveCount(7);
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme }); await page.evaluate(() => document.fonts.ready);
      const short = await page.locator('.choice-options .math-inline').evaluateAll(nodes => nodes.map(node => {
        const box = node.getBoundingClientRect();
        const ink = [...node.querySelectorAll('.katex-html .mord, .frac-line')].filter(element => element.childElementCount === 0).map(element => element.getBoundingClientRect());
        return { overflowY: getComputedStyle(node).overflowY, overflowX: getComputedStyle(node).overflowX, clientHeight: node.clientHeight, scrollHeight: node.scrollHeight, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, inkFits: ink.every(rect => rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1) };
      }));
      for (const result of short) {
        expect(result.overflowY).toBe('hidden'); expect(result.overflowX).toBe('auto');
        expect(result.scrollHeight).toBeLessThanOrEqual(result.clientHeight + 1); expect(result.scrollWidth).toBeLessThanOrEqual(result.clientWidth + 1); expect(result.inkFits).toBe(true);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      if (width === 320) {
        const formula = page.locator('.final-answer .math-inline');
        expect(await formula.evaluate(node => node.scrollWidth > node.clientWidth + 20)).toBe(true);
        expect(await formula.evaluate(node => { node.scrollLeft = 40; return node.scrollLeft; })).toBeGreaterThan(0);
      }
    }
  }
  await page.locator('.problem-statement').screenshot({ path: info.outputPath('fractions.png') });
  await page.reload(); await expect(page.locator('.choice-options li')).toHaveCount(7); expect(calls).toBe(1);
});
