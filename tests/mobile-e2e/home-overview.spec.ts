import { expect, test, type Page } from '@playwright/test';
import { SessionViewSchema } from '../../packages/contracts/src/http.js';

test.use({ reducedMotion: 'reduce' });

test('empty home fills the available desktop area and keeps capture controls reachable', async ({ page }, info) => {
  await page.goto('/'); await expect(page.getByTestId('launch-screen')).toBeHidden();
  await expect(page.getByTestId('home-recent')).toHaveCount(0);
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
      await page.setViewportSize(viewport);
      const hero = await page.getByTestId('empty-camera').boundingBox();
      const scroll = await page.getByTestId('question-scroll').boundingBox();
      if (!hero || !scroll) throw new Error('HOME_LAYOUT_MISSING');
      expect(hero.height).toBeGreaterThan(scroll.height * .8);
      for (const name of ['拍一张', '从相册选择', '配置模型与考试类型']) await expect(page.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`empty-home-${viewport.width}-${colorScheme}.png`) });
    }
  }
});

test('home recent records group a batch, stay bounded, and open the saved single or batch without model requests', async ({ page }, info) => {
  let posts = 0; const errors: string[] = [];
  page.on('request', request => { if (request.method() === 'POST') posts++; });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/__solveflow/web-env', route => route.fulfill({ json: {
    schemaVersion: 1, settings: { schemaVersion: 1, solver: { provider: 'fixture', baseURL: 'https://fixture-model.invalid/v1', model: 'home-fixture', api: 'openai-completions', contextWindow: 32768, maxTokens: 8192, maxTokensField: 'max_tokens', streaming: false }, verifier: null },
    accessTokens: { solver: 'synthetic-home', verifier: null, backup: null },
  } }));
  await page.route('**/__solveflow/web-env/model/**', route => route.abort());
  await page.goto('/'); await expect(page.getByTestId('launch-screen')).toBeHidden();
  await expect(page.getByRole('button', { name: '配置模型与考试类型', exact: true })).toHaveCount(0);
  await seedRecentRecords(page); await page.reload();
  const recent = page.getByTestId('home-recent'); await expect(recent).toBeVisible();
  const rows = recent.getByTestId('home-recent-record'); await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('物理练习 · 示例'); await expect(rows.nth(0)).toContainText('2 张题图');
  await expect(rows.nth(1)).toContainText('已校验'); await expect(rows.nth(2)).toContainText('待确认');
  await expect(recent).not.toContainText('较早的练习');
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 320, height: 700 }]) {
      await page.setViewportSize(viewport);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (viewport.width >= 1100) { await expect(rows.last()).toBeInViewport({ ratio: 1 }); await expect(page.getByRole('button', { name: '拍一张', exact: true })).toBeInViewport({ ratio: 1 }); }
      await page.screenshot({ path: info.outputPath(`recent-home-${viewport.width}-${colorScheme}.png`) });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await rows.nth(1).focus(); await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/session=97300000-0000-4000-8000-000000000003/); await expect(page.getByTestId('home-recent')).toHaveCount(0);
  await page.goBack(); await expect(recent).toBeVisible();
  await rows.nth(0).click(); await expect(page.getByTestId('current-batch')).toBeVisible(); await expect(page.getByTestId('batch-title')).toContainText('物理练习 · 示例');
  await page.goBack(); await expect(recent).toBeVisible();
  await recent.getByRole('button', { name: '查看全部', exact: true }).click();
  await expect(page.getByRole('tab', { name: '历史题目', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect(posts).toBe(0); expect(errors).toEqual([]);
});

async function seedRecentRecords(page: Page) {
  const titles = ['小车匀速运动的速度计算', '电路中的电流与电压', '求一次方程的解', '植物叶片的光合作用', '判断反应中的物质变化', '较早的练习'];
  const subjects = ['physics', 'physics', 'math', 'biology', 'chemistry', 'math'] as const;
  const records = titles.map((text, index) => {
    const id = `97300000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    const createdAt = `2026-10-${String(21 - index).padStart(2, '0')}T04:00:00.000Z`;
    const candidate = { schemaVersion: 1, kind: 'answer', problem: { text, subject: subjects[index], uncertainties: [] }, answer: '2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
    const verified = index === 2;
    const session = SessionViewSchema.parse({ schemaVersion: 1, id, createdAt, subject: subjects[index], upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: 1000, width: 600, height: 300, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` }, runs: [{ schemaVersion: 1, id, sessionId: id, createdAt, seq: 1, status: 'completed', message: '', outcome: { schemaVersion: 1, status: 'completed', candidate, verified, verification: verified ? { schemaVersion: 1, verdict: 'pass', checked: ['logic'], issues: [] } : null, ...(!verified ? { verificationStatus: 'not_requested' } : {}), warning: null } }] });
    return { schemaVersion: 1, session, ...(index < 2 ? { batch: { id: '97400000-0000-4000-8000-000000000001', title: '物理练习 · 示例', createdAt: '2026-10-20T04:00:00.000Z', exam: 'general', position: index + 1 } } : {}) };
  });
  await page.evaluate(async records => {
    const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 300; const image = canvas.toDataURL('image/jpeg');
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('solveflow-local', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('documents', 'readwrite'); for (const record of records) tx.objectStore('documents').put(JSON.stringify({ ...record, image }), `record.${record.session.id}`); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); }
    finally { db.close(); }
  }, records);
}
