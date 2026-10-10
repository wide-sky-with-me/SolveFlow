import { expect, test } from '@playwright/test';
import { chooseSyntheticPhoto, configureLocalModel, lastModelInput, modelSse } from './local-fixture.js';

const base = { schemaVersion: 1, kind: 'answer', problem: { text: 'Write an essay using both pages.', subject: 'english', uncertainties: [] }, answer: '', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
test('saves extra pages without a model call and keeps a complete essay in follow-up', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const bodies: unknown[] = [];
  const essay = Array(650).fill('Evidence').join(' ') + ' FINAL_PARAGRAPH';
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    const body: unknown = route.request().postDataJSON(); bodies.push(body);
    await route.fulfill({ contentType: 'text/event-stream', body: modelSse(bodies.length === 1 ? { ...base, problem: { ...base.problem, response: { type: 'essay', wordLimit: 750 } }, answer: essay } : { ...base, answer: '已核对最后一段。' }, body) });
  });
  await page.goto('/'); await configureLocalModel(page);
  await chooseSyntheticPhoto(page);
  await page.getByRole('button', { name: '先保存题图以补充材料', exact: true }).click();
  await page.getByRole('button', { name: '同题材料 / 补图', exact: true }).click();
  const buffer = await page.screenshot({ type: 'jpeg' });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '从相册补图', exact: true }).click();
  await (await chooser).setFiles({ name: 'second-page.jpg', mimeType: 'image/jpeg', buffer });
  await page.getByRole('button', { name: '使用这张题图', exact: true }).click();
  await expect(page.getByRole('button', { name: '查看材料 1', exact: true })).toBeVisible();
  expect(bodies).toHaveLength(0);
  await page.getByRole('button', { name: '返回题目', exact: true }).click();
  await page.getByRole('button', { name: '开始解题', exact: true }).click();
  await expect(page.getByText('参考词数：651 / 750（按空白分词）', { exact: true })).toBeVisible();
  expect(lastModelInput(bodies[0])).toMatchObject({ materialOrder: [expect.any(String)] });
  expect(JSON.stringify(bodies[0]).match(/"type":"image_url"/g)).toHaveLength(2);
  const message = '请逐段点评。' + Array(500).fill('Paragraph').join(' ') + ' END_OF_DRAFT';
  await page.getByLabel('继续问这道题', { exact: true }).fill(message);
  await expect(page.getByLabel('继续问这道题', { exact: true })).toHaveValue(message);
  await page.getByRole('button', { name: '发送同题追问', exact: true }).click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(lastModelInput(bodies[1])).toMatchObject({ message, focus: { answer: essay } });
  await expect(page.getByText('已核对最后一段。', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '同题材料 / 补图', exact: true }).click();
  await expect(page.getByRole('button', { name: '查看材料 1', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});

test('shows all required FRQ parts and a numeric entry separately from the explanation', async ({ page }) => {
  let calls = 0;
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    calls++;
    const body: unknown = route.request().postDataJSON();
    const candidate = calls === 1 ? { ...base, problem: { ...base.problem, response: { type: 'multipart', parts: ['(a)', '(b)'] } }, answer: '分小问作答如下。', parts: [{ label: '(a)', answer: '第一问的必要列式。' }, { label: '(b)', answer: '第二问的证据与理由。' }] } : { ...base, problem: { ...base.problem, response: { type: 'numeric', numericFormat: 'sat-spr' } }, responseValue: '2/3', answer: '保留精确分数。' };
    await route.fulfill({ contentType: 'text/event-stream', body: modelSse(candidate, body) });
  });
  await page.goto('/'); await configureLocalModel(page); await chooseSyntheticPhoto(page);
  await page.getByRole('button', { name: '开始解题', exact: true }).click();
  await expect(page.getByText('第二问的证据与理由。', { exact: true })).toBeVisible();
  await page.getByLabel('继续问这道题', { exact: true }).fill('给出可填写的数值');
  await page.getByRole('button', { name: '发送同题追问', exact: true }).click();
  await expect(page.getByText('可填答案：2/3', { exact: true })).toBeVisible();
});
