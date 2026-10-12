import { expect, test } from '@playwright/test';
import { ReadableLocalRecordSchema } from '../../packages/contracts/src/local.js';
import { SessionViewSchema } from '../../packages/contracts/src/http.js';
import { chooseSyntheticPhoto, configureLocalModel, modelSse, seedLocalSession } from './local-fixture.js';

test('header exam picker works before configuration, cancels and persists into settings', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The header exam control is a wide-screen Web entry.');
  let requests = 0;
  await page.route('https://fixture-model.invalid/**', route => { requests++; return route.abort(); });
  await page.goto('/');
  const chip = page.getByTestId('desktop-exam');
  await expect(chip).toHaveAccessibleName('选择默认考试：未指定');
  expect((await chip.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await chip.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: '未指定', exact: true })).toHaveAttribute('aria-pressed', 'true');
  for (const name of ['SAT', 'ACT', 'AP', 'ESAT', 'TMUA', 'TARA', '未指定']) await expect(dialog.getByRole('button', { name, exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(chip).toHaveAccessibleName('选择默认考试：未指定');
  await chip.click(); await dialog.getByRole('button', { name: 'ACT', exact: true }).click();
  await expect(chip).toHaveAccessibleName('选择默认考试：ACT');
  await page.reload(); await expect(chip).toHaveAccessibleName('选择默认考试：ACT');
  await configureLocalModel(page);
  await expect(chip).toHaveAccessibleName('选择默认考试：ACT');
  await page.emulateMedia({ colorScheme: 'dark' }); await chip.click();
  await expect(dialog.getByRole('button', { name: 'ACT', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: testInfo.outputPath('quick-exam-dark.png') });
  await dialog.getByRole('button', { name: 'ESAT', exact: true }).click();
  await expect(chip).toHaveAccessibleName('选择默认考试：ESAT');
  await page.getByRole('tab', { name: '我的', exact: true }).click(); await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('button', { name: 'ESAT', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(requests).toBe(0);
});

test('environment quick exam preserves old snapshots, applies to new questions and locks during solving', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The header exam control is a wide-screen Web entry.');
  const profile = { provider: 'fixture', baseURL: 'https://fixture-env.invalid/v1', model: 'solver', api: 'openai-completions', contextWindow: 32768, maxTokens: 8192, maxTokensField: 'max_tokens' };
  await page.route('**/__solveflow/web-env', route => route.fulfill({ json: { schemaVersion: 1, settings: { schemaVersion: 1, solver: profile, verifier: null, concurrency: { solver: 6, verifier: 4 } }, accessTokens: { solver: 'synthetic-token', verifier: null, backup: null } } }));
  const id = '85200000-0000-4000-8000-000000000001'; const now = new Date().toISOString();
  const candidate = { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
  const session = SessionViewSchema.parse({ schemaVersion: 1, id, subject: 'math', createdAt: now,
    upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: 100, width: 390, height: 844, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` },
    runs: [{ schemaVersion: 1, id, sessionId: id, status: 'completed', message: '', seq: 1, createdAt: now, outcome: { schemaVersion: 1, status: 'completed', verified: false, verification: null, warning: null, verificationStatus: 'not_requested', candidate } }] });
  await seedLocalSession(page, session, await page.screenshot({ type: 'jpeg' }));
  await page.evaluate(async id => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('solveflow-local', 1); request.onsuccess = () => resolve(request.result); request.onerror = reject; });
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('documents', 'readwrite'); const store = tx.objectStore('documents'); const request = store.get(`record.${id}`); request.onsuccess = () => store.put(JSON.stringify({ ...JSON.parse(request.result), exam: 'tmua' }), `record.${id}`); tx.oncomplete = () => resolve(); tx.onabort = reject; }); db.close();
  }, id);
  const chip = page.getByTestId('desktop-exam');
  await chip.click(); await page.getByRole('dialog').getByRole('button', { name: 'ESAT', exact: true }).click();
  await expect(chip).toHaveAccessibleName('选择默认考试：ESAT');
  let calls = 0; let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/__solveflow/web-env/model/solver', async route => { calls++; await gate; await route.fulfill({ contentType: 'text/event-stream', body: modelSse(candidate, route.request().postDataJSON()) }); });
  try {
    await page.goto('/'); await expect(chip).toHaveAccessibleName('选择默认考试：ESAT');
    await page.getByRole('button', { name: '拍照', exact: true }).click();
    await chooseSyntheticPhoto(page); await page.getByRole('button', { name: '开始解题', exact: true }).click();
    await expect.poll(() => calls).toBe(1); await expect(chip).toBeDisabled();
    release(); await expect(page.locator('.final-answer')).toContainText('x=2'); await expect(chip).toBeEnabled();
    const stored = await page.evaluate(() => new Promise<{ records: string[]; preference: string }>((resolve, reject) => {
      const request = indexedDB.open('solveflow-local', 1); request.onerror = () => reject(request.error);
      request.onsuccess = () => { const db = request.result; const tx = db.transaction('documents'); const store = tx.objectStore('documents'); const all = store.getAll(); const pref = store.get('web-environment-preferences');
        tx.oncomplete = () => { db.close(); resolve({ records: all.result.filter((value: unknown): value is string => typeof value === 'string' && value.includes('"session"')), preference: String(pref.result) }); }; tx.onabort = () => { db.close(); reject(tx.error); }; };
    }));
    const records = stored.records.map(raw => ReadableLocalRecordSchema.parse(JSON.parse(raw)));
    expect(records.find(record => record.session.id === id)?.exam).toBe('tmua');
    expect(records.find(record => record.session.id !== id)?.exam).toBe('esat');
    expect(JSON.parse(stored.preference)).toEqual({ exam: 'esat', concurrency: { solver: 6, verifier: 4 } });
    await page.reload(); await expect(chip).toHaveAccessibleName('选择默认考试：ESAT'); expect(calls).toBe(1);
    await page.screenshot({ path: testInfo.outputPath('quick-exam-light.png') });
  } finally { release(); }
});
