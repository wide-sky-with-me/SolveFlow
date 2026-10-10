import { expect, test } from '@playwright/test';
import { GeneratedSolverCandidateSchema } from '../../packages/contracts/src/agent.js';
import { SessionViewSchema } from '../../packages/contracts/src/http.js';
import { seedLocalSession, configureLocalModel, modelSse, modelPass, lastModelInput } from './local-fixture.js';
const id = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
for (const mode of ['single', 'multi'] as const) test(`${mode} regeneration preserves old work, scopes the question, blocks duplicates and retries failure`, async ({ page }) => {
  await page.clock.install({ time: Date.now() });
  const now = new Date().toISOString(); const image = await page.screenshot({ type: 'jpeg' });
  const problem = { text: '乙题完整条件', subject: 'math', uncertainties: [] };
  const candidate = { schemaVersion: 1, kind: 'answer', problem, answer: '旧的不完整解答', steps: [{ id: 'a', title: '甲步骤', explanation: '甲题私有条件' }, { id: 'b', title: '乙步骤', explanation: '乙题条件' }], questions: mode === 'multi' ? [{ number: 1, answer: '甲题原答案', stepIds: ['a'], figureIds: [], problem: { ...problem, text: '甲题私有条件' } }, { number: 2, answer: '旧的不完整解答', stepIds: ['b'], figureIds: [], problem }] : undefined, knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
  const session = SessionViewSchema.parse({ schemaVersion: 1, id: id(1), subject: 'math', createdAt: now, upload: { schemaVersion: 1, id: id(2), mimeType: 'image/jpeg', bytes: image.length, width: 320, height: 700, expiresAt: new Date(Date.now() + 3600000).toISOString(), previewUrl: `/api/v1/uploads/${id(2)}/image` }, runs: [{ schemaVersion: 1, id: id(3), sessionId: id(1), status: 'completed', message: '请详细解答', seq: 5, createdAt: now, outcome: { schemaVersion: 1, status: 'completed', verified: true, warning: null, verification: { schemaVersion: 1, verdict: 'pass', checked: ['transcription'], issues: [] }, candidate } }] });
  let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; }); const posted: unknown[] = [];
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    posted.push(lastModelInput(route.request().postDataJSON())); const call = posted.length;
    if (call === 1) await gate;
    if (call === 2 || call === 3) return route.fulfill({ status: 503, body: 'fixture unavailable' });
    const answer = GeneratedSolverCandidateSchema.parse({ ...candidate, questions: undefined, answer: '重新计算后的完整答案', steps: [{ id: 'fresh', title: '重新列式', explanation: '重新核对原题后完整计算。' }] });
    await route.fulfill({ contentType: 'text/event-stream', body: modelSse(answer, route.request().postDataJSON()) });
  });
  try {
    await seedLocalSession(page, session, image); await configureLocalModel(page); if (mode === 'multi') await page.getByRole('tab', { name: '跳转第2题', exact: true }).click();
    const thread = page.getByRole('region', { name: mode === 'multi' ? '第2题解答' : '这道题的持续对话', exact: true });
    const draft = thread.getByLabel(mode === 'multi' ? '继续问第2题' : '继续问这道题', { exact: true });
    await draft.fill('未发送的追问保留');
    const action = thread.getByRole('button', { name: '重新解答', exact: true });
    await expect(thread.locator('.problem-heading').getByRole('button', { name: '重新解答', exact: true })).toHaveCount(1);
    await expect(action).toHaveCount(1);
    await action.evaluate(node => { if (!(node instanceof HTMLElement)) throw new Error('BUTTON'); node.click(); node.click(); });
    await expect.poll(() => posted.length).toBe(1);
    await expect(draft).not.toBeEditable();
    if (mode === 'multi') { await page.getByRole('tab', { name: '跳转第1题', exact: true }).click(); await expect(page.getByRole('region', { name: '第1题解答', exact: true }).getByRole('button', { name: '重新解答' })).toBeDisabled(); await page.getByRole('tab', { name: '跳转第2题', exact: true }).click(); }
    await thread.getByRole('button', { name: '历史解答', exact: true }).click(); await page.getByRole('radio', { name: '第1次解答', exact: true }).click();
    await expect(thread.getByText('旧的不完整解答', { exact: true })).toBeVisible();
    release();
    await expect.poll(() => posted.length).toBe(1);
    await thread.getByRole('button', { name: '历史解答', exact: true }).click(); await page.getByRole('radio', { name: '第2次解答', exact: true }).click();
    await expect(thread.getByText('重新计算后的完整答案', { exact: true })).toBeVisible();
    await expect(thread.getByRole('heading', { name: '重新解答', exact: true })).toBeVisible();
    await expect(draft).toHaveValue('未发送的追问保留');
    await expect.poll(() => posted.length).toBe(1); // Manual mode: one Solver call; no automatic Verifier.
    expect(posted[0]).toMatchObject({ message: expect.stringContaining('从头重新解答'), answerMode: 'brief', verificationMode: 'manual', focus: { kind: 'regenerate', verified: false, content: expect.stringContaining(mode === 'multi' ? '只重新完整解答第2题' : '重新完整解答本题') } });
    if (mode === 'multi') {
      expect(JSON.stringify(posted[0])).not.toContain('甲题私有条件');
      await page.getByRole('tab', { name: '跳转第1题', exact: true }).click();
      await expect(page.getByRole('region', { name: '第1题解答', exact: true }).getByText('甲题原答案', { exact: true })).toBeVisible();
    }
    await page.reload(); await configureLocalModel(page); if (mode === 'multi') await page.getByRole('tab', { name: '跳转第2题', exact: true }).click();
    await expect(thread.getByText('重新计算后的完整答案', { exact: true })).toBeVisible();
    // Keep wall time advancing: RN Web animations use Date.now(), including after reload.
    const shifted = await page.evaluate(() => Date.now()) - 60_000;
    await page.clock.setSystemTime(shifted);
    await expect.poll(() => page.evaluate(() => Date.now())).toBeGreaterThan(shifted);
    await action.click();
    await expect.poll(() => posted.length, { message: '重新解答按钮应发起第二次模型请求' }).toBe(2);
    await expect(thread.getByRole('heading', { name: '这次没能完成解题' })).toBeVisible();
    await thread.getByRole('button', { name: '诊断详情', exact: true }).click();
    await expect(page.getByText(/HTTP 503/)).toHaveCount(2); await expect(page.getByText(/HTTP 503/).first()).toBeVisible();
    await page.getByRole('button', { name: '关闭诊断' }).click();
    await thread.getByRole('button', { name: '历史解答', exact: true }).click(); await page.getByRole('radio', { name: '第1次解答', exact: true }).click();
    await expect(thread.getByText('旧的不完整解答', { exact: true })).toBeVisible();
    await thread.getByRole('button', { name: '历史解答', exact: true }).click(); await page.getByRole('radio', { name: '第2次解答', exact: true }).click();
    await expect(thread.getByText('重新计算后的完整答案', { exact: true })).toBeVisible();
    await thread.getByRole('button', { name: '历史解答', exact: true }).click(); await page.getByRole('radio', { name: '第3次解答', exact: true }).click();
    await thread.getByRole('button', { name: '重新尝试' }).click();
    await expect.poll(() => posted.length).toBe(4);
    // Dispatching the Verifier is not completion; reload only after the saved terminal result.
    await expect(thread.getByTestId('solve-progress')).toHaveCount(0);
    await page.reload(); if (mode === 'multi') await page.getByRole('tab', { name: '跳转第2题', exact: true }).click();
    await expect(thread.getByText('重新计算后的完整答案', { exact: true })).toBeVisible();
    if (mode === 'multi') await expect(page.getByRole('region', { name: /^第[12]题解答$/ })).toHaveCount(1);
  } finally { release(); }
});
