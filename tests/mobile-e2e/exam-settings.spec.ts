import { test, expect, type Page } from '@playwright/test';
import { chooseSyntheticPhoto } from './local-fixture.js';

const candidate = { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3，求x', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
function responseSse() {
  const item = { type: 'message', id: 'msg_fixture', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(candidate), annotations: [] }] };
  return [{ type: 'response.created', response: { id: 'resp_fixture' } }, { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } }, { type: 'response.output_item.done', output_index: 0, item }, { type: 'response.completed', response: { id: 'resp_fixture', status: 'completed', output: [item], usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 } } }].map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
}
async function openSettings(page: Page) { await page.getByRole('tab', { name: '我的', exact: true }).click(); await page.getByRole('button', { name: '设置', exact: true }).click(); }
test('initial exam choice persists, new photos use it and old questions retain their exam after a settings change', async ({ page }) => {
  const bodies: unknown[] = [];
  await page.route('https://fixture-model.invalid/v1/responses', async route => { bodies.push(route.request().postDataJSON()); await route.fulfill({ contentType: 'text/event-stream', body: responseSse() }); });
  await page.goto('/'); await page.getByRole('button', { name: '配置模型与考试类型', exact: true }).click();
  await page.getByRole('button', { name: 'SAT', exact: true }).click();
  await page.getByLabel('解题服务地址', { exact: true }).fill('https://fixture-model.invalid/v1');
  await page.getByLabel('解题供应商标识', { exact: true }).fill('fixture-provider');
  await page.getByLabel('解题模型引用名', { exact: true }).fill('fixture-user-model');
  await page.getByLabel('解题API Key', { exact: true }).fill('synthetic-fixture-secret');
  await page.getByRole('button', { name: 'Responses', exact: true }).click();
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(page.getByTestId('current-exam')).toHaveCount(0);
  await chooseSyntheticPhoto(page); await page.getByRole('button', { name: '开始解题', exact: true }).click();
  await expect(page.getByText('未校验', { exact: true })).toBeVisible();
  await expect(page.getByTestId('current-exam')).toHaveText('本题考试：SAT');
  expect(bodies).toHaveLength(1); expect(JSON.stringify(bodies[0])).toContain('来源：/skills/exams/references/sat.md');
  await openSettings(page); await page.getByRole('button', { name: 'AP', exact: true }).click();
  await page.getByRole('button', { name: '保存设置', exact: true }).click(); await page.getByRole('tab', { name: '题目', exact: true }).click();
  await expect(page.getByTestId('current-exam')).toHaveText('本题考试：SAT');
  await page.getByLabel('继续问这道题', { exact: true }).fill('再解释一下'); await page.getByRole('button', { name: '发送同题追问', exact: true }).click();
  await expect.poll(() => bodies.length).toBe(2); expect(JSON.stringify(bodies[1])).toContain('来源：/skills/exams/references/sat.md');
  expect(JSON.stringify(bodies[1])).not.toContain('来源：/skills/exams/references/ap.md');
  await expect(page.getByRole('button', { name: '历史解答', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '拍照', exact: true }).click();
  await chooseSyntheticPhoto(page);
  await expect(page.getByTestId('current-exam')).toHaveText('新题默认考试：AP');
  await page.getByRole('button', { name: '开始解题', exact: true }).click();
  await expect(page.getByText('未校验', { exact: true })).toBeVisible(); expect(bodies).toHaveLength(3);
  expect(JSON.stringify(bodies[2])).toContain('来源：/skills/exams/references/ap.md');
  await page.reload(); await expect(page.getByTestId('current-exam')).toHaveText('本题考试：AP');
  await openSettings(page); await expect(page.getByRole('button', { name: 'AP', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Responses', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('解题API Key', { exact: true })).toHaveValue('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
