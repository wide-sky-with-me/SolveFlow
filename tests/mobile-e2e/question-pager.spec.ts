import { test, expect, type Locator } from '@playwright/test';
import { SessionViewSchema } from '../../packages/contracts/src/http.js';
import { seedLocalSession, configureLocalModel } from './local-fixture.js';

async function swipe(target: Locator, dx: number, dy = 4) {
  await target.evaluate((node, delta) => {
    const rect = node.getBoundingClientRect(); const x = rect.x + rect.width / 2, y = rect.y + 20;
    const touch = (clientX: number, clientY: number) => new Touch({ identifier: 1, target: node, clientX, clientY });
    node.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [touch(x, y)], changedTouches: [touch(x, y)] }));
    node.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [touch(x + delta.dx, y + delta.dy)] }));
  }, { dx, dy });
}
test('four question pages isolate drafts, use the requested gestures and protect figure pans', async ({ page }, info) => {
  // A paused font-ready promise must not block an otherwise committed answer.
  await page.addInitScript(() => { Object.defineProperty(document.fonts, 'ready', { get: () => new Promise(() => {}) }); });
  const id = '70000000-0000-4000-8000-000000000001'; const now = new Date().toISOString(); const image = await page.screenshot({ type: 'jpeg' });
  const figures = [{ schemaVersion: 1, id: 'curve', kind: 'coordinate', title: '曲线与邻近标注', description: '抛物线与直线相交，端点标签不能裁切。', xRange: [-.2, 2.2], yRange: [-.2, 4.2], equalAspect: false, elements: [{ kind: 'point', at: [2, 4], label: 'A' }, { kind: 'point', at: [1.99, 3.96], label: 'B' }, { kind: 'polynomial', coefficients: [0, 0, 1], label: 'y=x²' }, { kind: 'segment', from: [0, 0], to: [2, 4], label: '弦' }] }];
  const session = SessionViewSchema.parse({ schemaVersion: 1, id, subject: 'math', createdAt: now, upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: image.length, width: 390, height: 844, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` }, runs: [{ schemaVersion: 1, id, sessionId: id, createdAt: now, seq: 1, status: 'completed', message: '', outcome: { schemaVersion: 1, status: 'completed', verified: true, warning: null, verification: { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'diagram'], issues: [] }, candidate: { schemaVersion: 1, kind: 'answer', problem: { text: '四题', subject: 'math', uncertainties: [] }, answer: '逐题解答', steps: [1, 2, 3, 4].map(n => ({ id: `s${n}`, title: `代入第${n}题`, explanation: '核对条件再求值' })), questions: [1, 2, 3, 4].map(n => ({ number: n, problem: { text: `第${n}道自编题：计算 $x^2$。`, subject: 'math', uncertainties: [] }, answer: `第${n}道答案`, stepIds: [`s${n}`], figureIds: n === 2 ? ['curve'] : [] })), figures, knowledgePoints: [], citationIds: [], clarificationQuestions: [] } } }] });
  session.runs.unshift({ schemaVersion: 1, id: '70000000-0000-4000-8000-000000000002', sessionId: id, createdAt: now, seq: 1, status: 'needs_clarification', message: '识别时的补充', outcome: { schemaVersion: 1, status: 'needs_clarification', verified: false, candidate: { schemaVersion: 1, kind: 'clarification', problem: { text: '请指定题号', subject: 'math', uncertainties: [] }, answer: null, steps: [], knowledgePoints: [], clarificationQuestions: ['需要解答哪些题？'], citationIds: [] } } });
  await seedLocalSession(page, SessionViewSchema.parse(session), image); await configureLocalModel(page); await expect(page.getByTestId('launch-screen')).toHaveCount(0);
  const selector = (n: number) => page.getByRole('tab', { name: `跳转第${n}题`, exact: true });
  const current = () => page.getByRole('region', { name: /^第[1-4]题解答$/ });
  await expect(current()).toHaveCount(1); await expect(page.getByText('1/4', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: '上一道题', exact: true })).toBeDisabled();
  await page.getByLabel('继续问第1题', { exact: true }).fill('保留第一题草稿');
  await selector(4).click(); await expect(current()).toHaveAttribute('aria-label', '第4题解答'); await expect(page.getByRole('button', { name: '下一道题', exact: true })).toBeDisabled();
  await selector(1).click(); await page.waitForTimeout(11000);
  await expect(page.getByText('图文解答加载失败', { exact: false })).toHaveCount(0);
  await expect(page.getByLabel('继续问第1题', { exact: true })).toHaveValue('保留第一题草稿');
  await swipe(current().locator('.problem-text'), 110); await expect(selector(2)).toHaveAttribute('aria-selected', 'true');
  await expect(current()).toHaveCount(1); await expect(current().locator('.step-details')).not.toHaveAttribute('open', '');
  await expect(current().locator('.final-answer .figure-grid')).toContainText('0.5');
  const bounds = await current().locator('.final-answer .figure-labels rect').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; }));
  expect(bounds).toHaveLength(2); const [a, b] = bounds; expect(a!.right <= b!.x || b!.right <= a!.x || a!.bottom <= b!.y || b!.bottom <= a!.y).toBe(true);
  const lastLayer = current().locator('.final-answer .answer-figure svg > g').last(); await expect(lastLayer).toHaveClass('figure-labels');
  await current().getByRole('button', { name: '放大图示', exact: true }).first().click();
  await swipe(current().locator('.final-answer .figure-viewport'), 120); await expect(selector(2)).toHaveAttribute('aria-selected', 'true');
  await swipe(current().locator('.problem-text'), 20, 150); await expect(selector(2)).toHaveAttribute('aria-selected', 'true');
  await page.waitForTimeout(350); await swipe(current().locator('.problem-text .math-inline'), 110); await expect(selector(2)).toHaveAttribute('aria-selected', 'true');
  await page.waitForTimeout(350); await swipe(current().locator('.problem-text'), -110); await expect(selector(1)).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: '补充记录', exact: true }).click(); await expect(page.getByText('需要解答哪些题？', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: '下一道题', exact: true })).toBeDisabled();
  await selector(3).focus(); await page.keyboard.press('Enter'); await expect(selector(3)).toHaveAttribute('aria-selected', 'true');
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' }); await selector(2).click();
  await current().getByRole('button', { name: '适应宽度', exact: true }).first().click(); await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `.runtime/screenshots/${info.project.name}-question-pager.png` });
});
