import { expect, test } from '@playwright/test';
import { SessionViewSchema } from '../../packages/contracts/src/http.js';
import { configureLocalModel, seedLocalSession } from './local-fixture.js';

test('typing with cached steps and knowledge does not serialize the answer photo again', async ({ page }) => {
  const id = '87000000-0000-4000-8000-000000000001';
  const now = new Date().toISOString();
  const candidate = { schemaVersion: 1, kind: 'answer', problem: { text: '求解 x+1=3', subject: 'math', uncertainties: [] }, answer: '**x=2**', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
  const outcome = { schemaVersion: 1, status: 'completed', verified: false, verification: null, warning: null, verificationStatus: 'not_requested', candidate };
  const run = { schemaVersion: 1, id, sessionId: id, status: 'completed', message: '', seq: 1, createdAt: now, outcome };
  const session = SessionViewSchema.parse({ schemaVersion: 1, id, subject: 'math', createdAt: now,
    upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: 100, width: 390, height: 844, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` },
    runs: [run,
      { ...run, id: '87000000-0000-4000-8000-000000000002', context: { kind: 'explanation', sourceRunId: id }, outcome: { ...outcome, candidate: { ...candidate, steps: [{ id: 's1', title: '移项', explanation: '两边减去 1。' }] } } },
      { ...run, id: '87000000-0000-4000-8000-000000000003', context: { kind: 'knowledge-list', sourceRunId: id }, outcome: { ...outcome, candidate: { ...candidate, knowledgePoints: ['等式的性质'] } } }],
  });
  await seedLocalSession(page, session, await page.screenshot({ type: 'jpeg' }));
  await configureLocalModel(page);
  await expect(page.locator('.final-answer')).toContainText('x=2');
  await page.locator('.step-details > summary').click();
  await expect(page.locator('.teaching-steps')).toContainText('两边减去');
  const input = page.getByRole('textbox', { name: '继续问这道题', exact: true });
  await input.click();
  await page.evaluate(() => {
    const original = JSON.stringify;
    document.documentElement.dataset.answerSerializations = '0';
    Object.defineProperty(JSON, 'stringify', { configurable: true, writable: true, value: function (...args: unknown[]) {
      const value = args[0];
      if (value && typeof value === 'object' && 'runId' in value && 'outcome' in value && 'image' in value && 'disabled' in value) {
        document.documentElement.dataset.answerSerializations = String(Number(document.documentElement.dataset.answerSerializations) + 1);
      }
      return Reflect.apply(original, JSON, args);
    } });
  });
  await input.pressSequentially('Explain why x equals 2', { delay: 20 });
  await expect(input).toHaveValue('Explain why x equals 2');
  const count = await page.evaluate(() => Number(document.documentElement.dataset.answerSerializations));
  console.log('answer payload serializations while typing', count);
  expect(count).toBe(0);
  await expect(page.locator('.teaching-steps')).toContainText('两边减去');
  await page.locator('.knowledge-panel summary').click();
  await page.getByRole('button', { name: '追问这个知识点', exact: true }).click();
  // A stable bridge must use the latest draft, not overwrite it with its initial closure.
  await expect(input).toHaveValue('Explain why x equals 2');
  await expect(page.getByRole('button', { name: '取消指定追问', exact: true })).toBeVisible();
});
