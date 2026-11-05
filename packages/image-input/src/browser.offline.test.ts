import { afterAll, beforeAll, expect, it } from 'vitest';
import { build } from 'esbuild';
import { chromium, webkit, type Browser, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareImageCodec } from '../../../scripts/prepare-image-codec.mjs';
import { webServer } from '../../../scripts/web-server.mjs';
let root = '', base = '', browser: Browser, server: ReturnType<typeof webServer>;
const fixture = (name: string) => join(process.cwd(), 'tests/fixtures/images', name);
const errors: string[] = [];
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'solveflow-heic-'));
  await prepareImageCodec(root);
  await writeFile(join(root, 'index.html'), '<html><body><script src="/probe.js"></script></body></html>');
  await build({ stdin: { contents: `import{browserImage}from'@solveflow/image-input';import{samplePhoto,pickPhoto,pickPhotos,transformPhoto,photoData,releasePhoto}from'./src/platform.web.ts';import{preparePhoto}from'../photo-web/src/browser/photo.ts';globalThis.probe={browserImage,samplePhoto,pickPhoto,pickPhotos,transformPhoto,photoData,releasePhoto,preparePhoto};`, resolveDir: join(process.cwd(), 'apps/mobile') }, outfile: join(root, 'probe.js'), bundle: true, platform: 'browser', target: 'chrome110' });
  server = webServer(root); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('NO_PORT');
  base = 'http://127.0.0.1:' + address.port;
  browser = process.env.SOLVEFLOW_TEST_ENGINE === 'webkit' ? await webkit.launch({ headless: true }) : await chromium.launch({ executablePath: process.env.SOLVEFLOW_TEST_CHROME ?? '/usr/bin/google-chrome', headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); server?.closeAllConnections(); if (server) await new Promise<void>(resolve => server.close(() => resolve())); if (root) await rm(root, { recursive: true, force: true }); });
async function page() { const page = await browser.newPage(); page.on('pageerror', error => errors.push(error.message)); await page.goto(base); return page; }
async function inspect(page: Page, name: string, type = '') {
  const bytes = [...await readFile(fixture(name))];
  return page.evaluate(async ({ bytes, name, type }) => {
    const { browserImage } = Reflect.get(window, 'probe');
    const file = new File([new Uint8Array(bytes)], name, { type });
    const source: Blob = await browserImage(file, { maxBytes: 10 * 1024 * 1024, maxPixels: 20_000_000 });
    const bitmap = await createImageBitmap(source), canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height; const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0);
    const color = [...ctx.getImageData(30, 30, 1, 1).data];
    const out = { width: bitmap.width, height: bitmap.height, type: source.type, color }; bitmap.close(); canvas.width = canvas.height = 0; return out;
  }, { bytes, name, type });
}
it('keeps wide-image text edges sharp without shrinking below the requested preview first', async () => {
  const p = await page();
  try {
    const result = await p.evaluate(async () => {
      const source = document.createElement('canvas'); source.width = 8192; source.height = 2560;
      const context = source.getContext('2d')!; context.fillStyle = '#fff'; context.fillRect(0, 0, source.width, source.height);
      context.fillStyle = '#000'; for (let x = 0; x < source.width; x += 64) context.fillRect(x, 0, 32, source.height);
      const input = await new Promise<Blob>(resolve => source.toBlob(blob => resolve(blob!), 'image/png'));
      source.width = source.height = 0;
      const output = await Reflect.get(window, 'probe').browserImage(input, { maxBytes: 32 * 1024 * 1024, maxPixels: 20_000_000 });
      const bitmap = await createImageBitmap(output), canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const pixels = canvas.getContext('2d')!; pixels.drawImage(bitmap, 0, 0);
      const contrast = pixels.getImageData(16, 50, 1, 1).data[0]! - pixels.getImageData(15, 50, 1, 1).data[0]!;
      const size = { width: bitmap.width, height: bitmap.height }; bitmap.close(); canvas.width = canvas.height = 0;
      return { ...size, contrast };
    });
    expect(result).toMatchObject({ width: 4096, height: 1280 }); expect(result.contrast).toBeGreaterThan(210);
  } finally { await p.close(); }
}, 30000);
it('decodes real HEIC, empty MIME, rotated primary and multiple images under production CSP', async () => {
  const p = await page();
  try {
    expect(await inspect(p, 'synthetic.heic')).toMatchObject({ width: 480, height: 320, type: 'image/jpeg' });
    expect(await inspect(p, 'synthetic.heic', 'image/heic')).toMatchObject({ width: 480, height: 320 });
    const rotated = await inspect(p, 'rotated.heic'); expect(rotated).toMatchObject({ width: 320, height: 480 }); expect(rotated.color[2]).toBeGreaterThan(200);
    const primary = await inspect(p, 'primary-second.heic'); expect(primary).toMatchObject({ width: 128, height: 96 }); expect(primary.color[0]).toBeGreaterThan(200); expect(primary.color[1]).toBeGreaterThan(200);
  } finally { await p.close(); }
});
it('keeps the bitmap fallback and high-resolution EXIF orientation when OffscreenCanvas is unavailable', async () => {
  const p = await page();
  try {
    await p.route('**/heic-worker-1-23-5.js', async route => route.fulfill({ contentType: 'text/javascript', body: 'self.OffscreenCanvas=undefined;\n' + await readFile(join(root, 'heic-worker-1-23-5.js'), 'utf8') }));
    expect(await inspect(p, 'rotated.heic')).toMatchObject({ width: 320, height: 480, type: 'image/jpeg' });
    expect(await inspect(p, '24mp-rotated.jpg', 'image/jpeg')).toMatchObject({ width: 3072, height: 4096, type: 'image/jpeg' });
  } finally { await p.close(); }
});
it('imports single, batch and supplementary picker paths and keeps original batch sizes', async () => {
  const p = await page();
  try {
    for (const batch of [false, true]) {
      const chooser = p.waitForEvent('filechooser');
      await p.evaluate(batch => { const api = Reflect.get(window, 'probe'); Reflect.set(window, 'picked', batch ? api.pickPhotos(7) : api.pickPhoto()); }, batch);
      await (await chooser).setFiles(batch ? [fixture('synthetic.heic'), fixture('rotated.heic')] : fixture('synthetic.heic'));
      const result = await p.evaluate(async () => {
        const api = Reflect.get(window, 'probe'), result = await Reflect.get(window, 'picked');
        const photos = Array.isArray(result) ? result : [{ photo: result }], out = [];
        for (const entry of photos) { const photo = await api.transformPhoto(entry.photo); out.push({ sourceBytes: entry.sourceBytes ?? null, fileName: entry.fileName ?? null, type: photo.blob.type, width: photo.width, height: photo.height, dataPrefix: (await api.photoData(photo)).slice(0, 23) }); api.releasePhoto(photo); api.releasePhoto(entry.photo); }
        return out;
      });
      expect(result).toHaveLength(batch ? 2 : 1); expect(result[0]).toMatchObject({ type: 'image/jpeg', width: 480, height: 320, dataPrefix: 'data:image/jpeg;base64,' });
      if (batch) { expect(result[0]!.sourceBytes).toBe((await readFile(fixture('synthetic.heic'))).length); expect(result[1]).toMatchObject({ width: 320, height: 480, fileName: 'rotated.heic' }); }
    }
  } finally { await p.close(); }
});
it('prepares the public app photo as normalized JPEG, rejects corrupt and oversized pixel output', async () => {
  const p = await page(); const bytes = [...await readFile(fixture('synthetic.heic'))];
  try {
    const result = await p.evaluate(async bytes => {
      const api = Reflect.get(window, 'probe'), file = new File([new Uint8Array(bytes)], 'photo.HEIC');
      const publicPhoto = await api.preparePhoto(file);
      let pixels = '', corrupt = '';
      try { await api.browserImage(file, { maxBytes: file.size, maxPixels: 10 }); } catch (e) { pixels = e instanceof Error ? e.message : ''; }
      try { await api.browserImage(new File([new Uint8Array(bytes.slice(0, 40))], 'broken.heic', { type: 'image/heic' }), { maxBytes: 100, maxPixels: 20000000 }); } catch (e) { corrupt = e instanceof Error ? e.message : ''; }
      return { prefix: publicPhoto.image.slice(0, 23), width: publicPhoto.width, height: publicPhoto.height, pixels, corrupt };
    }, bytes);
    expect(result).toMatchObject({ prefix: 'data:image/jpeg;base64,', width: 480, height: 320, pixels: expect.stringContaining('分辨率过高'), corrupt: expect.stringContaining('损坏') });
    expect(errors).toEqual([]);
  } finally { await p.close(); }
});
it('shrinks 24/48MP camera originals before editor/storage contracts without changing orientation', async () => {
  const p = await page();
  try {
    for (const name of ['24mp.heic', '48mp.heic', '24mp.jpg', '48mp.jpg', '24mp-rotated.jpg']) {
      const bytes = [...await readFile(fixture(name))];
      const result = await p.evaluate(async ({ bytes, name }) => {
        const api = Reflect.get(window, 'probe');
        const photo = await api.samplePhoto(new File([new Uint8Array(bytes)], name, { type: name.endsWith('.jpg') ? 'image/jpeg' : 'image/heic' }));
        const out = { width: photo.width, height: photo.height, type: photo.blob.type }; api.releasePhoto(photo); return out;
      }, { bytes, name });
      expect(result).toEqual({ width: name.includes('rotated') ? 3072 : 4096, height: name.includes('rotated') ? 4096 : 3072, type: 'image/jpeg' });
    }
    const bytes = [...await readFile(fixture('48mp.heic'))];
    const publicPhoto = await p.evaluate(async bytes => {
      const result = await Reflect.get(window, 'probe').preparePhoto(new File([new Uint8Array(bytes)], '48mp.heic', { type: 'image/heic' }));
      return { width: result.width, height: result.height, imageBytes: atob(result.image.split(',')[1]).length };
    }, bytes);
    expect(publicPhoto.width).toBe(2048); expect(publicPhoto.height).toBe(1536); expect(publicPhoto.imageBytes).toBeLessThanOrEqual(4 * 1024 * 1024);
  } finally { await p.close(); }
}, 45000);
