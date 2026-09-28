import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { SessionViewSchema } from '../../packages/contracts/src/http.js';
import { seedLocalSession } from './local-fixture.js';

test('reading follows the system face while math retains its scale, baseline and safe layout', async ({ page }, info) => {
  const id = '93000000-0000-4000-8000-000000000001'; const now = new Date().toISOString(); const image = await page.screenshot({ type: 'jpeg' });
  const problem = 'Compare 2 with $2$ and 8 with $8$. **Bold text** and *italic text*.\n\n求解：If $x^{2}+y_{1}=\\sqrt{5}$ and $\\frac{1}{2}+x=3$, find $x$. Use $\\theta \\leq \\pi$ and $\\sum_{i=1}^{n}i$.\n\nLong inline: $123456789012345678901234567890123456789012345678901234567890$.\n\n\\[\\frac{1+\\sqrt{x^2+4}}{2}=y\\]';
  const session = SessionViewSchema.parse({ schemaVersion: 1, id, subject: 'math', createdAt: now, upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: image.length, width: 390, height: 844, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` }, runs: [{ schemaVersion: 1, id: '93000000-0000-4000-8000-000000000002', sessionId: id, status: 'completed', message: '', seq: 5, createdAt: now, outcome: { schemaVersion: 1, status: 'completed', verified: true, warning: null, verification: { schemaVersion: 1, verdict: 'pass', checked: ['transcription'], issues: [] }, candidate: { schemaVersion: 1, kind: 'answer', problem: { text: problem, subject: 'math', uncertainties: [] }, answer: '**Answer:** $x=2.5$.', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } } }] });
  await seedLocalSession(page, session, image);
  // Simulate a personalized device text face; all prose must inherit the chosen system face.
  await page.addStyleTag({ content: '.answer-document { font-family:cursive; }' });
  await expect(page.locator('.problem-text .katex')).toHaveCount(9);
  await page.evaluate(() => document.fonts.ready);
  const metrics = await page.locator('.problem-text .answer-markdown p').first().evaluate(node => {
    const text = node.firstChild!; const range = document.createRange(); const offset = text.textContent!.indexOf('2'); range.setStart(text, offset); range.setEnd(text, offset + 1); const prose = range.getBoundingClientRect();
    const symbol = node.querySelector('.katex-html .mord')!; range.selectNodeContents(symbol); const math = range.getBoundingClientRect();
    return { proseFont: getComputedStyle(node).fontFamily, symbolFont: getComputedStyle(symbol).fontFamily, proseSize: getComputedStyle(node).fontSize, symbolSize: getComputedStyle(symbol).fontSize, glyphBottomDelta: Math.abs(prose.bottom - math.bottom), heightDelta: Math.abs(prose.height - math.height) };
  });
  await mkdir('.runtime/typography-review', { recursive: true });
  await writeFile(`.runtime/typography-review/metrics-${info.project.name}.json`, JSON.stringify(metrics, null, 2));
  await test.info().attach('glyph-metrics', { body: JSON.stringify(metrics), contentType: 'application/json' });
  expect(metrics.proseFont).toBe('cursive');
  expect(metrics.symbolFont).toContain('KaTeX_Main');
  expect(metrics.proseSize).toBe(metrics.symbolSize);
  const baseline = await page.locator('.problem-text .answer-markdown p').first().evaluate(node => {
    const probe = () => { const span = document.createElement('span'); span.style.cssText = 'display:inline-block;width:0;height:0;padding:0;margin:0;vertical-align:baseline'; return span; };
    const prose = probe(); const math = probe(); node.insertBefore(prose, node.firstChild); node.querySelector('.katex-html')!.append(math);
    const delta = Math.abs(prose.getBoundingClientRect().top - math.getBoundingClientRect().top); prose.remove(); math.remove(); return delta;
  });
  expect(baseline).toBeLessThan(1);
  const cdp = await page.context().newCDPSession(page); await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument'); const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.problem-text .answer-markdown p' });
  const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
  expect(fonts.length).toBeGreaterThan(0);
  expect(fonts.every(font => !font.isCustomFont)).toBe(true);
  const chineseNode = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.problem-text .answer-markdown p:nth-child(2)' });
  const chineseFonts = await cdp.send('CSS.getPlatformFontsForNode', { nodeId: chineseNode.nodeId });
  await writeFile(`.runtime/typography-review/fonts-${info.project.name}.json`, JSON.stringify({ latin: fonts, chinese: chineseFonts.fonts }, null, 2));
  await test.info().attach('actual-reading-fonts', { body: JSON.stringify({ latin: fonts, chinese: chineseFonts.fonts }), contentType: 'application/json' });
  expect(chineseFonts.fonts.length).toBeGreaterThan(0);
  expect(chineseFonts.fonts.every(font => !font.isCustomFont)).toBe(true); await cdp.detach();
  await expect(page.getByTestId('launch-screen')).toBeHidden();
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme }); await page.setViewportSize({ width: 320, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await expect(page.locator('.math-fallback,.katex-error')).toHaveCount(0);
    await page.locator('.problem-statement').screenshot({ path: `.runtime/typography-review/${info.project.name}-${colorScheme}.png` });
  }
  await page.getByRole('tab', { name: '历史题目', exact: true }).click();
  await expect(page.locator('.history-preview .katex').first()).toBeVisible();
  expect(await page.locator('.history-preview .answer-markdown').evaluate(node => getComputedStyle(node).fontFamily)).toBe(metrics.proseFont);
});
