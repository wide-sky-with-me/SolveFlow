import { expect, test } from '@playwright/test';
import { SessionViewSchema } from '../../packages/contracts/src/http.js';
import { makeSafeAgentError } from '../../packages/contracts/src/agent.js';
import { chooseSyntheticPhoto, configureLocalModel, modelPass, modelSse } from './local-fixture.js';

test.use({ reducedMotion: 'reduce' });

test('dashboard counts saved answers, failed and clarification records, favorites, distinct batches and subjects', async ({ page }, info) => {
  let posts = 0; page.on('request', request => { if (request.method() === 'POST') posts++; });
  await page.goto('/'); await expect(page.getByTestId('launch-screen')).toBeHidden();
  const createdAt = '2026-10-10T08:00:00.000Z';
  const states = ['verified', 'verified', 'answered', 'failed', 'clarification', 'unanswered', 'unanswered'] as const;
  const subjects = ['math', 'biology', 'biology', 'physics', 'chemistry', 'math', 'general'] as const;
  const records = states.map((state, index) => {
    const id = `86300000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    const runId = `86400000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    const candidate = { schemaVersion: 1, kind: 'answer', problem: { text: 'Synthetic saved question', subject: subjects[index], uncertainties: [] }, answer: '2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
    const outcome = state === 'failed' ? { schemaVersion: 1, status: 'failed', verified: false, error: makeSafeAgentError('MODEL_TIMEOUT', runId) }
      : state === 'clarification' ? { schemaVersion: 1, status: 'needs_clarification', verified: false, candidate: { ...candidate, kind: 'clarification', answer: null, clarificationQuestions: ['请补齐关键条件。'] } }
        : { schemaVersion: 1, status: 'completed', verified: state === 'verified', warning: null, candidate, verification: state === 'verified' ? modelPass : { schemaVersion: 1, verdict: 'unknown', checked: [], issues: [{ code: 'INSUFFICIENT_EVIDENCE', message: '尚未确认。' }] } };
    const session = SessionViewSchema.parse({ schemaVersion: 1, id, subject: subjects[index], createdAt, upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: 1000, width: 600, height: 300, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` }, runs: state === 'unanswered' ? [] : [{ schemaVersion: 1, id: runId, sessionId: id, status: outcome.status, message: '', createdAt, seq: 1, outcome }] });
    return { schemaVersion: 1, session, favorite: index === 0 || index === 2, ...(index >= 1 && index <= 4 ? { batch: { id: index === 4 ? '86500000-0000-4000-8000-000000000002' : '86500000-0000-4000-8000-000000000001', title: '合成批次', createdAt, exam: 'general', position: index === 4 ? 1 : index } } : {}) };
  });
  await page.evaluate(async records => {
    const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 300; const image = canvas.toDataURL('image/jpeg');
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('solveflow-local', 1); request.onsuccess = () => resolve(request.result); request.onerror = reject; });
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('documents', 'readwrite'); const store = tx.objectStore('documents');
      for (const { favorite, ...record } of records) { store.put(JSON.stringify({ ...record, image }), `record.${record.session.id}`); if (favorite) store.put(JSON.stringify({ schemaVersion: 1, favorite: true }), `favorite.${record.session.id}`); }
      tx.oncomplete = () => resolve(); tx.onerror = reject;
    }); db.close();
  }, records);
  await page.reload(); await page.getByRole('tab', { name: '我的', exact: true }).click();
  await expect(page.getByTestId('profile-stat-total')).toContainText('7 条');
  await expect(page.getByTestId('profile-stat-total')).toContainText('单题 3 · 批量 4');
  await expect(page.getByTestId('profile-stat-answers')).toContainText('3 条');
  await expect(page.getByTestId('profile-stat-favorites')).toContainText('2 条');
  await expect(page.getByTestId('profile-stat-batches')).toContainText('2 个');
  for (const [state, count] of [['verified', 2], ['answered', 1], ['failed', 2], ['unanswered', 2]] as const) await expect(page.getByTestId(`profile-state-${state}`)).toContainText(String(count));
  for (const [subject, count] of [['math', 2], ['biology', 2], ['physics', 1], ['chemistry', 1], ['general', 1]] as const) await expect(page.getByTestId(`profile-subject-${subject}`)).toContainText(String(count));
  await expect(page.getByTestId('profile-pending')).toHaveText('运行中 0');
  for (const width of [1920, 1280, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(page.getByTestId('profile-stat-total')).toHaveCSS('background-color', width >= 1100 ? colorScheme === 'dark' ? 'rgb(30, 48, 73)' : 'rgb(240, 245, 255)' : colorScheme === 'dark' ? 'rgb(36, 57, 85)' : 'rgb(237, 243, 255)');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByTestId('profile-stat-total').scrollIntoViewIfNeeded();
      if (width >= 1100) {
        await expect(page.getByRole('button', { name: '使用说明', exact: true })).toBeInViewport({ ratio: 1 });
      }
      const mine = page.getByRole('tab', { name: '我的', exact: true });
      // End the previous keyboard focus before testing a fresh pointer focus.
      await expect(page.getByRole('heading', { name: '我的', exact: true })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: '设置与数据', exact: true })).toHaveCount(0);
      await page.getByTestId('profile-overview').click({ position: { x: 5, y: 5 } });
      await mine.click(); await expect(mine).toHaveCSS('outline-style', 'none');
      await mine.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
      await expect(mine).toHaveCSS('outline-width', '2px');
      await expect(mine).toHaveCSS('outline-color', colorScheme === 'dark' ? 'rgb(111, 146, 199)' : 'rgb(157, 185, 232)');
      const arrows = await page.getByTestId('profile-menu').getByTestId('menu-chevron').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().right));
      expect(arrows).toHaveLength(6); expect(Math.max(...arrows) - Math.min(...arrows)).toBeLessThan(1);
      const values = await page.getByTestId('profile-menu').getByTestId('menu-accessory-value').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().right));
      expect(values).toHaveLength(2); expect(Math.abs(values[0]! - values[1]!)).toBeLessThan(1);
      const verticalOffsets = await page.getByTestId('profile-menu').evaluate(node => Array.from(node.querySelectorAll(':scope > [role="button"]')).flatMap(row => {
        const bounds = row.getBoundingClientRect(); const label = row.firstElementChild?.getBoundingClientRect();
        if (!label) throw new Error('MISSING_MENU_LABEL');
        return Array.from(row.querySelectorAll('[data-testid="menu-chevron"], [data-testid="menu-accessory-value"]')).map(child => {
          const accessory = child.getBoundingClientRect();
          return { top: Math.abs(accessory.top - label.top), height: Math.abs(accessory.height - label.height), center: Math.abs(accessory.top + accessory.height / 2 - bounds.top - bounds.height / 2) };
        });
      }));
      for (const offset of verticalOffsets) { expect(offset.top).toBeLessThan(.5); expect(offset.height).toBeLessThan(.5); expect(offset.center).toBeLessThan(.5); }
      await page.screenshot({ path: info.outputPath(`dashboard-${width}-${colorScheme}.png`) });
    }
  }
  await page.getByRole('button', { name: '查看历史题目', exact: true }).click();
  await expect(page.getByRole('tab', { name: '历史题目', exact: true })).toHaveAttribute('aria-selected', 'true');
  const row = page.locator('.history-entry[data-session-id="86300000-0000-4000-8000-000000000001"]');
  await row.getByRole('button', { name: '题目操作', exact: true }).click();
  await row.getByRole('button', { name: '取消收藏', exact: true }).click();
  await page.getByRole('tab', { name: '我的', exact: true }).click();
  await expect(page.getByTestId('profile-stat-favorites')).toContainText('1 条');
  await page.reload(); await expect(page.getByTestId('profile-stat-favorites')).toContainText('1 条');
  expect(posts).toBe(0);
});

test('dashboard updates running and answered counts live while preserving the settings lock', async ({ page }) => {
  let release: (() => void) | undefined; const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    await held; await route.fulfill({ contentType: 'text/event-stream', body: modelSse({ schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] }, route.request().postDataJSON()) });
  });
  try {
    await page.goto('/'); await configureLocalModel(page); await chooseSyntheticPhoto(page);
    await page.getByRole('button', { name: '开始解题', exact: true }).click();
    await page.getByRole('tab', { name: '我的', exact: true }).click();
    await expect(page.getByTestId('profile-pending')).toHaveText('运行中 1');
    await expect(page.getByRole('button', { name: '设置', exact: true })).toBeDisabled();
    release?.();
    await expect(page.getByTestId('profile-pending')).toHaveText('运行中 0');
    await expect(page.getByTestId('profile-stat-answers')).toContainText('1 条');
    await expect(page.getByTestId('profile-state-answered')).toContainText('1');
    await expect(page.getByTestId('profile-state-verified')).toContainText('0');
    await expect(page.getByRole('button', { name: '设置', exact: true })).toBeEnabled();
  } finally { release?.(); await page.unrouteAll({ behavior: 'ignoreErrors' }); }
});
