import { expect, test } from '@playwright/test';
import { chooseSyntheticPhoto, configureLocalModel, lastModelInput, modelPass, modelSse } from './local-fixture.js';
test.use({ reducedMotion: 'reduce' });
const answer = { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: '即时答案 x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };

test('fourteen answers appear while the first check waits, and stopwatch starts only by hand', async ({ page }, info) => {
  let solves = 0; let checks = 0; let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    const body: unknown = route.request().postDataJSON(); const input = lastModelInput(body);
    if (input && typeof input === 'object' && 'role' in input && input.role === 'verifier') {
      checks++; await gate; await route.fulfill({ contentType: 'text/event-stream', body: modelSse(modelPass, body) });
    } else { solves++; await route.fulfill({ contentType: 'text/event-stream', body: modelSse(answer, body) }); }
  });
  try {
    await page.goto('/'); await configureLocalModel(page);
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('solveflow-local', 1); request.onsuccess = () => resolve(request.result); request.onerror = reject; });
      const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 300; const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('CANVAS'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 600, 300); ctx.fillStyle = '#111'; ctx.fillText('x+1=3', 50, 150);
      const image = canvas.toDataURL('image/jpeg'); const createdAt = '2026-10-08T08:00:00.000Z';
      await new Promise<void>((resolve, reject) => { const tx = db.transaction('documents', 'readwrite'); const store = tx.objectStore('documents');
        for (let n = 1; n <= 14; n++) {
          const id = `88000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
          const batch = { id: '88000000-0000-4000-8000-000000000010', title: '独立校验队列回归', createdAt, exam: 'general', position: n };
          const session = { schemaVersion: 1, id, subject: 'math', createdAt, upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: 1000, width: 600, height: 300, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` }, runs: [] };
          store.put(JSON.stringify({ schemaVersion: 1, session, image, batch }), `record.${id}`);
          store.put(JSON.stringify({ schemaVersion: 1, id, subject: 'math', createdAt, text: '', pending: false, answerState: 'unanswered', batch }), `summary.${id}`);
        }
        tx.oncomplete = () => resolve(); tx.onerror = reject;
      }); db.close();
    });
    await page.getByRole('tab', { name: '历史题目', exact: true }).click(); await page.getByRole('tab', { name: '批量记录', exact: true }).click(); await page.getByRole('button', { name: '打开批量', exact: true }).click();
    await page.getByRole('button', { name: '批次操作', exact: true }).click(); await page.getByRole('button', { name: '继续待解题', exact: true }).click();
    await expect.poll(() => solves).toBe(14); expect(checks).toBe(8);
    await expect(page.getByText(answer.answer, { exact: true }).first()).toBeVisible();
    const stopwatch = page.getByTestId('study-stopwatch').filter({ visible: true }).first();
    await expect(stopwatch).toContainText('00:00:00');
    await stopwatch.getByRole('button', { name: '开始计时', exact: true }).click();
    await expect.poll(() => stopwatch.innerText()).not.toContain('00:00:00');
    await stopwatch.getByRole('button', { name: '停止计时', exact: true }).click();
    await page.getByRole('button', { name: '当前第1题，共14题，展开题号速选', exact: true }).click();
    await expect(page.getByTestId('question-status-1')).toHaveCSS('background-color', 'rgb(255, 237, 213)');
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await page.screenshot({ path: info.outputPath('answer-before-verification.png') });
    release(); await expect.poll(() => checks).toBe(14);
    await page.getByRole('button', { name: '当前第1题，共14题，展开题号速选', exact: true }).click();
    await expect(page.getByTestId('question-status-1')).toHaveCSS('background-color', 'rgb(220, 252, 231)');
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await page.reload(); await expect(page.getByText(answer.answer, { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId('study-stopwatch').filter({ visible: true }).first()).not.toContainText('00:00:00');
    expect([solves, checks]).toEqual([14, 14]); expect(errors).toEqual([]);
  } finally { release(); }
});

test('after clarification, supplement explicitly regenerates with original and new images', async ({ page }) => {
  const bodies: unknown[] = [];
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    const body: unknown = route.request().postDataJSON(); bodies.push(body);
    await route.fulfill({ contentType: 'text/event-stream', body: modelSse(bodies.length === 1 ? { ...answer, kind: 'clarification', answer: null, clarificationQuestions: ['请补充右侧数值。'] } : answer, body) });
  });
  await page.goto('/'); await configureLocalModel(page); await chooseSyntheticPhoto(page);
  await page.getByRole('button', { name: '开始解题', exact: true }).click(); await expect(page.getByText('请补充右侧数值。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '同题材料 / 补图', exact: true }).click();
  const buffer = await page.screenshot({ type: 'jpeg' }); const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '从相册补图', exact: true }).click(); await (await chooser).setFiles({ name: 'detail.jpg', mimeType: 'image/jpeg', buffer });
  await page.getByRole('button', { name: '使用这张题图', exact: true }).click();
  await expect(page.getByRole('button', { name: '查看材料 1', exact: true })).toBeVisible(); expect(bodies).toHaveLength(1);
  await page.getByRole('button', { name: '使用原图和全部补图重新解答', exact: true }).click();
  await expect(page.getByText(answer.answer, { exact: true }).first()).toBeVisible(); expect(bodies).toHaveLength(2);
  expect(lastModelInput(bodies[1])).toMatchObject({ materialOrder: [expect.any(String)], focus: { kind: 'regenerate' } });
  expect(JSON.stringify(bodies[1]).match(/"type":"image_url"/g)).toHaveLength(2);
  await page.reload(); await expect(page.getByText(answer.answer, { exact: true }).first()).toBeVisible(); expect(bodies).toHaveLength(2);
});
