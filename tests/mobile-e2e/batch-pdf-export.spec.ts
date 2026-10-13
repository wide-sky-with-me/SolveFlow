import { expect, test, type Page } from '@playwright/test';
const batchId = '92000000-0000-4000-8000-000000000001';
async function seed(page: Page, broken = false, tilted = false) {
  await page.goto('/'); await expect(page.getByTestId('launch-screen')).toBeHidden();
  await page.evaluate(({ batchId, broken, tilted }) => {
    return new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('solveflow-local', 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 550;
        const context = canvas.getContext('2d'); if (!context) throw new Error('CANVAS');
        context.fillStyle = '#eee'; context.fillRect(0, 0, 900, 550);
        if (tilted) { context.translate(450, 275); context.rotate(-5 * Math.PI / 180); context.translate(-450, -275); }
        context.fillStyle = '#fff'; context.fillRect(50, 50, 800, 450);
        if (tilted) { context.fillStyle = '#244b8a'; context.fillRect(50, 50, 800, 55); }
        context.fillStyle = '#111'; context.font = '30px sans-serif'; context.fillText('Solve x + 1 = 3', 90, 140); context.fillText('A: 1    B: 2', 90, 230);
        const image = canvas.toDataURL('image/jpeg'); const createdAt = '2026-10-12T05:00:00.000Z';
        const db = open.result; const tx = db.transaction('documents', 'readwrite'); const store = tx.objectStore('documents');
        for (const position of [2, 1]) {
          const id = `92100000-0000-4000-8000-${String(position).padStart(12, '0')}`;
          const candidate = { schemaVersion: 1, kind: 'answer', problem: { text: `Synthetic question ${position}: solve $x+1=3$.`, subject: 'math', uncertainties: [], options: [{ label: 'A', text: '1' }, { label: 'B', text: '2' }] }, answer: '**2**', selectedOptions: ['B'], steps: [{ id: 'step-1', title: 'Subtract one', explanation: '$x=3-1=2$' }], knowledgePoints: ['Synthetic algebra', 'Legacy knowledge name'], knowledgeDetails: [{ name: 'Synthetic algebra', explanation: 'Both sides stay equal.', application: 'Subtract one from both sides.', pitfall: 'Keep the signs consistent.' }], citationIds: [], clarificationQuestions: [] };
          if (position === 2) candidate.answer += `\n\nSynthetic long-formula layout check:\n\n$$${Array.from({ length: 24 }, () => 'x').join('+')}$$`;
          const session = { schemaVersion: 1, id, subject: 'math', createdAt, upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: 2000, width: 900, height: 550, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` }, runs: [{ schemaVersion: 1, id, sessionId: id, createdAt, seq: 1, status: 'completed', message: '', outcome: { schemaVersion: 1, status: 'completed', verified: position === 1, ...(position === 2 ? { verificationStatus: 'not_requested' } : {}), verification: position === 1 ? { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'logic', 'diagram'], issues: [] } : null, warning: null, candidate } }] };
          store.put(JSON.stringify({ schemaVersion: 1, session, image: broken && position === 1 ? 'data:image/jpeg;base64,AQID' : image, ...(position === 1 ? { materials: [{ id: '92200000-0000-4000-8000-000000000001', image, bytes: 2000, width: 900, height: 550 }] } : {}), batch: { id: batchId, title: 'Synthetic PDF batch', createdAt, exam: 'general', position } }), `record.${id}`);
        }
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
      };
    });
  }, { batchId, broken, tilted });
  await page.goto('/?session=92100000-0000-4000-8000-000000000001');
  await expect(page.getByTestId('current-batch')).toBeVisible();
}
test('batch PDF keeps ordered questions, originals, saved details and verification state, permits image review and prints without model calls or storage writes', async ({ page }, info) => {
  let modelCalls = 0; await page.route('https://**', route => { modelCalls++; return route.abort(); });
  await page.route('**/__solveflow/web-env/model/**', route => { modelCalls++; return route.abort(); });
  await page.addInitScript(() => new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) if (node instanceof HTMLIFrameElement && node.title === '批次 PDF 打印' && node.contentWindow) {
      const target = node.contentWindow;
      target.print = () => {
        const doc = node.contentDocument; if (!doc) throw new Error('PRINT_DOCUMENT');
        document.documentElement.dataset.pdfPrinted = String(doc.querySelectorAll('[data-testid="printed-question"]').length);
        document.documentElement.dataset.pdfText = doc.body.textContent ?? '';
        document.documentElement.dataset.pdfImages = String(doc.images.length);
        document.documentElement.dataset.pdfMath = String(doc.querySelectorAll('.katex').length);
        const content = doc.querySelector<HTMLElement>('.batch-print-document'); if (!content) throw new Error('PRINT_ROOT');
        document.documentElement.dataset.pdfOverflow = String(content.scrollWidth > content.clientWidth + 1);
        target.dispatchEvent(new Event('afterprint'));
      };
    }
  }).observe(document, { childList: true, subtree: true }));
  await seed(page);
  const originals = async () => page.evaluate(() => new Promise<string[]>((resolve, reject) => { const open = indexedDB.open('solveflow-local'); open.onsuccess = () => { const db = open.result; const tx = db.transaction('documents'); const req = tx.objectStore('documents').getAll(); tx.oncomplete = () => { db.close(); resolve(req.result.filter((value: unknown) => typeof value === 'string' && value.includes('"session"'))); }; tx.onerror = () => reject(tx.error); }; }));
  const before = await originals();
  await page.getByRole('button', { name: '批次操作', exact: true }).click(); await page.getByRole('button', { name: '导出本批 PDF', exact: true }).click();
  await page.getByText('预览导出内容', { exact: true }).click(); await page.getByText('图片整理', { exact: true }).click();
  const preview = page.getByTestId('batch-print-preview'); await expect(preview).toBeVisible();
  await page.getByRole('button', { name: '原始记录', exact: true }).click();
  await expect(preview.getByTestId('printed-question')).toHaveCount(2); await expect(preview).toContainText('校验通过'); await expect(preview).toContainText('未确认'); await expect(preview).toContainText('Subtract one');
  await expect(preview).toContainText('Legacy knowledge name'); await expect(preview).toContainText('Keep the signs consistent.');
  const text = await preview.innerText(); expect(text.indexOf('Synthetic question 1')).toBeLessThan(text.indexOf('Synthetic question 2'));
  await page.getByRole('button', { name: '图片来源', exact: true }).click(); await page.getByRole('option', { name: '第 1 张 · 补图 1', exact: true }).click(); await page.getByRole('button', { name: '恢复原图', exact: true }).click();
  await expect(page.getByLabel('导出题图旋转角度')).toHaveValue('0');
  await page.getByLabel('导出题图旋转角度').fill('2'); await page.getByRole('button', { name: '更新图像预览', exact: true }).click();
  await expect(page.getByRole('button', { name: '打印 / 保存 PDF', exact: true })).toBeEnabled();
  const prepared = await page.getByAltText('整理后题图', { exact: true }).getAttribute('src');
  await page.getByLabel('导出裁切left').fill('100'); await page.getByRole('button', { name: '更新图像预览', exact: true }).click();
  await expect(page.getByText('请检查旋转角度和裁切范围，裁切后的宽高须至少保留 5%。', { exact: true })).toBeVisible();
  expect(await page.getByAltText('整理后题图', { exact: true }).getAttribute('src')).toBe(prepared);
  await page.getByLabel('导出裁切left').fill('0'); await page.getByRole('button', { name: '更新图像预览', exact: true }).click();
  await page.getByRole('button', { name: '打印 / 保存 PDF', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-pdf-printed', '2'); await expect(page.locator('html')).toHaveAttribute('data-pdf-images', '3');
  expect(Number(await page.locator('html').getAttribute('data-pdf-math'))).toBeGreaterThan(0);
  await expect(page.locator('html')).toHaveAttribute('data-pdf-overflow', 'false');
  expect(await originals()).toEqual(before); expect(modelCalls).toBe(0);
  await page.screenshot({ path: info.outputPath('batch-pdf-preview.png') });
  await page.getByRole('button', { name: '关闭导出', exact: true }).click(); await expect(preview).toHaveCount(0); await expect(page.locator('iframe[title="批次 PDF 打印"]')).toHaveCount(0);
});
test('a corrupt image aborts the complete PDF and retains all source records', async ({ page }) => {
  await seed(page, true); await page.getByRole('button', { name: '批次操作', exact: true }).click(); await page.getByRole('button', { name: '导出本批 PDF', exact: true }).click();
  await expect(page.getByRole('button', { name: '打印 / 保存 PDF', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '原始记录', exact: true }).click(); await page.getByRole('button', { name: '打印 / 保存 PDF', exact: true }).click();
  await expect(page.getByText('题图无法读取。', { exact: true })).toBeVisible(); await expect(page.getByTestId('batch-print-document')).toHaveCount(0); await expect(page.locator('iframe[title="批次 PDF 打印"]')).toHaveCount(0);
  await page.getByRole('button', { name: '关闭导出', exact: true }).click(); await expect(page.getByTestId('current-batch')).toBeVisible();
});
test('a tilted screen is straightened on demand while automatic preparation preserves the full crop and stays usable in short narrow layouts', async ({ page }) => {
  await seed(page, false, true); await page.getByRole('button', { name: '批次操作', exact: true }).click(); await page.getByRole('button', { name: '导出本批 PDF', exact: true }).click();
  await page.getByText('预览导出内容', { exact: true }).click(); await page.getByText('图片整理', { exact: true }).click();
  await expect(page.getByTestId('batch-print-preview')).toBeVisible();
  await page.getByRole('button', { name: '自动整理本图', exact: true }).click(); await expect(page.getByRole('button', { name: '打印 / 保存 PDF', exact: true })).toBeEnabled();
  const angle = Number(await page.getByLabel('导出题图旋转角度').inputValue()); expect(angle).toBeGreaterThanOrEqual(4.5); expect(angle).toBeLessThanOrEqual(5.5);
  for (const side of ['left', 'top']) await expect(page.getByLabel(`导出裁切${side}`)).toHaveValue('0');
  for (const side of ['right', 'bottom']) await expect(page.getByLabel(`导出裁切${side}`)).toHaveValue('100');
  for (const size of [{ width: 320, height: 844 }, { width: 740, height: 390 }]) {
    await page.setViewportSize(size); await expect(page.getByRole('button', { name: '打印 / 保存 PDF', exact: true })).toBeInViewport({ ratio: 1 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
