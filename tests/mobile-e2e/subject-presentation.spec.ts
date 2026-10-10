import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { chooseSyntheticPhoto, configureLocalModel, lastModelInput, modelSse } from './local-fixture.js';

async function waitForReading(page: Page) {
  await expect(page.getByRole('img', { name: 'SolveFlow 应用图标', exact: true })).toHaveCount(0);
  await expect(page.getByText('排版中…', { exact: true })).toHaveCount(0);
  await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
}

const base = { schemaVersion: 1, kind: 'answer', problem: { text: 'Explain your answer.', subject: 'general', uncertainties: [] }, answer: '', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
const essay = 'A library offers more than access to books. It gives people a shared place to study, discuss ideas and seek reliable information. This public role matters even when many texts are available online.\n\nDigital services can widen access, especially for readers who cannot travel. Yet access to a device does not ensure a quiet place to learn or help in judging a source. Libraries can provide both, while lending digital materials as well as printed books.\n\nA reasonable objection is that public funds have competing uses. Libraries should therefore demonstrate whom their services reach and adapt to local needs. Combining physical spaces with accessible digital services offers a stronger response than treating the two as substitutes.';
test('separates composition, review and revision while preserving the complete draft', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const bodies: unknown[] = [];
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    const body: unknown = route.request().postDataJSON(); bodies.push(body);
    const review = bodies.length === 2;
    const candidate = { ...base, problem: { ...base.problem, exam: 'tara', module: 'Writing Task', subject: 'english', response: review ? { type: 'short-answer' } : { type: 'essay', wordLimit: 750 } },
      answer: review ? '最后一段回应了预算方面的反对意见。可以说明如何衡量服务的实际作用。' : essay,
      writing: { mode: review ? 'feedback' : bodies.length === 1 ? 'composition' : 'revision', title: review ? '结构与论证' : 'Libraries in a Digital Age', ...(bodies.length === 3 ? { feedback: [{ paragraph: 3, comment: '保留反对意见，并明确评估服务的方向。' }] } : {}) },
    };
    await route.fulfill({ contentType: 'text/event-stream', body: modelSse(candidate, body) });
  });
  await page.goto('/'); await configureLocalModel(page); await chooseSyntheticPhoto(page);
  await page.getByRole('button', { name: '开始解题', exact: true }).click();
  const article = page.getByRole('article', { name: '作文正文', exact: true });
  await expect(article).toBeVisible(); await expect(article.locator('p')).toHaveCount(3);
  await expect(page.getByRole('heading', { name: '参考作文', exact: true })).toBeVisible();
  await page.getByLabel('继续问这道题', { exact: true }).fill('点评最后一段，不要重写');
  await page.getByRole('button', { name: '发送同题追问', exact: true }).click();
  await expect(page.getByRole('article', { name: '写作点评', exact: true })).toBeVisible();
  await page.getByLabel('继续问这道题', { exact: true }).fill('按点评给出完整修改稿，并说明第三段改动');
  await page.getByRole('button', { name: '发送同题追问', exact: true }).click();
  await expect(page.getByRole('heading', { name: '修改稿', exact: true })).toBeVisible();
  expect(lastModelInput(bodies[2])).toMatchObject({ focus: { writing: { mode: 'feedback' }, draft: { answer: essay } } });
  await page.getByText('段落点评 · 1', { exact: true }).click();
  await expect(page.getByText('第 3 段', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '修改稿', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await mkdir('.runtime/subject-presentation-2026-10-04', { recursive: true });
  await waitForReading(page);
  await page.getByRole('article', { name: '作文正文', exact: true }).screenshot({ path: `.runtime/subject-presentation-2026-10-04/writing-${info.project.name}.png` });
  expect(errors).toEqual([]);
});

test('renders chemical notation and checked economic relationships on a narrow screen', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let calls = 0;
  const term = (formula: string, coefficient: number, charge = 0) => ({ formula, coefficient, charge });
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    calls++; const body: unknown = route.request().postDataJSON();
    const candidate = calls === 1 ? { ...base, answer: '铁离子得到一个电子，转化为亚铁离子。', problem: { ...base.problem, subject: 'chemistry' }, chemistry: { reactions: [{ reactants: [term('Fe', 1, 3), term('e', 1, -1)], products: [term('Fe', 1, 2)], arrow: 'equilibrium' }] } }
      : { ...base, answer: '均衡为 Q=5、P=5；消费者剩余为 12.5。', problem: { ...base.problem, subject: 'economics', response: { type: 'drawing' } }, figures: [{ schemaVersion: 1, id: 'market', kind: 'coordinate', title: '供需均衡与消费者剩余', description: '需求 P=10−Q，供给 P=Q；阴影表示消费者剩余。', purpose: 'economics', xRange: [0, 10], yRange: [0, 11], xLabel: 'Q (units)', yLabel: 'P ($/unit)', equalAspect: false,
        elements: [{ id: 'd', kind: 'polynomial', coefficients: [10, -1], label: '需求 D', color: 'blue' }, { id: 's', kind: 'polynomial', coefficients: [0, 1], label: '供给 S', color: 'green' }, { id: 'e', kind: 'point', at: [5, 5], label: 'E', color: 'orange' }, { id: 'cs', kind: 'polygon', points: [[0, 5], [0, 10], [5, 5]], label: '消费者剩余', color: 'blue' }, { kind: 'segment', from: [5, 0], to: [5, 5], lineStyle: 'dashed', color: 'gray' }, { kind: 'segment', from: [6, 7], to: [8, 7], arrow: true, label: '数量增加方向', color: 'gray' }],
        checks: [{ kind: 'intersection', pointId: 'e', curveIds: ['d', 's'] }, { kind: 'polygon-area', polygonId: 'cs', expected: 12.5 }],
      }] };
    await route.fulfill({ contentType: 'text/event-stream', body: modelSse(candidate, body) });
  });
  await page.goto('/'); await configureLocalModel(page); await chooseSyntheticPhoto(page);
  await page.getByRole('button', { name: '开始解题', exact: true }).click();
  const reaction = page.getByRole('region', { name: '化学反应式', exact: true });
  await expect(reaction.locator('.katex')).toHaveCount(1);
  await expect(reaction.getByText(/原子与电荷守恒/)).toBeVisible();
  await expect(page.getByRole('button', { name: '校验', exact: true })).toBeVisible();
  await mkdir('.runtime/subject-presentation-2026-10-04', { recursive: true });
  await waitForReading(page);
  await reaction.screenshot({ path: `.runtime/subject-presentation-2026-10-04/chemistry-${info.project.name}.png` });
  await page.getByLabel('继续问这道题', { exact: true }).fill('再说明供需图');
  await page.getByRole('button', { name: '发送同题追问', exact: true }).click();
  await expect(page.getByText(/已检查图中声明的 2 项数值关系/)).toBeVisible();
  await expect(page.locator('.answer-figure line[stroke-dasharray]')).toHaveCount(1);
  await expect(page.locator('.answer-figure line[marker-end]')).toHaveCount(1);
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await waitForReading(page);
  await page.locator('.answer-figure').screenshot({ path: `.runtime/subject-presentation-2026-10-04/economics-${info.project.name}.png` });
  expect(errors).toEqual([]);
});
