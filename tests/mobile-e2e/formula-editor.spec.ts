import { test, expect } from '@playwright/test';
import { SessionViewSchema } from '../../packages/contracts/src/http.js';
import { seedLocalSession, configureLocalModel, modelSse, modelPass, lastModelInput } from './local-fixture.js';

test('correction edits TeX source with live safe preview and preserves it through submission', async ({ page }, info) => {
  const id = '50000000-0000-4000-8000-000000000001'; const now = new Date().toISOString();
  const source = '已知 $\\frac{x}{2}=3$，求 $x$。';
  const image = await page.screenshot({ type: 'jpeg' });
  const candidate = { schemaVersion: 1, kind: 'answer', problem: { text: source, subject: 'math', uncertainties: [] }, answer: '$x=6$', steps: [{ id: 's1', title: '两边乘二', explanation: '等式两边同时乘二。' }], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
  const session = SessionViewSchema.parse({ schemaVersion: 1, id, subject: 'math', createdAt: now, upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: image.length, width: 320, height: 700, expiresAt: new Date(Date.now() + 3600000).toISOString(), previewUrl: `/api/v1/uploads/${id}/image` }, runs: [{ schemaVersion: 1, id, sessionId: id, status: 'completed', message: '', seq: 5, createdAt: now, outcome: { schemaVersion: 1, status: 'completed', verified: true, warning: null, verification: modelPass, candidate } }] });
  const posted: unknown[] = []; const corrected = '已知 \\(\\frac{x}{2}=4\\)，求 $x$。';
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    posted.push(lastModelInput(route.request().postDataJSON()));
    await route.fulfill({ contentType: 'text/event-stream', body: modelSse(posted.length === 1 ? { ...candidate, problem: { ...candidate.problem, text: corrected }, answer: '$x=8$' } : modelPass, route.request().postDataJSON()) });
  });
  await seedLocalSession(page, session, image); await configureLocalModel(page);
  await page.getByRole('button', { name: '识别有误？更正题干' }).click();
  const editor = page.getByLabel('更正后的题干', { exact: true }); const preview = page.getByRole('region', { name: '题干公式预览' });
  await expect(editor).toHaveValue(source); await expect(preview.locator('.katex')).toHaveCount(2);
  await editor.fill('求'); await editor.press('End'); await page.getByRole('button', { name: '分数', exact: true }).click();
  await expect(editor).toHaveValue('求$\\frac{x}{2}$'); await expect(preview.locator('.katex')).toHaveCount(1);
  await editor.press('y'); await expect(editor).toHaveValue('求$\\frac{y}{2}$'); // selected operand is editable
  await editor.fill('$\\frac{1}{$'); await expect(preview.locator('.math-fallback')).toBeVisible();
  await editor.fill('<script>globalThis.texExecuted=true</script> $\\href{javascript:alert(1)}{x}$');
  await expect(preview.locator('script,a')).toHaveCount(0);
  expect(await page.evaluate(() => 'texExecuted' in globalThis)).toBe(false);
  await editor.fill(corrected); await expect(preview.locator('.katex')).toHaveCount(2);
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('formula-editor.png') });
  await page.getByRole('button', { name: '按更正重新解答', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '更正后的解答', exact: true })).toBeVisible();
  expect(posted[0]).toMatchObject({ problemCorrection: corrected });
  await expect(page.locator('.problem-heading').getByRole('button', { name: '重新解答' })).toHaveCount(1);
  await page.getByRole('button', { name: '识别有误？更正题干' }).click();
  await expect(editor).toHaveValue(corrected); await expect(preview.locator('.katex')).toHaveCount(2);
  await editor.fill('未提交的修改'); await page.getByRole('button', { name: '取消更正' }).click();
  await page.getByRole('button', { name: '识别有误？更正题干' }).click();
  await expect(editor).toHaveValue(corrected); expect(posted).toHaveLength(1);
});
