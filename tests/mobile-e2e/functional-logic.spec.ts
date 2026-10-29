import { expect, test, type Page } from '@playwright/test';
import { SessionViewSchema } from '../../packages/contracts/src/http.js';
import { GeneratedSolverCandidateSchema } from '../../packages/contracts/src/agent.js';
import { configureLocalModel, lastModelInput, modelPass, modelSse, seedLocalSession } from './local-fixture.js';

test.use({ reducedMotion: 'reduce' });
const id = (n: number) => `97100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const problem = { text: 'Self-authored functional fixture.', subject: 'math', uncertainties: [] };
const candidate = { schemaVersion: 1, kind: 'answer', problem, answer: 'Original answer.', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
async function seed(page: Page, grouped: boolean) {
  const image = await page.screenshot({ type: 'jpeg' }); const createdAt = new Date().toISOString();
  const session = SessionViewSchema.parse({ schemaVersion: 1, id: id(1), subject: 'math', createdAt, upload: { schemaVersion: 1, id: id(1), mimeType: 'image/jpeg', bytes: image.length, width: 400, height: 300, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id(1)}/image` }, runs: [{ schemaVersion: 1, id: id(2), sessionId: id(1), status: 'completed', createdAt, seq: 1, message: '', outcome: { schemaVersion: 1, status: 'completed', verified: false, verificationStatus: 'not_requested', warning: null, verification: null, candidate: { ...candidate, ...(grouped ? { questions: [1, 2].map(number => ({ number, answer: `Question ${number} answer.`, stepIds: [], figureIds: [] })) } : {}) } } }] });
  await seedLocalSession(page, session, image); await configureLocalModel(page);
}

test('partial question verification and legacy summary recovery never mark a whole photo verified', async ({ page }) => {
  let calls = 0;
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => { calls++; await route.fulfill({ contentType: 'text/event-stream', body: modelSse(modelPass, route.request().postDataJSON()) }); });
  await seed(page, true);
  await page.getByRole('region', { name: '第1题解答', exact: true }).getByRole('button', { name: '校验', exact: true }).click();
  await expect(page.getByRole('button', { name: '校验通过', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '历史题目', exact: true }).click();
  const row = page.locator(`.history-entry[data-session-id="${id(1)}"]`);
  await expect(row.locator('.history-state')).toHaveText('待确认');
  // Only this browser context's derived cache is replaced; the original record stays intact.
  await page.evaluate(key => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('solveflow-local', 1); open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result; const tx = db.transaction('documents', 'readwrite'); const store = tx.objectStore('documents'); const read = store.get(key);
      read.onsuccess = () => {
        if (typeof read.result !== 'string') { tx.abort(); return; }
        const value: unknown = JSON.parse(read.result);
        if (typeof value !== 'object' || value === null || Array.isArray(value)) { tx.abort(); return; }
        store.put(JSON.stringify({ ...Object.fromEntries(Object.entries(value).filter(([name]) => name !== 'answerStateVersion')), answerState: 'verified' }), key);
      };
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), `summary.${id(1)}`);
  await page.reload(); await expect(row.locator('.history-state')).toHaveText('待确认'); expect(calls).toBe(1);
  await row.getByRole('button', { name: `打开数学题目 ${id(1)}`, exact: true }).click(); await configureLocalModel(page);
  await page.getByRole('tab', { name: '跳转第2题', exact: true }).click();
  await page.getByRole('region', { name: '第2题解答', exact: true }).getByRole('button', { name: '校验', exact: true }).click();
  await expect(page.getByRole('button', { name: '校验通过', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '历史题目', exact: true }).click(); await expect(row.locator('.history-state')).toHaveText('校验通过');
  await page.reload(); await expect(row.locator('.history-state')).toHaveText('校验通过'); expect(calls).toBe(2);
});

test('structured teaching examples stay in the source page through follow-up and reload', async ({ page }) => {
  const calls: unknown[] = [];
  const detail = GeneratedSolverCandidateSchema.parse({ ...candidate, answer: 'Detailed teaching.', steps: [{ id: 'example-a', title: 'Teaching example A', explanation: 'Check the original equation.' }, { id: 'example-b', title: 'Teaching example B', explanation: 'Check by substitution.' }], questions: [1, 2].map((number, index) => ({ number, problem, answer: `Example ${number}`, stepIds: [index ? 'example-b' : 'example-a'], figureIds: [] })) });
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => { const body: unknown = route.request().postDataJSON(); calls.push(lastModelInput(body)); await route.fulfill({ contentType: 'text/event-stream', body: modelSse(calls.length === 1 ? detail : { ...candidate, answer: 'Follow-up remains in the original question.' }, body) }); });
  await seed(page, false); await page.locator('.step-details>summary').click();
  await expect(page.locator('.teaching-steps')).toContainText('Teaching example A');
  await expect(page.getByRole('tab', { name: /^跳转第/ })).toHaveCount(0); expect(calls).toHaveLength(1);
  await page.locator('.teaching-steps li').filter({ has: page.getByRole('heading', { name: 'Teaching example A', exact: true }) }).getByRole('button', { name: '这一步不懂', exact: true }).click();
  await page.getByLabel('继续问这道题', { exact: true }).fill('Explain the first example.'); await page.getByRole('button', { name: '发送同题追问', exact: true }).click();
  await expect(page.locator('.final-answer')).toContainText('Follow-up remains in the original question.'); expect(calls[1]).toMatchObject({ focus: { kind: 'step', content: expect.stringContaining('Teaching example A') } });
  await page.reload(); await expect(page.locator('.final-answer')).toContainText('Follow-up remains in the original question.');
  await expect(page.getByRole('tab', { name: /^跳转第/ })).toHaveCount(0); expect(calls).toHaveLength(2);
});
