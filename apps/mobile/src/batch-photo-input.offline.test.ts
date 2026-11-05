import { afterAll, beforeAll, expect, it } from 'vitest';
import { build } from 'esbuild';
import { chromium, type Browser } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareImageCodec } from '../../../scripts/prepare-image-codec.mjs';
import { webServer } from '../../../scripts/web-server.mjs';
let root = '', base = '', browser: Browser, server: ReturnType<typeof webServer>, codecRequests = 0;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'solveflow-batch-photo-input-')); await prepareImageCodec(root);
  await writeFile(join(root, 'index.html'), '<script src="/probe.js"></script>');
  await build({ stdin: { contents: `import{pickPhotos,transformPhoto,releasePhoto}from'./src/platform.web.ts';import{BatchCaptureBuffer}from'./src/batch-capture-buffer.ts';Reflect.set(window,'probe',{pickPhotos,transformPhoto,releasePhoto,BatchCaptureBuffer});`, resolveDir: join(process.cwd(), 'apps/mobile') }, outfile: join(root, 'probe.js'), bundle: true, platform: 'browser' });
  server = webServer(root); server.on('request', request => { if (request.url === '/heic-codec-1-23-5.js') codecRequests++; }); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('NO_PORT'); base = 'http://127.0.0.1:' + address.port;
  browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
}, 30000);
afterAll(async () => { await browser?.close(); server?.closeAllConnections(); if (server) await new Promise<void>(resolve => server.close(() => resolve())); if (root) await rm(root, { recursive: true, force: true }); });
it('imports four 24/48MP JPEG and HEIC photos before crop validation and saves beyond the three-photo buffer', async () => {
  const page = await browser.newPage(), errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(base);
    const picker = page.waitForEvent('filechooser'); await page.evaluate(() => { Reflect.set(window, 'picked', Reflect.get(window, 'probe').pickPhotos(10)); });
    const names = ['24mp.jpg', '48mp.jpg', '24mp.heic', '48mp.heic'];
    await (await picker).setFiles(await Promise.all(names.map(async name => ({ name, mimeType: name.endsWith('jpg') ? 'image/jpeg' : 'image/heic', buffer: await readFile(join(process.cwd(), 'tests/fixtures/images', name)) }))));
    const result = await page.evaluate(async () => {
      const api = Reflect.get(window, 'probe'), photos = await Reflect.get(window, 'picked');
      const saved: { width: number; height: number }[] = [], enqueued: string[] = [], failures: string[] = [];
      const queue = new api.BatchCaptureBuffer({ prepare: api.transformPhoto, persist: async (photo: { width: number; height: number }) => { saved.push({ width: photo.width, height: photo.height }); return 'photo-' + saved.length; }, enqueue: async (id: string) => { enqueued.push(id); }, saved() {}, release: api.releasePhoto, failed: (e: Error) => failures.push(e.message), changed() {} });
      const previews = photos.map((row: { photo: { width: number; height: number } }) => ({ width: row.photo.width, height: row.photo.height }));
      for (const row of photos) { if (!queue.add(row.photo)) throw new Error('CAPTURE_REJECTED'); if (!await queue.flush()) throw new Error('CAPTURE_FAILED'); }
      await queue.dispose(); return { previews, saved, enqueued, failures };
    });
    expect(result.previews).toEqual(Array.from({ length: 4 }, () => ({ width: 4096, height: 3072 })));
    expect(result.saved).toEqual(Array.from({ length: 4 }, () => ({ width: 2048, height: 1536 })));
    expect(codecRequests).toBe(1); expect(result.enqueued).toHaveLength(4); expect(result.failures).toEqual([]); expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 45000);
