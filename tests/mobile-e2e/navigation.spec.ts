import { expect, test } from '@playwright/test';
import { SessionViewSchema } from '../../packages/contracts/src/http.js';
import { chooseSyntheticPhoto, configureLocalModel, modelPass, modelSse, seedLocalSession } from './local-fixture.js';

test('three-entry navigation opens camera directly and returns to its previous page', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.getByTestId('launch-screen')).toBeHidden();
  await expect(page.getByRole('button', { name: 'SolveFlow 首页' })).toHaveCount(0);
  const nav = page.getByRole('navigation', { name: '主导航' });
  await expect(nav.getByRole('tab')).toHaveCount(2);
  await expect(nav.getByRole('button')).toHaveCount(1);
  await nav.getByRole('tab', { name: '我的', exact: true }).click();
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible();
  await expect(page.getByText('题图与解答保存在本机')).toHaveCount(0);
  await expect(page.getByText('卸载应用或清除本地数据会删除题目记录。解题时，题图会发送至你配置的模型服务。')).toHaveCount(0);
  await nav.getByRole('button', { name: '拍照', exact: true }).click();
  await expect(page.getByText('拍摄题目', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭相机' }).click();
  await expect(nav.getByRole('tab', { name: '我的', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByLabel('解题服务地址', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: '查看历史题目' }).click();
  await expect(page.getByText('还没有解题记录')).toBeVisible();
  await page.setViewportSize({ width: 320, height: 700 });
  const bounds = await nav.boundingBox(); const camera = await nav.getByRole('button').boundingBox();
  expect(bounds).not.toBeNull(); expect(camera).not.toBeNull();
  expect(Math.abs(camera!.x + camera!.width / 2 - 160)).toBeLessThan(2);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(700);
  expect(bounds!.height).toBeLessThanOrEqual(56);
  expect(camera!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `.runtime/screenshots/${info.project.name}-navigation.png`, fullPage: true });
});

test('question and follow-up draft survive history, profile and cancelled camera navigation', async ({ page }) => {
  const id = '10000000-0000-4000-8000-000000000011'; const now = new Date().toISOString();
  const image = await page.screenshot({ type: 'jpeg' });
  const session = SessionViewSchema.parse({ schemaVersion: 1, id, subject: 'math', createdAt: now, upload: { schemaVersion: 1, id: '10000000-0000-4000-8000-000000000012', mimeType: 'image/jpeg', bytes: image.length, width: 320, height: 700, expiresAt: new Date(Date.now() + 3600000).toISOString(), previewUrl: '/api/v1/uploads/10000000-0000-4000-8000-000000000012/image' }, runs: [{ schemaVersion: 1, id: '10000000-0000-4000-8000-000000000013', sessionId: id, status: 'completed', message: '', seq: 5, createdAt: now, outcome: { schemaVersion: 1, status: 'completed', verified: true, warning: null, verification: { schemaVersion: 1, verdict: 'pass', checked: ['transcription'], issues: [] }, candidate: { schemaVersion: 1, kind: 'answer', problem: { text: '求解 x+1=3', subject: 'math', uncertainties: [] }, answer: '$x=2$', steps: [{ id: 's1', title: '移项', explanation: '等式两边同时减一。' }], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } } }] });
  let calls = 0; page.on('request', request => { if (request.method() === 'POST') calls++; });
  await seedLocalSession(page, session, image); await configureLocalModel(page);
  const input = page.getByLabel('继续问这道题', { exact: true });
  await input.fill('保留这条未发送的追问');
  await page.getByRole('tab', { name: '历史题目', exact: true }).click();
  await expect(page.getByRole('button', { name: /^打开数学题目/ })).toBeVisible();
  await page.getByRole('tab', { name: '我的', exact: true }).click();
  await page.getByRole('button', { name: '拍照', exact: true }).click();
  await page.getByRole('button', { name: '关闭相机', exact: true }).click();
  await page.getByRole('tab', { name: '题目', exact: true }).click();
  await page.getByRole('tab', { name: '当前题目', exact: true }).click();
  await expect(input).toHaveValue('保留这条未发送的追问');
  await expect(page.locator('.katex').first()).toBeVisible();
  expect(calls).toBe(0);
});

test('reduced-motion startup leaves the app usable without a persistent overlay', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByTestId('launch-screen')).toBeHidden();
  await page.getByRole('tab', { name: '我的', exact: true }).click();
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible();
});

test('switching to profile during solving preserves the run and renders its result on return', async ({ page }) => {
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  const candidate = { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: '$x=2$', steps: [{ id: 's1', title: '移项', explanation: '两边同时减去1。' }], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => { const call = ++calls; if (call === 1) await gate; await route.fulfill({ contentType: 'text/event-stream', body: modelSse(candidate, route.request().postDataJSON()) }); });
  try {
    await page.goto('/'); await configureLocalModel(page); await chooseSyntheticPhoto(page);
    await page.getByRole('button', { name: '开始解题', exact: true }).click();
    await expect.poll(() => calls).toBe(1);
    await page.getByRole('tab', { name: '我的', exact: true }).click();
    await expect(page.getByRole('button', { name: '设置', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '拍照', exact: true })).toBeDisabled();
    const hiddenMotion = await page.getByTestId('solve-scan').evaluate(async node => {
      const samples: string[] = [];
      for (let i = 0; i < 5; i++) {
        await new Promise(resolve => setTimeout(resolve, 80));
        samples.push(getComputedStyle(node).transform);
      }
      return new Set(samples).size;
    });
    expect(hiddenMotion).toBe(1);
    release();
    await expect(page.getByText('未校验', { exact: true })).toHaveCount(1);
    await page.getByRole('tab', { name: '题目', exact: true }).click();
    await expect(page.getByText('未校验', { exact: true })).toBeVisible();
    await expect(page.locator('.katex').first()).toBeVisible();
    expect(calls).toBe(1);
  } finally { release(); }
});

test('empty pages have artwork and usable actions, navigation animates and respects reduced motion', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/'); await expect(page.getByTestId('empty-camera')).toBeVisible();
  await expect(page.getByTestId('launch-screen')).toBeHidden();
  const mine = page.getByRole('tab', { name: '我的', exact: true });
  const icon = page.getByTestId('nav-touch-profile');
  const box = await mine.boundingBox(); if (!box) throw new Error('NAV_NOT_VISIBLE');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await expect.poll(() => icon.evaluate(node => Number(getComputedStyle(node).opacity))).toBeLessThan(.95);
  await page.mouse.up();
  await expect(mine).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => icon.evaluate(node => Number(getComputedStyle(node).opacity))).toBeCloseTo(1, 2);
  await page.getByRole('button', { name: '收藏的题目', exact: true }).click();
  await expect(page.getByTestId('empty-favorites')).toBeVisible();
  await expect(page.getByRole('button', { name: '返回我的', exact: true })).toHaveCount(0);
  await page.screenshot({ path: `.runtime/screenshots/${info.project.name}-empty-favorites.png`, fullPage: true });
  await page.getByRole('button', { name: '去历史题目', exact: true }).click();
  await expect(page.getByTestId('empty-history')).toBeVisible();
  await page.getByRole('button', { name: '拍一道题', exact: true }).click();
  await page.getByRole('button', { name: '关闭相机', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const question = page.getByRole('tab', { name: '题目', exact: true }); const area = await question.boundingBox(); if (!area) throw new Error('NAV_NOT_VISIBLE');
  await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2); await page.mouse.down();
  expect(await page.getByTestId('nav-touch-questions').evaluate(node => Number(getComputedStyle(node).opacity))).toBe(1);
  await page.mouse.up();
});


test('related icon layers transition, rapid switching settles, and camera uses a shutter gesture', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/'); await expect(page.getByTestId('empty-camera')).toBeVisible();
  await expect(page.getByTestId('launch-screen')).toBeHidden();
  const mine = page.getByRole('tab', { name: '我的', exact: true });
  const questions = page.getByRole('tab', { name: '题目', exact: true });
  // Sample actual frames: an intermediate outline/fill blend must exist, not an instant icon swap.
  const frames = page.getByTestId('nav-fill-profile').evaluate(node => new Promise<number[]>(resolve => {
    // Begin at the actual click; Playwright may spend time waiting for the target before dispatch.
    const tab = node.closest('[role="tab"]'); if (!tab) throw new Error('TAB_NOT_FOUND');
    tab.addEventListener('click', () => {
      const values: number[] = []; const start = performance.now();
      const sample = () => { values.push(Number(getComputedStyle(node).opacity)); if (performance.now() - start < 700) requestAnimationFrame(sample); else resolve(values); };
      requestAnimationFrame(sample);
    }, { once: true });
  }));
  await mine.click();
  expect((await frames).some(value => value > .05 && value < .95)).toBe(true);
  await expect(page.getByTestId('nav-fill-profile')).toHaveCSS('opacity', '1');
  await expect(page.getByTestId('nav-outline-profile')).toHaveCSS('opacity', '0');
  const icon = await page.getByTestId('nav-icon-profile').boundingBox(); const target = await mine.boundingBox();
  if (!icon || !target) throw new Error('NAV_NOT_VISIBLE');
  if (await page.getByTestId('desktop-brand').isVisible()) {
    // Wide Web places the label beside the icon; narrow layouts keep it below.
    const label = await mine.getByText('我的', { exact: true }).last().boundingBox();
    if (!label) throw new Error('NAV_LABEL_NOT_VISIBLE');
    expect(icon.x).toBeGreaterThanOrEqual(target.x);
    expect(icon.x + icon.width).toBeLessThan(label.x);
    expect(label.x + label.width).toBeLessThanOrEqual(target.x + target.width);
  } else {
    expect(Math.abs(icon.x + icon.width / 2 - target.x - target.width / 2)).toBeLessThan(1);
  }
  expect(icon.width).toBe(28); expect(target.height).toBeGreaterThanOrEqual(44);
  for (let index = 0; index < 3; index++) { await questions.click(); await mine.click(); }
  await questions.click();
  await expect(page.getByTestId('nav-fill-questions')).toHaveCSS('opacity', '1');
  await expect(page.getByTestId('nav-fill-profile')).toHaveCSS('opacity', '0');
  const camera = page.getByRole('button', { name: '拍照', exact: true });
  const area = await camera.boundingBox(); if (!area) throw new Error('CAMERA_NOT_VISIBLE');
  await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2); await page.mouse.down();
  await expect.poll(() => page.getByTestId('nav-camera-shutter').evaluate(node => new DOMMatrix(getComputedStyle(node).transform).b)).toBeGreaterThan(.5);
  await page.mouse.up();
  await expect(page.getByRole('button', { name: '关闭相机' })).toBeVisible();
  await page.getByRole('button', { name: '关闭相机' }).click();
  await expect.poll(() => page.getByTestId('nav-camera-shutter').evaluate(node => new DOMMatrix(getComputedStyle(node).transform).b)).toBe(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mine.click();
  await expect(page.getByTestId('nav-fill-profile')).toHaveCSS('opacity', '1');
  await expect(page.getByTestId('nav-outline-questions')).toHaveCSS('opacity', '1');
});
