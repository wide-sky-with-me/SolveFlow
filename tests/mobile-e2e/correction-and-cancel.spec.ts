import { test, expect } from '@playwright/test';
import { SessionViewSchema, type RunView } from '../../packages/contracts/src/http.js';
import { seedLocalSession, configureLocalModel, modelSse, lastModelInput } from './local-fixture.js';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture() {
  const now = new Date().toISOString();
  return SessionViewSchema.parse({ schemaVersion: 1, id: id(1), subject: 'math', createdAt: now,
    upload: { schemaVersion: 1, id: id(2), mimeType: 'image/jpeg', bytes: 100, width: 400, height: 100, expiresAt: new Date(Date.now() + 3600000).toISOString(), previewUrl: `/api/v1/uploads/${id(2)}/image` },
    runs: [{ schemaVersion: 1, id: id(3), sessionId: id(1), status: 'completed', message: '解答两题', seq: 5, createdAt: now, outcome: { schemaVersion: 1, status: 'completed', verified: true, warning: null,
      verification: { schemaVersion: 1, verdict: 'pass', checked: ['transcription'], issues: [] },
      candidate: { schemaVersion: 1, kind: 'answer', problem: { text: '两道代数题', subject: 'math', uncertainties: [] }, knowledgePoints: [], citationIds: [], clarificationQuestions: [], answer: '两题结论',
        steps: [{ id: 'a', title: '第一题移项', explanation: '保持等式成立' }, { id: 'b', title: '第二题移项', explanation: '保持等式成立' }],
        questions: [{ number: 1, problem: { text: 'x+1=2', subject: 'math', uncertainties: [] }, answer: '第一题结论', stepIds: ['a'], figureIds: [] }, { number: 2, problem: { text: '2x+3=7', subject: 'math', uncertainties: [] }, answer: '第二题结论', stepIds: ['b'], figureIds: [] }] } } }] });
}
test('correcting one question prefills its statement and keeps an unverified revision locally', async ({ page }) => {
  const session = fixture(); const image = await page.screenshot({ type: 'jpeg' }); const posted: unknown[] = [];
  const original = session.runs[0]!.outcome; if (original?.status !== 'completed') throw new Error('FIXTURE');
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    posted.push(lastModelInput(route.request().postDataJSON()));
    const candidate = { ...original.candidate, questions: undefined, problem: { text: '2x+5=7', subject: 'math', uncertainties: [] }, answer: '更正结论 x = 1', steps: [] };
    await route.fulfill({ contentType: 'text/event-stream', body: modelSse(posted.length === 1 ? candidate : { schemaVersion: 1, verdict: 'unknown', checked: ['transcription'], issues: [{ code: 'INSUFFICIENT_EVIDENCE', message: '需要再次核对条件' }] }, route.request().postDataJSON()) });
  });
  await seedLocalSession(page, session, image); await configureLocalModel(page); await page.getByRole('tab', { name: '跳转第2题', exact: true }).click();
  const q1 = page.getByRole('region', { name: '第1题解答', exact: true }); const q2 = page.getByRole('region', { name: '第2题解答', exact: true });
  await q2.getByRole('button', { name: '识别有误？更正题干' }).click(); await expect(page.getByLabel('更正后的题干')).toHaveValue('2x+3=7');
  await page.getByLabel('更正后的题干').fill('2x+5=7'); await page.getByRole('button', { name: '按更正重新解答' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible(); await expect(q2.getByRole('heading', { name: '更正后的解答' })).toBeVisible();
  expect(posted[0]).toMatchObject({ problemCorrection: '2x+5=7', focus: { sourceRunId: id(3), content: expect.stringContaining('第2题') } });
  await expect(q2.getByText('未校验', { exact: true })).toBeVisible(); await page.getByRole('tab', { name: '跳转第1题', exact: true }).click(); await expect(q1.getByText('第一题结论', { exact: true })).toBeVisible(); await expect(q1.getByText('更正结论 x = 1', { exact: true })).toHaveCount(0);
  await page.reload(); await page.getByRole('tab', { name: '跳转第2题', exact: true }).click(); await q2.getByRole('button', { name: '历史解答', exact: true }).click(); await page.getByRole('radio', { name: '第1次解答', exact: true }).click(); await expect(q2.getByText('第二题结论', { exact: true })).toBeVisible(); await expect(q2.getByText('这是题干更正前的解答，请结合最新更正后的条件判断。')).toBeVisible();
});
test('reopening interrupted local work never resubmits and explicit cancel persists', async ({ page }) => {
  const session = fixture(); const image = await page.screenshot({ type: 'jpeg' }); let calls = 0; let release: (() => void) | undefined;
  let held = new Promise<void>(resolve => { release = resolve; });
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => { calls++; await held; await route.abort().catch(() => undefined); });
  await seedLocalSession(page, session, image); await configureLocalModel(page); await page.getByRole('tab', { name: '跳转第2题', exact: true }).click();
  const q2 = page.getByRole('region', { name: '第2题解答', exact: true }); await q2.getByLabel('继续问第2题').fill('解释移项'); await q2.getByRole('button', { name: '发送第2题追问' }).click(); await expect.poll(() => calls).toBe(1);
  await page.reload(); await page.getByRole('tab', { name: '跳转第2题', exact: true }).click(); release?.(); await expect(q2.getByRole('heading', { name: '这次没能完成解题' })).toBeVisible(); expect(calls).toBe(1);
  await configureLocalModel(page); await page.getByRole('tab', { name: '跳转第2题', exact: true }).click(); held = new Promise<void>(resolve => { release = resolve; }); await q2.getByRole('button', { name: '重新尝试' }).click(); await expect.poll(() => calls).toBe(2);
  await page.getByRole('button', { name: '取消本次解题' }).click(); release?.(); await expect(q2.getByRole('heading', { name: '本次解题已取消' })).toBeVisible(); await page.reload(); await page.getByRole('tab', { name: '跳转第2题', exact: true }).click(); await expect(q2.getByRole('heading', { name: '本次解题已取消' })).toBeVisible(); expect(calls).toBe(2);
});
