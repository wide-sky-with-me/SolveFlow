import { expect, test, type Page } from '@playwright/test';
import { chooseSyntheticPhoto, configureLocalModel, lastModelInput, modelPass, modelSse } from './local-fixture.js';

async function configureBackup(page: Page) {
  await configureLocalModel(page);
  await page.getByRole('tab', { name: '我的', exact: true }).click(); await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('switch', { name: '启用备用解题模型', exact: true }).click();
  await expect(page.getByLabel('备用模型引用名', { exact: true })).toHaveValue('gpt-6-sol');
  await expect(page.getByTestId('settings-backup').getByRole('button', { name: 'Responses', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('备用服务地址', { exact: true }).fill('https://fixture-backup.invalid/v1');
  await page.getByLabel('备用供应商标识', { exact: true }).fill('fixture');
  await page.getByLabel('备用模型引用名', { exact: true }).fill('fixture-stronger');
  await page.getByLabel('备用API Key', { exact: true }).fill('synthetic-backup-secret');
  await page.getByTestId('settings-backup').getByRole('button', { name: 'Chat Completions', exact: true }).click();
  await page.getByTestId('settings-backup').getByRole('button', { name: '服务默认', exact: true }).click();
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); await page.getByRole('tab', { name: '题目', exact: true }).click();
}
const candidate = { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };

test('the verifier Sol preset changes only its configuration without making model requests', async ({ page }) => {
  let calls = 0; await page.route(/https:\/\/(?:api\.openai\.com|fixture-model\.invalid)\//, route => { calls++; return route.abort(); });
  await page.goto('/'); await configureLocalModel(page); await page.getByRole('tab', { name: '我的', exact: true }).click(); await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('switch', { name: '使用独立校验模型', exact: true }).click();
  await page.getByRole('button', { name: '使用 GPT-6 Sol 预设', exact: true }).click();
  await expect(page.getByLabel('校验模型引用名', { exact: true })).toHaveValue('gpt-6-sol');
  await expect(page.getByLabel('校验服务地址', { exact: true })).toHaveValue('https://api.openai.com/v1');
  await expect(page.getByTestId('settings-verifier').getByRole('button', { name: 'Responses', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('settings-verifier').getByRole('button', { name: '低', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const verifier = page.getByTestId('settings-verifier');
  await verifier.getByRole('button', { name: '校验高级参数', exact: true }).click();
  await expect(verifier.getByRole('button', { name: '非流式', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await verifier.getByRole('button', { name: '流式', exact: true }).click();
  await page.getByLabel('校验API Key', { exact: true }).fill('synthetic-verifier-secret');
  await expect(page.getByLabel('解题模型引用名', { exact: true })).toHaveValue('fixture-user-model');
  await page.getByRole('button', { name: '保存设置', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload(); await page.getByRole('tab', { name: '我的', exact: true }).click(); await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByTestId('settings-verifier').getByRole('button', { name: '校验高级参数', exact: true }).click();
  await expect(page.getByTestId('settings-verifier').getByRole('button', { name: '流式', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(calls).toBe(0);
});

test('third-profile recovery produces a checked answer and reload never replays the paid path', async ({ page }) => {
  let primary = 0; let backup = 0; let checks = 0;
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    const input = lastModelInput(route.request().postDataJSON());
    if (typeof input === 'object' && input !== null && 'role' in input && input.role === 'verifier') { checks++; await route.fulfill({ contentType: 'text/event-stream', body: modelSse(modelPass) }); }
    else { primary++; await route.fulfill({ status: 503, body: '{}' }); }
  });
  await page.route('https://fixture-backup.invalid/v1/chat/completions', async route => { backup++; await route.fulfill({ contentType: 'text/event-stream', body: modelSse(candidate, route.request().postDataJSON()) }); });
  await page.goto('/'); await configureBackup(page); await chooseSyntheticPhoto(page);
  await page.getByRole('button', { name: '开始解题', exact: true }).click();
  await expect(page.getByText('模型独立校验通过', { exact: true })).toBeVisible();
  expect([primary, backup, checks]).toEqual([2, 1, 1]);
  await page.reload(); await expect(page.getByText('模型独立校验通过', { exact: true })).toBeVisible();
  expect([primary, backup, checks]).toEqual([2, 1, 1]);
  await page.getByRole('tab', { name: '我的', exact: true }).click(); await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByLabel('备用模型引用名', { exact: true })).toHaveValue('fixture-stronger');
  await expect(page.getByLabel('备用API Key', { exact: true })).toHaveValue('');
});

test('a manual failed check automatically regenerates with backup and retains the original answer version', async ({ page }) => {
  let primary = 0; let backup = 0; let checks = 0;
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    const input = lastModelInput(route.request().postDataJSON());
    const verifier = typeof input === 'object' && input !== null && 'role' in input && input.role === 'verifier';
    if (verifier) checks++; else primary++;
    await route.fulfill({ contentType: 'text/event-stream', body: modelSse(verifier ? checks === 1 ? { ...modelPass, verdict: 'fail', issues: [{ code: 'ARITHMETIC', message: '移项错误' }] } : modelPass : { ...candidate, answer: 'x=3' }, route.request().postDataJSON()) });
  });
  await page.route('https://fixture-backup.invalid/v1/chat/completions', async route => { backup++; await route.fulfill({ contentType: 'text/event-stream', body: modelSse(candidate, route.request().postDataJSON()) }); });
  await page.goto('/'); await configureBackup(page); await chooseSyntheticPhoto(page); await page.getByRole('button', { name: '开始解题', exact: true }).click();
  await expect(page.getByText('未校验', { exact: true })).toBeVisible(); expect(backup).toBe(0);
  await page.getByRole('button', { name: '校验', exact: true }).click();
  await expect(page.getByText('模型独立校验通过', { exact: true })).toBeVisible();
  expect([primary, backup, checks]).toEqual([1, 1, 2]);
  await page.getByRole('button', { name: '历史解答', exact: true }).click(); await page.getByRole('radio', { name: '第1次解答', exact: true }).click();
  await expect(page.getByText('x=3', { exact: true })).toBeVisible();
});
