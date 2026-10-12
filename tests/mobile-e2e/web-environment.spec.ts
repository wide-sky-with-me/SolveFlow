import { expect, test } from '@playwright/test';
import { chooseSyntheticPhoto, modelPass, modelSse } from './local-fixture.js';
const profile = { provider: 'fixture', baseURL: 'https://fixture-env.invalid/v1', model: 'primary', api: 'openai-completions', contextWindow: 32768, maxTokens: 8192, maxTokensField: 'max_tokens' };
test.use({ launchOptions: { executablePath: process.env.SOLVEFLOW_TEST_CHROME ?? '/usr/bin/google-chrome', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });
test('environment role requests survive token rotation without reload and reload never replays', async ({ page }) => {
  const accessTokens = { solver: 'synthetic-solver-token', verifier: 'synthetic-verifier-token', backup: 'synthetic-backup-token' };
  let activeTokens = accessTokens;
  await page.route('**/__solveflow/web-env', route => route.fulfill({ json: { schemaVersion: 1, settings: { schemaVersion: 1, solver: profile, verifier: { ...profile, model: 'check' }, backup: { ...profile, model: 'backup' } }, accessTokens: activeTokens } }));
  let external = 0; let localRejections = 0; const calls: string[] = [];
  await page.route('https://fixture-env.invalid/**', route => { external++; return route.abort(); });
  await page.route('**/__solveflow/web-env/model/*', async route => {
    const role = new URL(route.request().url()).pathname.split('/').at(-1);
    if (!role || !(role in accessTokens)) throw new Error('INVALID_ROLE');
    const token = role === 'solver' ? activeTokens.solver : role === 'verifier' ? activeTokens.verifier : activeTokens.backup;
    if (route.request().headers().authorization !== `Bearer ${token}`) {
      localRejections++;
      await route.fulfill({ status: 401, headers: { 'x-solveflow-model-dispatch': 'not-started' }, body: '{}' }); return;
    }
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`); calls.push(role);
    if (role === 'solver') { await route.fulfill({ status: 503, body: '{}' }); return; }
    await route.fulfill({ contentType: 'text/event-stream', body: modelSse(role === 'verifier' ? modelPass : { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] }, route.request().postDataJSON()) });
  });
  await page.goto('/'); await chooseSyntheticPhoto(page);
  activeTokens = { solver: 'rotated-solver-token', verifier: 'rotated-verifier-token', backup: 'rotated-backup-token' };
  await page.getByRole('button', { name: '开始解题', exact: true }).click();
  await expect(page.getByRole('button', { name: '校验通过', exact: true })).toBeVisible(); expect(calls).toEqual(['solver', 'solver', 'backup', 'verifier']); expect(localRejections).toBe(1); expect(external).toBe(0);
  await page.getByRole('tab', { name: '我的', exact: true }).click(); await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByLabel('解题模型引用名', { exact: true })).not.toBeEditable(); await expect(page.getByLabel('解题API Key', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('答题并发', { exact: true })).toHaveValue('8'); await expect(page.getByLabel('校验并发', { exact: true })).toHaveValue('8');
  await page.getByLabel('答题并发', { exact: true }).fill('6'); await page.getByLabel('校验并发', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'ESAT', exact: true }).click(); await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.reload(); await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('button', { name: 'ESAT', exact: true })).toHaveAttribute('aria-pressed', 'true'); expect(calls).toHaveLength(4);
  await expect(page.getByLabel('答题并发', { exact: true })).toHaveValue('6'); await expect(page.getByLabel('校验并发', { exact: true })).toHaveValue('4');
  const stored = await page.evaluate(() => new Promise<string>((resolve, reject) => { const request = indexedDB.open('solveflow-local', 1); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result; const tx = db.transaction('documents'); const get = tx.objectStore('documents').getAll(); tx.oncomplete = () => { db.close(); resolve(JSON.stringify(get.result)); }; tx.onabort = () => { db.close(); reject(tx.error); }; }; }));
  expect(stored).not.toContain('synthetic-solver-token'); expect(stored).not.toContain('synthetic-backup-token'); expect(stored).not.toContain('rotated-solver-token'); expect(stored).not.toContain('rotated-backup-token');
});

test('batch correction gets a fresh bounded verification phase and publishes the corrected answer before it completes', async ({ page }) => {
  const accessTokens = { solver: 'synthetic-solver-token', verifier: 'synthetic-verifier-token', backup: 'synthetic-backup-token' };
  await page.route('**/__solveflow/web-env', route => route.fulfill({ json: { schemaVersion: 1, settings: { schemaVersion: 1, solver: profile, verifier: { ...profile, model: 'check' }, backup: { ...profile, model: 'backup' } }, accessTokens } }));
  let checks = 0; let solves = 0; let backups = 0; let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const candidate = { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
  await page.route('**/__solveflow/web-env/model/*', async route => {
    const role = new URL(route.request().url()).pathname.split('/').at(-1);
    if (role === 'verifier') {
      checks++;
      if (checks === 1) { await route.fulfill({ status: 503, body: '{}' }); return; }
      if (checks === 3) await gate;
      await route.fulfill({ contentType: 'text/event-stream', body: modelSse(checks === 2 ? { ...modelPass, verdict: 'fail', issues: [{ code: 'ARITHMETIC', message: '移项错误' }] } : modelPass) }); return;
    }
    if (role === 'solver') solves++; else if (role === 'backup') backups++; else throw new Error('INVALID_ROLE');
    await route.fulfill({ contentType: 'text/event-stream', body: modelSse(role === 'solver' ? { ...candidate, answer: 'x=3' } : candidate, route.request().postDataJSON()) });
  });
  try {
    await page.goto('/'); await expect(page.getByRole('button', { name: '拍照', exact: true })).toBeVisible();
    const buffer = await page.screenshot({ type: 'jpeg' });
    await page.getByRole('button', { name: '拍照', exact: true }).click(); await page.getByRole('button', { name: '批量解题', exact: true }).click();
    await page.getByRole('button', { name: '允许使用相机' }).evaluateAll(nodes => { for (const node of nodes) if (node instanceof HTMLElement) node.click(); });
    const chooser = page.waitForEvent('filechooser'); await page.getByRole('dialog').getByRole('button', { name: '从相册选择', exact: true }).click();
    await (await chooser).setFiles({ name: 'synthetic-batch.jpg', mimeType: 'image/jpeg', buffer });
    await page.getByRole('button', { name: '导入并解题（1张）', exact: true }).click();
    await expect.poll(() => checks).toBe(3); await page.getByRole('button', { name: '完成拍摄', exact: true }).click();
    await expect(page.locator('.final-answer').filter({ visible: true })).toContainText('x=2');
    await expect(page.getByRole('tab', { name: '跳转第1题', exact: true })).toHaveCSS('background-color', 'rgb(255, 237, 213)');
    release(); await expect(page.getByRole('button', { name: '校验通过', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: '跳转第1题', exact: true })).toHaveCSS('background-color', 'rgb(220, 252, 231)');
    expect([solves, backups, checks]).toEqual([1, 1, 3]);
    await page.reload(); await expect(page.locator('.final-answer').filter({ visible: true })).toContainText('x=2');
    await expect(page.getByRole('button', { name: '校验通过', exact: true })).toBeVisible(); expect([solves, backups, checks]).toEqual([1, 1, 3]);
  } finally { release(); }
});
