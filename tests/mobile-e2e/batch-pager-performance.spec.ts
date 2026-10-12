import { expect, test, type Page } from '@playwright/test';
import { configureLocalModel } from './local-fixture.js';
import { MAX_BATCH_PHOTOS } from '../../packages/contracts/src/local.js';

test('large batches load a bounded page window and retain drafts after eviction', async ({ page }) => {
  let calls = 0; page.on('request', request => { if (request.method() === 'POST') calls++; });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (data: ShareData) => { document.documentElement.dataset.sharedType = data.files?.[0]?.type ?? ''; } });
  });
  await openLargeBatch(page);
  await expect(page.getByText('第1张：计算', { exact: false })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Number(document.documentElement.dataset.recordReads))).toBeLessThanOrEqual(4);
  await page.getByRole('button', { name: '查看题目图片', exact: true }).click({ delay: 650 });
  await expect(page.locator('html')).toHaveAttribute('data-shared-type', 'image/jpeg');
  await expect(page.getByTestId('image-zoom-viewport')).toHaveCount(0);
  const firstPage = page.getByTestId('question-page-1');
  await firstPage.locator('.step-details > summary').click();
  await firstPage.locator('.knowledge-panel summary').click();
  await page.getByRole('textbox', { name: '继续问这道题', exact: true }).fill('回到第一题后保留这段草稿');
  const pages = page.locator('[data-testid^="question-page-"]:not([data-testid="question-page-record"])');
  for (let i = 2; i <= 12; i++) {
    await page.getByRole('button', { name: '下一道题', exact: true }).click();
    await expect(page.getByText(`第${i}张：计算`, { exact: false })).toBeVisible();
    await expect.poll(() => pages.count()).toBeLessThanOrEqual(4);
  }
  await page.getByRole('button', { name: '当前第12题，共22题，展开题号速选' }).click();
  await page.getByRole('button', { name: '快速跳转第1题', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '继续问这道题', exact: true })).toHaveValue('回到第一题后保留这段草稿');
  await expect.poll(() => pages.count()).toBeLessThanOrEqual(4);
  await expect(firstPage.locator('.step-details')).toHaveAttribute('open', '');
  await expect(firstPage.locator('.knowledge-panel details')).toHaveAttribute('open', '');
  expect(calls).toBe(0);
});

async function openLargeBatch(page: Page, total = 22) {
  expect(total).toBeLessThanOrEqual(MAX_BATCH_PHOTOS);
  await page.goto('/'); await configureLocalModel(page);
  await page.evaluate(async total => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const req = indexedDB.open('solveflow-local', 1); req.onsuccess = () => resolve(req.result); req.onerror = reject; });
    const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 300;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 600, 300); ctx.fillStyle = 'black'; ctx.fillText('x + 1 = 3', 50, 100);
    const image = canvas.toDataURL('image/jpeg'); const createdAt = new Date().toISOString();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('documents', 'readwrite'); const store = tx.objectStore('documents');
      for (let position = 1; position <= total; position++) {
        const id = `80000000-0000-4000-8000-${String(position).padStart(12, '0')}`;
        const batch = { id: '81000000-0000-4000-8000-000000000001', title: `${total}题切换回归`, createdAt, exam: 'general', position };
        const candidate = { schemaVersion: 1, kind: 'answer', problem: { text: `第${position}张：计算 $x+1=3$`, subject: 'math', uncertainties: [] }, answer: '**2**', steps: [{ id: 's1', title: '移项', explanation: '两边减去1，得到 $x=2$。' }], knowledgePoints: ['代数'], citationIds: [], clarificationQuestions: [] };
        const session = { schemaVersion: 1, id, subject: 'math', createdAt, upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: 1000, width: 600, height: 300, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` }, runs: [{ schemaVersion: 1, id, sessionId: id, createdAt, seq: 1, status: 'completed', message: '', outcome: { schemaVersion: 1, status: 'completed', verified: false, verificationStatus: 'not_requested', verification: null, warning: null, candidate } }] };
        store.put(JSON.stringify({ schemaVersion: 1, session, image, batch }), `record.${id}`);
        // Seed the current summary format so startup migration is not counted as pager reads.
        store.put(JSON.stringify({ schemaVersion: 1, id, subject: 'math', createdAt, text: candidate.problem.text, answerState: 'answered', pending: false, batch }), `summary.${id}`);
      }
      tx.oncomplete = () => resolve(); tx.onerror = reject;
    }); db.close();
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (key) {
      if (typeof key === 'string' && key.startsWith('record.')) document.documentElement.dataset.recordReads = String(Number(document.documentElement.dataset.recordReads ?? 0) + 1);
      return get.call(this, key);
    };
  }, total);
  await page.getByRole('tab', { name: '历史题目', exact: true }).click();
  await page.getByRole('tab', { name: '批量记录', exact: true }).click();
  await page.getByRole('button', { name: '打开批量', exact: true }).click();
}

test('a wall-clock rollback during a slide cannot strand the question offscreen', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openLargeBatch(page);
  await expect(page.getByTestId('question-page-1').locator('.problem-text')).toContainText('第1张');
  const shifted = await page.evaluate(async () => {
    document.querySelector<HTMLElement>('[aria-label="下一道题"]')!.click();
    const deadline = performance.now() + 3000;
    while (performance.now() < deadline) {
      await new Promise(requestAnimationFrame);
      const node = document.querySelector<HTMLElement>('[data-testid="question-page-2"]');
      if (!node || getComputedStyle(node).zIndex !== '2') continue;
      const x = Math.abs(new DOMMatrixReadOnly(getComputedStyle(node).transform).m41);
      if (x > 1 && x < node.getBoundingClientRect().width - 1) {
        const original = Date.now; Date.now = () => original() - 60_000;
        setTimeout(() => { Date.now = original; }, 4000);
        return true;
      }
    }
    return false;
  });
  expect(shifted).toBe(true);
  await expect.poll(() => page.getByTestId('question-page-2').evaluate(node => Math.abs(new DOMMatrixReadOnly(getComputedStyle(node).transform).m41)), { timeout: 1500 }).toBeLessThan(.1);
  await page.getByRole('button', { name: '下一道题', exact: true }).click();
  await expect(page.getByRole('region', { name: '这道题的持续对话', exact: true })).toContainText('第3张');
});

test('100-question burst stays painted, survives rotation and settles without accumulating pages', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openLargeBatch(page, MAX_BATCH_PHOTOS);
  await expect(page.getByTestId('question-page-1').locator('.problem-text')).toContainText('第1张');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  try {
    const metrics = await page.evaluate(async () => {
      const frames: number[] = []; const gaps: number[] = []; let maxPages = 0; let previous = performance.now(); let running = true; let burstComplete = false;
      const start = previous; let settledMs: number | null = null;
      const sample = (now: number) => {
        frames.push(now - previous); previous = now;
        const pages = [...document.querySelectorAll<HTMLElement>('[data-testid^="question-page-"]:not([data-testid="question-page-record"])')];
        maxPages = Math.max(maxPages, pages.length);
        const stage = pages[0]?.parentElement?.getBoundingClientRect();
        if (stage) {
          const painted = pages.filter(node => Number(getComputedStyle(node).zIndex) > 0 && node.querySelector('.problem-text'))
            .map(node => node.getBoundingClientRect()).sort((a, b) => a.left - b.left);
          let edge = stage.left;
          for (const rect of painted) {
            if (rect.right <= edge || rect.left >= stage.right) continue;
            if (rect.left > edge + 2) break;
            edge = Math.max(edge, rect.right);
          }
          if (edge < stage.right - 2) gaps.push(now - start);
        }
        // RN Web omits aria-hidden when false; only true identifies a hidden page.
        const target = document.querySelector<HTMLElement>('[data-testid="question-page-9"]:not([aria-hidden="true"])');
        if (burstComplete && target && Math.abs(new DOMMatrixReadOnly(getComputedStyle(target).transform).m41) < .1 && settledMs === null) settledMs = now - start;
        if (running) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      for (let i = 0; i < 16; i++) {
        document.querySelector<HTMLElement>(`[aria-label="${i < 12 ? '下一道题' : '上一道题'}"]`)!.click();
        await new Promise(resolve => setTimeout(resolve, 70));
      }
      burstComplete = true;
      const deadline = performance.now() + 5000;
      while (settledMs === null && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
      await new Promise(resolve => setTimeout(resolve, 300)); running = false;
      const ordered = frames.slice(2).sort((a, b) => a - b);
      return { maxPages, blankFrames: gaps.length, frameSamples: frames.length, settledMs,
        p95FrameMs: ordered[Math.floor(ordered.length * .95)], maxFrameMs: Math.max(...ordered),
        note: 'Chromium 4x CPU throttle; frame scheduling is not Android device FPS.' };
    });
    await info.attach('motion-metrics', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' });
    console.log('100-question motion metrics', info.project.name, JSON.stringify(metrics));
    expect(metrics.blankFrames).toBe(0); expect(metrics.maxPages).toBeLessThanOrEqual(4);
    expect(metrics.settledMs).not.toBeNull(); expect(metrics.frameSamples).toBeGreaterThan(10);
    await expect(page.getByRole('region', { name: '这道题的持续对话', exact: true })).toContainText('第9张');
    await page.getByRole('button', { name: '下一道题', exact: true }).evaluate(node => (node as HTMLElement).click());
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.getByRole('region', { name: '这道题的持续对话', exact: true })).toContainText('第10张');
    await expect.poll(() => page.getByTestId('question-page-10').evaluate(node => Math.abs(new DOMMatrixReadOnly(getComputedStyle(node).transform).m41))).toBeLessThan(.1);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: '下一道题', exact: true }).click();
    await expect(page.getByRole('region', { name: '这道题的持续对话', exact: true })).toContainText('第11张');
    await expect.poll(() => page.locator('[data-testid^="question-page-"]:not([data-testid="question-page-record"])').count()).toBeLessThanOrEqual(3);
    await page.screenshot({ path: `.runtime/motion-0.1.66/${info.project.name}-100-question-landscape.png` });
  } finally { await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }); await cdp.detach(); }
});

test('100-question counter stays on one line in narrow and landscape layouts', async ({ page }) => {
  await openLargeBatch(page, MAX_BATCH_PHOTOS);
  await page.getByRole('button', { name: '当前第1题，共100题，展开题号速选', exact: true }).click();
  await page.getByRole('button', { name: '快速跳转第100题', exact: true }).click();
  await expect(page.getByRole('region', { name: '这道题的持续对话', exact: true })).toContainText('第100张');
  for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    const count = page.getByText('100/100', { exact: true });
    await expect.poll(async () => (await count.boundingBox())!.height).toBeLessThanOrEqual(18);
    expect(await count.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await expect(page.getByRole('button', { name: '下一道题', exact: true })).toBeDisabled();
    await expect(page.getByRole('tab', { name: '跳转第100题', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: `.runtime/motion-0.1.66/counter-${viewport.width}.png` });
  }
});

for (const queueNext of [false, true]) test(`keeps the painted question until a cold target loads${queueNext ? ' while later clicks queue' : ''}`, async ({ page }) => {
  await openLargeBatch(page);
  const first = page.getByTestId('question-page-1');
  await expect(first.locator('.problem-text')).toContainText('第1张');
  const before = await first.boundingBox();
  await page.evaluate(() => {
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (key) {
      const request = get.call(this, key);
      if (key === 'record.80000000-0000-4000-8000-000000000022') {
        const tx = this.transaction;
        Object.defineProperty(tx, 'oncomplete', { configurable: true, set(listener: (this: IDBTransaction, event: Event) => void) {
          tx.addEventListener('complete', event => {
            document.documentElement.dataset.coldPageWaiting = 'true';
            window.addEventListener('test:release-cold-page', () => listener.call(tx, event), { once: true });
          });
        } });
      }
      return request;
    };
  });
  await page.getByRole('button', { name: '当前第1题，共22题，展开题号速选' }).click();
  await page.getByRole('button', { name: '快速跳转第22题', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-cold-page-waiting', 'true');
  if (queueNext) await page.getByRole('button', { name: '上一道题', exact: true }).click();
  // More than a full animation: the outgoing content must never slide away to a loader.
  await page.waitForTimeout(450);
  await expect(first).toBeVisible();
  await expect(first).not.toHaveAttribute('aria-hidden', 'true');
  await expect(page.getByRole('region', { name: '这道题的持续对话', exact: true })).toContainText('第1张');
  expect(await first.boundingBox()).toEqual(before);
  await expect(page.getByTestId('question-page-22')).toHaveCount(1);
  await page.evaluate(() => window.dispatchEvent(new Event('test:release-cold-page')));
  await expect(page.getByRole('region', { name: '这道题的持续对话', exact: true })).toContainText(queueNext ? '第21张' : '第22张');
  await expect(first).toHaveCount(0);
});

for (const release of [true, false]) test(`waits for measured content and ${release ? 'then slides in' : 'recovers through the document fallback'}`, async ({ page }) => {
  await openLargeBatch(page);
  await expect(page.getByTestId('question-page-1').locator('.problem-text')).toContainText('第1张');
  await page.evaluate(() => {
    const measure = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.matches('article.answer-document') && this.textContent?.includes('第22张') && !document.documentElement.dataset.releaseMeasurement) {
        document.documentElement.dataset.measurementWaiting = 'true';
        return new DOMRect(0, 0, 0, 0);
      }
      return measure.call(this);
    };
  });
  await page.getByRole('button', { name: '当前第1题，共22题，展开题号速选' }).click();
  await page.getByRole('button', { name: '快速跳转第22题', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-measurement-waiting', 'true');
  await page.waitForTimeout(450);
  await expect(page.getByRole('region', { name: '这道题的持续对话', exact: true })).toContainText('第1张');
  if (release) await page.evaluate(() => {
    document.documentElement.dataset.releaseMeasurement = 'true';
    const target = document.querySelector<HTMLElement>('[data-testid="question-page-22"] article');
    const spacer = document.createElement('div'); spacer.style.height = '1px';
    target?.append(spacer); // ResizeObserver observes the content box, not padding.
  });
  else await expect(page.getByRole('button', { name: '重新加载解答', exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('region', { name: '这道题的持续对话', exact: true })).toContainText('第22张');
  await expect(page.getByTestId('question-page-1')).toHaveCount(0);
});

test('rapid changes settle on the last requested question with a bounded page window', async ({ page }) => {
  await openLargeBatch(page);
  for (let i = 0; i < 10; i++) await page.getByRole('button', { name: '下一道题', exact: true }).click();
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '上一道题', exact: true }).click();
  await expect(page.getByRole('region', { name: '这道题的持续对话', exact: true })).toContainText('第8张');
  await expect(page.getByRole('button', { name: '当前第8题，共22题，展开题号速选' })).toBeVisible();
  await expect.poll(() => page.locator('[data-testid^="question-page-"]:not([data-testid="question-page-record"])').count()).toBeLessThanOrEqual(3);
});
