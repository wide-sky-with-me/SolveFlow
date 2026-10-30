import { expect, test, type Page } from '@playwright/test';
import { configureLocalModel } from './local-fixture.js';
import { StoredLocalRecordSchema } from '../../packages/contracts/src/local.js';

test.use({ reducedMotion: 'reduce', launchOptions: { executablePath: process.env.SOLVEFLOW_TEST_CHROME ?? '/usr/bin/google-chrome', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });
test.beforeEach(async ({ context }) => { await context.route('**/__solveflow/web-env/model/**', route => route.abort()); await context.route('https://**/*', route => route.abort()); });
async function openImport(page: Page, count = 3) {
  await page.goto('/'); await configureLocalModel(page);
  await page.getByRole('button', { name: '拍照', exact: true }).click(); await page.getByRole('button', { name: '批量解题', exact: true }).click();
  await page.getByRole('button', { name: '允许使用相机', exact: true }).evaluateAll(nodes => nodes.forEach(node => { if (node instanceof HTMLElement) node.click(); }));
  const image = Buffer.from(await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 3072; canvas.height = 2304; const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('CANVAS'); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.fillStyle = '#222'; ctx.font = '80px sans-serif'; ctx.fillText('Synthetic original',40,120); return canvas.toDataURL('image/jpeg').split(',')[1]!; }), 'base64');
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('dialog').getByRole('button', { name: '从相册选择', exact: true }).click();
  await (await chooser).setFiles(Array.from({length:count},(_,index) => ({ name: `${index + 1}.jpg`, mimeType: 'image/jpeg', buffer: image })));
  await expect(page.getByRole('heading', { name: '确认图片顺序', exact: true })).toBeVisible();
}
test('first batch import shares thumbnail cards and compact image tools without saving drafts', async ({ page }, info) => {
  await openImport(page);
  const rows = page.getByTestId('import-photo-row'); await expect(rows).toHaveCount(3);
  await expect(rows.first().getByRole('img')).toHaveAccessibleName('题图1缩略图：1.jpg');
  await expect(page.getByRole('button', { name: '编辑第1张题图', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^上移第|^下移第/ })).toHaveCount(0);
  await page.getByRole('button', { name: '编辑第3张题图', exact: true }).click();
  await page.getByRole('button', { name: '上移第3张', exact: true }).click();
  await page.getByRole('button', { name: '关闭图片操作', exact: true }).click();
  await expect(rows.nth(1).getByRole('img')).toHaveAccessibleName('题图2缩略图：3.jpg');
  await page.getByRole('button', { name: '移除第1张', exact: true }).click(); await expect(rows).toHaveCount(2);
  await page.screenshot({ path: info.outputPath('first-import-workbench.png') });
  await page.getByRole('button', { name: '取消导入', exact: true }).click();
  expect(await page.evaluate(() => new Promise<number>((resolve, reject) => { const open = indexedDB.open('solveflow-local'); open.onerror = () => reject(open.error); open.onsuccess = () => { const db = open.result; const read = db.transaction('documents').objectStore('documents').getAllKeys(); read.onsuccess = () => { db.close(); resolve(read.result.filter(key => String(key).startsWith('record.')).length); }; }; }))).toBe(0);
});
test('fifty large photos can scroll to the last cached thumbnail without keeping every original mounted', async ({ page }) => {
  await openImport(page,50);
  await expect(page.getByRole('button',{name:'导入并解题（50张）',exact:true})).toBeEnabled();
  await expect.poll(async () => {
    await page.getByTestId('batch-import-workbench').evaluate(root => {
      const strip = [...root.querySelectorAll<HTMLElement>('div')].find(node => node.scrollWidth > node.clientWidth && ['auto','scroll'].includes(getComputedStyle(node).overflowX));
      if (!strip) throw new Error('THUMBNAIL_STRIP'); strip.scrollLeft = strip.scrollWidth;
    });
    return page.getByRole('button',{name:'编辑第50张题图',exact:true}).count();
  },{timeout:10000}).toBe(1);
  const last = page.getByRole('img',{name:'题图50缩略图：50.jpg',exact:true}); await expect(last).toBeVisible();
  await expect.poll(async () => page.getByTestId('import-photo-row').last().locator('img').evaluateAll(nodes => Math.max(0,...nodes.map(node => (node as HTMLImageElement).naturalWidth)))).toBe(192);
  await page.getByRole('button',{name:'取消导入',exact:true}).click();
});
test('thumbnail cards use small derived images while the editor keeps the original resolution', async ({ page }) => {
  await openImport(page);
  const images = page.getByTestId('import-photo-row').locator('img');
  await expect.poll(async () => images.evaluateAll(nodes => nodes.filter(node => (node as HTMLImageElement).naturalWidth > 0).length)).toBe(3);
  for (const size of await images.evaluateAll(nodes => nodes.map(node => ({ width: (node as HTMLImageElement).naturalWidth, height: (node as HTMLImageElement).naturalHeight })))) expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(192);
  await page.getByRole('button', { name: '编辑第1张题图', exact: true }).click();
  await expect.poll(async () => page.getByTestId('import-photo-tools').locator('img').evaluateAll(nodes => Math.max(0,...nodes.map(node => (node as HTMLImageElement).naturalWidth)))).toBe(3072);
  await page.getByRole('button', { name: '关闭图片操作', exact: true }).click();
  await page.getByRole('button', { name: '导入并解题（3张）', exact: true }).click();
  await expect(page.getByRole('heading', { name: '确认图片顺序', exact: true })).toHaveCount(0);
  const values = await page.evaluate(() => new Promise<unknown[]>((resolve,reject) => { const open = indexedDB.open('solveflow-local'); open.onerror = () => reject(open.error); open.onsuccess = () => { const db = open.result; const read = db.transaction('documents').objectStore('documents').getAll(); read.onsuccess = () => { db.close(); resolve(read.result); }; read.onerror = () => reject(read.error); }; }));
  const records = values.flatMap(value => { if (typeof value !== 'string') return []; const parsed = StoredLocalRecordSchema.safeParse(JSON.parse(value)); return parsed.success ? [parsed.data] : []; });
  expect(records).toHaveLength(3);
  for (const record of records) expect(record.session.upload).toMatchObject({ width:2048,height:1536 });
});
