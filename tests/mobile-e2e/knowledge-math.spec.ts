import { expect, test } from '@playwright/test';
import { SessionViewSchema } from '../../packages/contracts/src/http.js';
import { LocalRecordSchema, StoredLocalRecordSchema } from '../../packages/contracts/src/local.js';
import { configureLocalModel, lastModelInput, modelSse, seedLocalSession } from './local-fixture.js';

test('knowledge formulas in inline code render while stored names and follow-up references stay intact', async ({ page }, info) => {
  const id = '73000000-0000-4000-8000-000000000001'; const now = new Date().toISOString(); const image = await page.screenshot({ type: 'jpeg' });
  const name = '同角三角函数的平方关系（`sin^2\\theta+\\cos^2\\theta=1`）';
  const other = '互余角关系（`\\cos\\theta=\\sin(90^\\circ-\\theta)`）';
  const controls = ['同角平方关系（$\u001bsin^2\\theta+\\cos^2\\theta=1$）', '互余角关系（$\u001bcos\\theta=\\sin(90^\\circ-\\theta)$）'];
  const candidate = { schemaVersion: 1, kind: 'answer', problem: { text: '利用三角恒等式求和。', subject: 'math', uncertainties: [] }, answer: '结果：2', steps: [], knowledgePoints: [name, other, ...controls], knowledgeDetails: [{ name, explanation: '平方关系为 `\\sin^2\\theta+\\cos^2\\theta=1`。', application: '互余角 `\\cos\\theta=\\sin(90^\\circ-\\theta)` 可配对。', pitfall: '保留角度单位；代码 `const x = 1;` 不当作公式。' }, { name: other, explanation: '互余角的正弦与余弦相等。', application: '配对相加。' }], citationIds: [], clarificationQuestions: [] };
  const session = SessionViewSchema.parse({ schemaVersion: 1, id, subject: 'math', createdAt: now, upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: image.length, width: 390, height: 844, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` }, runs: [{ schemaVersion: 1, id, sessionId: id, createdAt: now, status: 'completed', message: '', seq: 1, outcome: { schemaVersion: 1, status: 'completed', verified: false, verificationStatus: 'not_requested', warning: null, verification: null, candidate } }] });
  let posts = 0;
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    posts++; expect(lastModelInput(route.request().postDataJSON())).toMatchObject({ focus: { kind: 'knowledge', sourceRunId: id, content: expect.stringContaining(name) } });
    await route.fulfill({ contentType: 'text/event-stream', body: modelSse({ ...candidate, answer: '使用平方关系配对。', steps: [], knowledgePoints: [], knowledgeDetails: [] }, route.request().postDataJSON()) });
  });
  await seedLocalSession(page, session, image); await configureLocalModel(page);
  const panel = page.locator('.knowledge-panel'); await expect(panel.locator('summary .katex')).toHaveCount(4);
  const first = panel.locator('details').first(); await first.locator('summary').click();
  await expect(first.locator('.knowledge-detail .katex')).toHaveCount(2);
  await expect(panel.locator('.math-fallback')).toHaveCount(0);
  await expect(first.locator('code')).toHaveText('const x = 1;'); expect(posts).toBe(0);
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(first.locator('summary .katex')).toBeVisible();
      await panel.screenshot({ path: info.outputPath(`knowledge-${width}-${colorScheme}.png`) });
    }
  }
  await first.getByRole('button', { name: '追问这个知识点', exact: true }).click();
  expect(await page.getByLabel('继续问这道题', { exact: true }).inputValue()).toContain(name);
  await page.getByRole('button', { name: '发送同题追问', exact: true }).click(); await expect.poll(() => posts).toBe(1);
  const raw = await page.evaluate(async id => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('solveflow-local', 1); r.onsuccess = () => resolve(r.result); });
    const raw = await new Promise<unknown>(resolve => { const r = db.transaction('documents').objectStore('documents').get(`record.${id}`); r.onsuccess = () => resolve(r.result); }); db.close();
    if (typeof raw !== 'string') throw new Error('NO_SAVED_RECORD'); return raw;
  }, id);
  const data: unknown = JSON.parse(raw); const stored = StoredLocalRecordSchema.safeParse(data);
  const saved = stored.success ? stored.data : LocalRecordSchema.parse(data); const original = saved.session.runs[0]?.outcome;
  expect(original?.status).toBe('completed');
  if (original?.status !== 'completed') throw new Error('SOURCE_ANSWER_LOST');
  expect(original.candidate.knowledgePoints).toEqual([name, other, ...controls]);
});
