import { afterAll, beforeAll, expect, it } from 'vitest';
import { build } from 'esbuild';
import { chromium, type Browser } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webServer } from '../../../../scripts/web-server.mjs';

let root = '', base = '', browser: Browser, server: ReturnType<typeof webServer>;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'solveflow-camera-resolution-'));
  await writeFile(join(root, 'index.html'), '<style>video{pointer-events:none}</style><div id="root"></div><script src="/probe.js"></script>');
  await build({ stdin: { contents: `import{createRoot}from'react-dom/client';import{useRef,useState}from'react';import{CameraPreview}from'./src/components/camera-preview.web.tsx';function App(){const ref=useRef(null),[open,setOpen]=useState(true);return <><button onClick={async()=>{const picture=await ref.current.takePictureAsync();Reflect.set(window,'picture',picture);}}>Capture</button><button onClick={()=>setOpen(false)}>Close</button>{open&&<CameraPreview ref={ref} facing="back" onReady={()=>document.body.dataset.ready='true'} onError={()=>document.body.dataset.failed='true'}/>}</>;}createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: join(process.cwd(), 'apps/mobile'), loader: 'tsx' }, outfile: join(root, 'probe.js'), bundle: true, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
  server = webServer(root); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('NO_PORT');
  base = 'http://127.0.0.1:' + address.port;
  browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
}, 30000);
afterAll(async () => { await browser?.close(); server?.closeAllConnections(); if (server) await new Promise<void>(resolve => server.close(() => resolve())); if (root) await rm(root, { recursive: true, force: true }); });
it('negotiates detailed video pixels, captures without upscaling and releases the camera', async () => {
  const page = await browser.newPage();
  try {
    await page.addInitScript(() => {
      const encode = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) {
        Reflect.set(window, 'captureCanvas', this); encode.call(this, callback, type, quality);
      };
    });
    await page.goto(base); await page.waitForFunction(() => document.body.dataset.ready === 'true');
    const stream = await page.locator('video').evaluateHandle(node => node instanceof HTMLVideoElement ? node.srcObject : null);
    const settings = await stream.evaluate(value => value instanceof MediaStream ? value.getVideoTracks()[0]?.getSettings() : null);
    expect(Math.max(settings?.width ?? 0, settings?.height ?? 0)).toBeGreaterThanOrEqual(1920);
    for (let index = 0; index < 6; index++) {
      await page.evaluate(() => Reflect.set(window, 'picture', null));
      await page.getByRole('button', { name: 'Capture', exact: true }).click();
      await page.waitForFunction(() => !!Reflect.get(window, 'picture'));
      const picture = await page.evaluate(() => {
        const picture = Reflect.get(window, 'picture'), canvas = Reflect.get(window, 'captureCanvas');
        const result = { width: picture.width, height: picture.height, bytes: picture.blob.size, canvasWidth: canvas.width, canvasHeight: canvas.height };
        URL.revokeObjectURL(picture.uri); return result;
      });
      expect(Math.max(picture.width, picture.height)).toBe(2048); expect(picture.bytes).toBeGreaterThan(1000);
      expect(picture.canvasWidth).toBe(0); expect(picture.canvasHeight).toBe(0);
    }
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('video'));
    expect(await stream.evaluate(value => value instanceof MediaStream && value.getTracks().every(track => track.readyState === 'ended'))).toBe(true);
    await stream.dispose();
  } finally { await page.close(); }
});
it('retains an undersized camera without enlarging its captured pixels', async () => {
  const page = await browser.newPage();
  try {
    await page.addInitScript(() => {
      const acquire = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: () => acquire({ audio: false, video: { width: { exact: 640 }, height: { exact: 480 } } }) });
    });
    await page.goto(base); await page.waitForFunction(() => document.body.dataset.ready === 'true');
    await page.getByRole('button', { name: 'Capture', exact: true }).click();
    await page.waitForFunction(() => !!Reflect.get(window, 'picture'));
    const size = await page.evaluate(() => { const picture = Reflect.get(window, 'picture'); return { width: picture.width, height: picture.height }; });
    expect(size).toEqual({ width: 640, height: 480 });
  } finally { await page.close(); }
});
