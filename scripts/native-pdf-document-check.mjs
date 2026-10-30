import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { expect } from '@playwright/test';
import { nativePdfFixture } from '../tests/native-pdf-fixture.ts';
import { questionsForBatchPrint, planBatchPrintCopies } from '../packages/client/dist/presentation.js';
const { unzipSync } = createRequire(new URL('../apps/mobile/package.json', import.meta.url))('fflate');

/** Exercise the exact packaged DOM worker, including its asynchronous native action bridge. */
export async function checkNativePdfDocument(browser, assets, document, output) {
  output = process.env.SOLVEFLOW_PDF_EVIDENCE ?? output;
  await mkdir(output, { recursive: true });
  const generator = await browser.newPage();
  const images = await generator.evaluate(() => [0, 1].map(index => {
    const canvas = window.document.createElement('canvas'); canvas.width = 600; canvas.height = 300;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = index ? '#bcd4ef' : '#fff'; ctx.fillRect(0, 0, 600, 300); ctx.fillStyle = '#111'; ctx.fillText(index ? 'SUPPLEMENT_CANARY' : 'SOURCE_CANARY', 20, 50);
    return canvas.toDataURL('image/jpeg');
  }));
  await generator.close();
  const snapshot = nativePdfFixture(images[0], images[1]);
  const copies = planBatchPrintCopies(questionsForBatchPrint(snapshot), [{ correct: 5, incorrect: 1, remark: 'native-a' }, { correct: 4, incorrect: 2, remark: 'native-b' }], [], 2345);
  for (const mode of ['answers', 'questions']) {
    const id = crypto.randomUUID();
    const payload = JSON.stringify({ schemaVersion: 1, snapshot, mode, markIncorrect: mode === 'answers', copies: mode === 'answers' ? copies : [], exportedAt: snapshot.exportedAt });
    let header; const chunks = []; const progress = []; const errors = []; const network = []; let completed = false; let offset = 0;
    const page = await browser.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
    await page.exposeFunction('pdfNativeAction', raw => {
      const message = JSON.parse(raw); if (message.type !== '$$native_action') return null;
      const { actionId, args } = message.data;
      assert.equal(args[0], id);
      if (actionId === 'onRead') { assert.equal(args[1], offset); const chunk = payload.slice(offset, offset + 32768); offset += chunk.length; return chunk; }
      if (actionId === 'onProgress') { progress.push(args[1]); return null; }
      if (actionId === 'onHeader') { header = args[1]; return null; }
      if (actionId === 'onChunk') { assert.equal(args[1], chunks.length); assert.ok(args[2].length <= 32768); chunks.push(Buffer.from(args[2], 'base64')); return null; }
      if (actionId === 'onComplete') { completed = true; return null; }
      if (actionId === 'onFailure') { errors.push(args[1]); return null; }
      throw new Error(`Unexpected action ${actionId}`);
    });
    await page.addInitScript(({ id }) => {
      window.ReactNativeWebView = {
        injectedObjectJson: () => JSON.stringify({ EXPO_DOM_HOST_OS: 'android', initialProps: { props: { id }, names: ['onRead', 'onProgress', 'onHeader', 'onChunk', 'onComplete', 'onFailure'] } }),
        postMessage: raw => { const message = JSON.parse(raw); void window.pdfNativeAction(raw).then(result => { if (message.type === '$$native_action') window.dispatchEvent(new CustomEvent('$$dom_event', { detail: { type: '$$native_action_result', data: { uid: message.data.uid, actionId: message.data.actionId, result } } })); }); },
      };
    }, { id });
    await page.goto(pathToFileURL(join(assets, document)).href);
    await expect.poll(() => completed || errors.length > 0, { timeout: 90000 }).toBe(true);
    assert.deepEqual(errors, []); assert.ok(completed); assert.deepEqual(network, []);
    const data = Buffer.concat(chunks); assert.equal(data.length, header.bytes);
    const files = mode === 'answers' ? Object.entries(unzipSync(data)) : [[header.name, data]];
    assert.equal(files.length, mode === 'answers' ? 2 : 1);
    for (const [index, [name, bytes]] of files.entries()) {
      const path = join(output, `native-${mode}-${index + 1}.pdf`); await writeFile(path, bytes);
      assert.equal(Buffer.from(bytes).subarray(0, 5).toString(), '%PDF-');
      const structure = JSON.parse(execFileSync('python3', ['-c', 'import pymupdf as fitz,sys,json; d=fitz.open(sys.argv[1]); print(json.dumps({"text":"".join(p.get_text() for p in d),"pages":len(d),"bookmarks":len(d.get_toc()),"sourceImages":len({x[0] for p in d for x in p.get_images() if x[2]==600 and x[3]==300}),"links":sum(len(p.get_links()) for p in d)}))', path], { encoding: 'utf8' }));
      const text = structure.text;
      assert.ok(text.includes('Synthetic item 1')); assert.ok(text.includes('Synthetic item 6')); assert.ok(text.includes('Long original paragraph for pagination.'));
      assert.equal(text.includes('ANSWER_CANARY'), mode === 'answers');
      assert.ok(structure.pages > 2); assert.equal(structure.bookmarks, mode === 'answers' ? 7 : 6); assert.ok(structure.sourceImages >= 2);
      if (mode === 'answers') { assert.ok(structure.links >= 6); assert.match(name, /^native-[ab]_\d{8}-\d{6}\.pdf$/); }
      console.log(`PASS: packaged native ${mode} PDF ${index + 1}, source/supplement images, long text, ${structure.bookmarks} bookmarks, ${structure.links} links.`);
    }
    assert.ok(progress.some(value => /第 \d+ \/ \d+ 页/.test(value)));
    await page.close();
  }
}
