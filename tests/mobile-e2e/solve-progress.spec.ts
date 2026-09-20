import { expect, test } from '@playwright/test';
import { chooseSyntheticPhoto, configureLocalModel, modelSse } from './local-fixture.js';
const candidate = { schemaVersion: 1, kind: 'answer', problem: { text: '解方程 x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
for (const reduced of [false, true]) test(`waiting animation stops when the manual-mode answer arrives and cancels follow-up (reduced: ${reduced})`, async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
  let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; });
  let cancelRelease = () => {}; const cancelledGate = new Promise<void>(resolve => { cancelRelease = resolve; }); let calls = 0;
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    const call = ++calls; if (call === 1) { await gate; return route.fulfill({ contentType: 'text/event-stream', body: modelSse(candidate) }); }
    await cancelledGate; await route.abort().catch(() => undefined);
  });
  try {
    await page.goto('/'); await configureLocalModel(page); await chooseSyntheticPhoto(page); await page.getByRole('button', { name: '开始解题', exact: true }).click();
    const card = page.getByTestId('solve-progress'); const progress = card.getByRole('progressbar', { name: '解题进度' });
    await expect.poll(() => calls).toBe(1); await expect(progress).toHaveAttribute('aria-valuetext', '正在解题'); await expect(progress).not.toHaveAttribute('aria-valuenow');
    if (reduced) await expect(page.getByTestId('solve-scan')).toHaveCount(0);
    else { const scan = page.getByTestId('solve-scan'); await expect(scan).toBeVisible(); const before = await scan.evaluate(node => getComputedStyle(node).transform); await expect.poll(() => scan.evaluate(node => getComputedStyle(node).transform)).not.toBe(before); await card.screenshot({ path: info.outputPath('waiting.png') }); }
    release(); await expect(card).toHaveCount(0); await expect(page.getByRole('button', { name: '校验', exact: true })).toBeEnabled(); expect(calls).toBe(1);
    await page.getByLabel('继续问这道题', { exact: true }).fill('解释这个结论'); await page.getByRole('button', { name: '发送同题追问', exact: true }).click();
    await expect.poll(() => calls).toBe(2); await card.getByRole('button', { name: '取消本次解题' }).click(); cancelRelease();
    await expect(page.getByRole('heading', { name: '本次解题已取消' })).toBeVisible();
    await page.getByRole('button', { name: '历史解答', exact: true }).click(); await page.getByRole('radio', { name: '第1次解答', exact: true }).click();
    await expect(page.getByText('x=2', { exact: true })).toBeVisible(); expect(calls).toBe(2);
  } finally { release(); cancelRelease(); }
});
