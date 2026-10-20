import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { installPdfCodecProbe, type PdfCodecPhase } from './pdf-codec-probe.js';
import { ExportTaskSchema, LocalRecordSchema } from '../../packages/contracts/dist/local.js';
import { trackExportRenders } from './export-render-probe.js';
const batchId = '93000000-0000-4000-8000-000000000001';
const sessionId = '93100000-0000-4000-8000-000000000001';
async function seed(page: Page) {
  let calls = 0; page.route('**/__solveflow/web-env/model/**', route => { calls++; return route.abort(); });
  await page.goto('/'); await expect(page.getByTestId('launch-screen')).toBeHidden();
  await page.evaluate(({ batchId, sessionId }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('solveflow-local', 1); request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result; const tx = db.transaction('documents', 'readwrite'); const store = tx.objectStore('documents');
      const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 550;
      const context = canvas.getContext('2d'); if (!context) throw new Error('CANVAS');
      context.fillStyle = '#fff'; context.fillRect(0, 0, 900, 550); context.fillStyle = '#111'; context.font = '28px sans-serif'; context.fillText('Saved question and diagram', 20, 80); context.fillStyle = '#b51b20'; context.fillRect(480, 180, 250, 250);
      const image = canvas.toDataURL('image/jpeg'); const createdAt = '2026-10-13T03:00:00.000Z';
      for (const position of [1, 2]) {
        const id = position === 1 ? sessionId : '93100000-0000-4000-8000-000000000002';
        const candidate = { schemaVersion: 1, kind: 'answer', problem: { text: `Question ${position}: select one.`, subject: 'math', uncertainties: [], options: [{ label: 'A', text: 'one' }, { label: 'B', text: 'two' }, { label: 'C', text: 'three' }] }, answer: 'Original saved answer.', selectedOptions: ['B'], steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
        const outcome = { schemaVersion: 1, status: 'completed', candidate, verified: false, verification: null, verificationStatus: 'not_requested', warning: null };
        const session = { schemaVersion: 1, id, subject: 'math', createdAt, upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: 2000, width: 900, height: 550, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` }, runs: [{ schemaVersion: 1, id, sessionId: id, createdAt, seq: 1, status: 'completed', message: '', outcome }] };
        store.put(JSON.stringify({ schemaVersion: 1, session, image, batch: { id: batchId, title: 'Background PDF', createdAt, exam: 'general', position } }), `record.${id}`);
      }
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }), { batchId, sessionId });
  await page.goto(`/?session=${sessionId}`); await expect(page.getByTestId('current-batch')).toBeVisible();
  return () => calls;
}
async function openExport(page: Page) { await page.getByRole('button', { name: '批次操作', exact: true }).click(); await page.getByRole('button', { name: '导出本批 PDF', exact: true }).click(); await page.getByRole('button', { name: '已保存内容', exact: true }).click(); await expect(page.getByRole('button', { name: '后台导出', exact: true })).toBeEnabled(); }
async function openRecords(page: Page) { await page.getByRole('tab', { name: '我的', exact: true }).click(); await page.getByRole('button', { name: /^导出记录/ }).click(); await expect(page.getByRole('dialog', { name: '导出记录', exact: true })).toBeVisible(); }
async function history(page: Page) { return page.evaluate(() => new Promise<string[]>((resolve, reject) => { const request = indexedDB.open('solveflow-local'); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result; const tx = db.transaction('documents'); const read = tx.objectStore('documents').getAll(); tx.oncomplete = () => { db.close(); resolve(read.result.filter((value: unknown): value is string => typeof value === 'string' && value.includes('"session"'))); }; tx.onerror = () => { db.close(); reject(tx.error); }; }; })); }

for (const failure of ['storage', 'cancel'] as const) test(`initial export read ${failure} recovers in place without replaying models or queueing failed work`, async ({ page }, info) => {
  const calls = await seed(page); const before = await history(page); let downloads = 0; const errors: string[] = [];
  page.on('download', () => { downloads++; }); page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: '批次操作', exact: true }).click();
  await page.evaluate(failure => {
    const transaction = IDBDatabase.prototype.transaction;
    const descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete');
    const get = descriptor?.get; const set = descriptor?.set; if (!get || !set) throw new Error('TRANSACTION_COMPLETION_DESCRIPTOR');
    let remaining = failure === 'storage' ? 2 : 0; let failed = 0; let held = 0; let holdNext = true; let release = () => {};
    Object.defineProperty(window, '__initialReadRecovery', { value: { state: () => ({ failed, held }), release: () => release() } });
    IDBDatabase.prototype.transaction = function(this: IDBDatabase, stores, mode, options) {
      const names = typeof stores === 'string' ? [stores] : Array.from(stores);
      const target = this.name === 'solveflow-local' && (mode === undefined || mode === 'readonly') && names.includes('documents');
      if (target && remaining > 0) { remaining--; failed++; throw new DOMException('TEST_READ_FAILURE', 'UnknownError'); }
      const tx = Reflect.apply(transaction, this, [stores, mode, options]);
      if (target && holdNext) {
        holdNext = false;
        Object.defineProperty(tx, 'oncomplete', { configurable: true, get() { return Reflect.apply(get, this, []); }, set(handler: unknown) {
          Reflect.apply(set, this, [typeof handler === 'function' ? function(this: IDBTransaction, event: Event) {
            held++; let delivered = false;
            release = () => { if (!delivered) { delivered = true; Reflect.apply(handler, this, [event]); } };
          } : handler]);
        } });
      }
      return tx;
    };
  }, failure);
  const state = () => page.evaluate(() => Reflect.get(window, '__initialReadRecovery').state());
  const stored = async () => {
    const rows: unknown = await page.evaluate(() => new Promise<unknown[]>((resolve, reject) => {
      const request = indexedDB.open('solveflow-exports'); request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result; const tx = db.transaction('records'); const read = tx.objectStore('records').getAll();
        tx.oncomplete = () => { db.close(); resolve(read.result); }; tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
      };
    }));
    if (!Array.isArray(rows)) throw new Error('EXPORT_RECORDS'); return rows.map(row => ExportTaskSchema.parse(row));
  };
  const retry = page.getByRole('button', { name: '重试读取题目', exact: true });
  try {
    await page.getByRole('button', { name: '导出本批 PDF', exact: true }).click();
    if (failure === 'storage') {
      for (const failed of [1, 2]) {
        await expect(page.getByRole('alert')).toBeVisible(); await expect(page.getByTestId('pdf-operation-feedback')).toBeFocused();
        await expect.poll(state).toEqual({ failed, held: 0 }); await expect(retry).toBeVisible(); await expect(retry).toBeInViewport({ ratio: 1 });
        await expect(page.getByTestId('pdf-batch-summary')).toHaveCount(0);
        await retry.evaluate(node => { if (!(node instanceof HTMLElement)) throw new Error('RETRY_BUTTON'); node.click(); node.click(); });
      }
      await expect.poll(state).toEqual({ failed: 2, held: 1 });
      await expect(page.getByRole('button', { name: '取消导出', exact: true })).toBeVisible();
    } else {
      await expect.poll(state).toEqual({ failed: 0, held: 1 });
      await page.getByRole('button', { name: '取消导出', exact: true }).click();
      await expect(page.getByRole('button', { name: '正在取消…', exact: true })).toBeDisabled();
      await page.evaluate(() => Reflect.get(window, '__initialReadRecovery').release());
      await expect(retry).toBeVisible(); await expect(page.getByRole('alert')).toHaveCount(0);
      await retry.click();
    }
    await page.evaluate(() => Reflect.get(window, '__initialReadRecovery').release());
    await expect(page.getByTestId('pdf-batch-summary')).toContainText('Background PDF');
    await expect(page.getByTestId('pdf-batch-summary')).toContainText('共 2 题'); await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: '导出 PDF', exact: true })).toBeVisible(); await expect(retry).toHaveCount(0);
    expect(downloads).toBe(0); expect(calls()).toBe(0); expect(await stored()).toEqual([]); await expect(page.locator('iframe[title="批次 PDF 打印"]')).toHaveCount(0);
    await page.getByRole('button', { name: '已保存内容', exact: true }).click();
    const waiting = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF', exact: true }).click();
    const file = info.outputPath(`initial-read-${failure}.pdf`); await (await waiting).saveAs(file); const bytes = await readFile(file);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-'); expect(bytes.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(2);
    expect(downloads).toBe(1); expect(calls()).toBe(0); expect(errors).toEqual([]); expect(await history(page)).toEqual(before);
    expect(await stored()).toMatchObject([{ status: 'succeeded', questionCount: 2 }]);
    await expect(page.locator('iframe[title="批次 PDF 打印"]')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`initial-read-${failure}-recovered.png`) });
  } finally { await page.evaluate(() => Reflect.get(window, '__initialReadRecovery').release()).catch(() => undefined); }
});

for (const { phase, failAck } of [{ phase: 'synchronous', failAck: false }, { phase: 'microtask', failAck: false }, { phase: 'microtask', failAck: true }]) test(`cancels at ${phase} dispatch publication without entering aborted preparation${failAck ? ' and recovers committed cancellation acknowledgement failure' : ''}`, async ({ page }, info) => {
  const calls = await seed(page); const before = await history(page); await openExport(page); const errors: string[] = []; let downloads = 0; let renderers = 0;
  page.on('pageerror', error => errors.push(error.message)); page.on('download', () => { downloads++; }); await page.route('**/html2canvas-*.js', async route => { renderers++; await route.continue(); });
  await page.evaluate(({ phase, failAck }) => {
    const freeze = Object.getOwnPropertyDescriptor(Object, 'freeze'); if (!freeze) throw new Error('FREEZE_DESCRIPTOR_MISSING');
    const abort = AbortController.prototype.abort; const check = AbortSignal.prototype.throwIfAborted; const put = IDBObjectStore.prototype.put;
    const state: { armed: boolean; triggered: boolean; failAck: boolean; committed: unknown; signals: AbortSignal[]; abortedChecks: number; writes: string[]; restore: () => void } = { armed: true, triggered: false, failAck, committed: null, signals: [], abortedChecks: 0, writes: [], restore: () => {} };
    state.restore = () => { Object.defineProperty(Object, 'freeze', freeze); AbortController.prototype.abort = abort; AbortSignal.prototype.throwIfAborted = check; IDBObjectStore.prototype.put = put; };
    Object.defineProperty(window, '__dispatchProbe', { value: state });
    AbortController.prototype.abort = function (...args: Parameters<AbortController['abort']>) { if (state.triggered && !state.signals.includes(this.signal)) state.signals.push(this.signal); return Reflect.apply(abort, this, args); };
    AbortSignal.prototype.throwIfAborted = function () { if (this.aborted && this === state.signals[1]) state.abortedChecks++; return Reflect.apply(check, this, []); };
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      const value: unknown = args[0]; const record = this.transaction.db.name === 'solveflow-exports' && this.name === 'records' && value && typeof value === 'object' && 'status' in value && typeof value.status === 'string';
      if (record && typeof value.status === 'string') state.writes.push(value.status); const result = Reflect.apply(put, this, args);
      if (record && value.status === 'cancelled' && state.failAck) {
        const tx = this.transaction; const failure = tx.onerror;
        tx.oncomplete = () => { state.committed = structuredClone(value); setTimeout(() => failure?.call(tx, new Event('error')), 20); };
      }
      return result;
    };
    Object.defineProperty(Object, 'freeze', { ...freeze, value: (value: unknown) => {
      const frozen = Reflect.apply(freeze.value, Object, [value]);
      if (state.armed && Array.isArray(value) && value.some(task => task && typeof task === 'object' && task.schemaVersion === 1 && task.status === 'running' && task.progress === '正在导出')) {
        state.armed = false; state.triggered = true;
        const cancel = () => { const button = [...document.querySelectorAll('button,[role="button"]')].find(value => value.textContent?.trim() === '取消导出'); if (!(button instanceof HTMLElement)) throw new Error('CANCEL_BUTTON_MISSING'); button.click(); };
        if (phase === 'synchronous') cancel(); else queueMicrotask(cancel);
      }
      return frozen;
    } });
  }, { phase, failAck });
  try {
    await page.getByRole('button', { name: '下载 PDF', exact: true }).click(); await expect(page.getByText('导出已取消。', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '下载 PDF', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => { const state = Reflect.get(window, '__dispatchProbe'); return { triggered: state.triggered, abortedChecks: state.abortedChecks, signals: state.signals.length, writes: state.writes }; })).toEqual({ triggered: true, abortedChecks: 0, signals: 2, writes: ['queued', 'running', 'cancelled'] });
    expect(renderers).toBe(0); expect(downloads).toBe(0); expect(calls()).toBe(0); expect(errors).toEqual([]); expect(await history(page)).toEqual(before);
    await expect(page.locator('div[inert][style*="-10000px"],iframe[title="批次 PDF 打印"]')).toHaveCount(0); await page.screenshot({ path: info.outputPath('dispatch-cancelled.png') });
    if (failAck) {
      const committed = ExportTaskSchema.parse(await page.evaluate(() => Reflect.get(window, '__dispatchProbe').committed));
      await page.getByRole('button', { name: '关闭导出', exact: true }).click(); await openRecords(page); const row = page.getByTestId('export-record'); await expect(row).toContainText('等待保存');
      await page.evaluate(() => { Reflect.get(window, '__dispatchProbe').failAck = false; }); await row.getByRole('button', { name: '重试保存', exact: true }).click();
      await expect(row.getByRole('button', { name: '重试保存', exact: true })).toHaveCount(0); await expect(row).toContainText('已取消');
      const persisted = await page.evaluate(id => new Promise<unknown>((resolve, reject) => { const request = indexedDB.open('solveflow-exports'); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result; const tx = db.transaction('records'); const read = tx.objectStore('records').get(id); tx.oncomplete = () => { db.close(); resolve(read.result); }; tx.onerror = () => { db.close(); reject(tx.error); }; }; }), committed.id);
      expect(ExportTaskSchema.parse(persisted)).toEqual(committed); expect(renderers).toBe(0); expect(downloads).toBe(0); expect(calls()).toBe(0); expect(errors).toEqual([]); await page.screenshot({ path: info.outputPath('dispatch-cancel-recovered.png') });
    }
  } finally { await page.evaluate(() => Reflect.get(window, '__dispatchProbe').restore()); }
});

for (const background of [false, true]) for (const failCancel of [false, true]) test(`${background ? 'background' : 'foreground'} cancels during the queued storage acknowledgement and retries ${failCancel ? 'failed cancellation storage' : 'a new export'}`, async ({ page }, info) => {
  const calls = await seed(page); const before = await history(page); await openExport(page);
  const errors: string[] = []; let downloads = 0; let renderers = 0;
  page.on('pageerror', error => errors.push(error.message)); page.on('download', () => { downloads++; });
  await page.route('**/html2canvas-*.js', async route => { renderers++; await route.continue(); });
  await page.evaluate(failCancel => {
    const state = { held: false, armed: true, failCancel, writes: [] as string[], release: null as (() => void) | null };
    Object.defineProperty(window, '__queuedWrite', { value: state });
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      const value: unknown = args[0];
      if (this.transaction.db.name !== 'solveflow-exports' || this.name !== 'records' || !value || typeof value !== 'object' || !('status' in value) || typeof value.status !== 'string') return Reflect.apply(original, this, args);
      state.writes.push(value.status);
      if (value.status === 'cancelled' && state.failCancel) throw new DOMException('Synthetic cancellation storage failure', 'QuotaExceededError');
      const request = Reflect.apply(original, this, args);
      if (value.status === 'queued' && state.armed) {
        state.armed = false; const tx = this.transaction; const complete = tx.oncomplete;
        tx.oncomplete = event => { state.held = true; state.release = () => { state.release = null; complete?.call(tx, event); }; };
      }
      return request;
    };
  }, failCancel);
  await page.getByRole('button', { name: background ? '后台导出' : '下载 PDF', exact: true }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, '__queuedWrite').held)).toBe(true);
  await page.getByRole('button', { name: '取消导出', exact: true }).click();
  const cancelling = page.getByRole('button', { name: '正在取消…', exact: true }); await expect(cancelling).toBeVisible(); await expect(cancelling).toBeDisabled(); await expect(cancelling).toBeInViewport({ ratio: 1 });
  await expect(page.getByText('正在取消导出…', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, '__queuedWrite').writes)).toEqual(['queued']);
  await expect(page.locator('div[inert][style*="-10000px"]')).toHaveCount(0); await expect(page.locator('iframe[title="批次 PDF 打印"]')).toHaveCount(0);
  expect(renderers).toBe(0); expect(downloads).toBe(0);
  await page.screenshot({ path: info.outputPath('queued-cancelling.png') });
  await page.evaluate(() => Reflect.get(window, '__queuedWrite').release());
  await expect(page.getByText('导出已取消。', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: '下载 PDF', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '关闭导出', exact: true }).click(); await openRecords(page);
  const cancelled = page.getByTestId('export-record'); await expect(cancelled).toHaveAttribute('data-status', 'cancelled');
  if (failCancel) {
    await expect(cancelled).toContainText('等待保存'); await page.evaluate(() => { Reflect.get(window, '__queuedWrite').failCancel = false; });
    await cancelled.getByRole('button', { name: '重试保存', exact: true }).click(); await expect(cancelled).toContainText('已取消');
    await expect(cancelled.getByRole('button', { name: '重试保存', exact: true })).toHaveCount(0);
  }
  expect(await page.evaluate(() => Reflect.get(window, '__queuedWrite').writes)).toEqual(failCancel ? ['queued', 'cancelled', 'cancelled'] : ['queued', 'cancelled']);
  expect(renderers).toBe(0); expect(downloads).toBe(0); expect(calls()).toBe(0);
  const key = await cancelled.getAttribute('data-export-id'); if (!key) throw new Error('CANCELLED_TASK_MISSING');
  await cancelled.getByRole('button', { name: '重新导出', exact: true }).click();
  await page.getByRole('button', { name: '已保存内容', exact: true }).click();
  const waiting = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF', exact: true }).click(); const download = await waiting;
  const file = info.outputPath('after-admission-cancel.pdf'); await download.saveAs(file); const bytes = await readFile(file);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-'); expect(bytes.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(2);
  expect(downloads).toBe(1); expect(calls()).toBe(0); expect(errors).toEqual([]); expect(await history(page)).toEqual(before);
  await expect(page.locator('div[inert][style*="-10000px"]')).toHaveCount(0); await expect(page.locator('iframe[title="批次 PDF 打印"]')).toHaveCount(0);
  const stored = await page.evaluate(() => new Promise<{ records: unknown[]; files: number; sizes: number }>((resolve, reject) => {
    const request = indexedDB.open('solveflow-exports'); request.onerror = () => reject(request.error);
    request.onsuccess = () => { const db = request.result; const tx = db.transaction(['records', 'files', 'sizes']); const records = tx.objectStore('records').getAll(); const files = tx.objectStore('files').count(); const sizes = tx.objectStore('sizes').count(); tx.oncomplete = () => { db.close(); resolve({ records: records.result, files: files.result, sizes: sizes.result }); }; tx.onerror = () => { db.close(); reject(tx.error); }; };
  }));
  const tasks = stored.records.map(value => ExportTaskSchema.parse(value)); expect(tasks).toHaveLength(2); expect(tasks.find(value => value.id === key)?.status).toBe('cancelled');
  expect(tasks.filter(value => value.status === 'succeeded')).toHaveLength(1); expect(stored.files).toBe(1); expect(stored.sizes).toBe(1);
});

for (const background of [false, true]) for (const phase of [1, 2, 3, 4]) test(`${background ? 'background' : 'foreground'} cancels admission at task boundary ${phase} before queueing or rendering`, async ({ page }, info) => {
  const modelCalls = await seed(page); const before = await history(page); await openExport(page);
  await page.getByLabel('导出份数', { exact: true }).fill('20');
  const errors: string[] = []; let downloads = 0;
  page.on('pageerror', error => errors.push(error.message)); page.on('download', () => { downloads++; });
  const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.evaluate(target => {
    const state = { turns: 0, openPorts: 0, cancelled: false, beforeCancel: { roots: -1, frames: -1 } };
    Object.defineProperty(window, '__pdfAdmission', { value: state });
    const NativeChannel = window.MessageChannel;
    window.MessageChannel = class extends NativeChannel {
      constructor() {
        super(); let owned = false; let turn = 0; const closed = new Set<MessagePort>();
        const post = this.port2.postMessage;
        Object.defineProperty(this.port2, 'postMessage', { value: function (this: MessagePort, ...args: unknown[]) {
          if (args[0] === 'solveflow-pdf-admission') { owned = true; turn = ++state.turns; state.openPorts += 2; }
          return Reflect.apply(post, this, args);
        } });
        for (const port of [this.port1, this.port2]) {
          const close = port.close;
          Object.defineProperty(port, 'close', { value: function (this: MessagePort) {
            if (owned && !closed.has(this)) { closed.add(this); state.openPorts--; }
            return Reflect.apply(close, this, []);
          } });
        }
        this.port1.addEventListener('message', () => {
          if (!owned || turn !== target || state.cancelled) return;
          const cancel = [...document.querySelectorAll('button')].find(button => button.textContent === '取消导出');
          if (!cancel) throw new Error('CANCEL_CONTROL_MISSING');
          state.beforeCancel = { roots: document.querySelectorAll('div[inert][style*="-10000px"]').length, frames: document.querySelectorAll('iframe[title="批次 PDF 打印"]').length };
          state.cancelled = true; cancel.click();
        });
      }
    };
  }, phase);
  await page.getByRole('button', { name: background ? '后台导出' : '下载 PDF 压缩包', exact: true }).click();
  await expect(page.getByText('导出已取消。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '下载 PDF 压缩包', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => Reflect.get(window, '__pdfAdmission'))).toEqual({ turns: phase, openPorts: 0, cancelled: true, beforeCancel: { roots: 0, frames: 0 } });
  const stored = await page.evaluate(async () => {
    if (!(await indexedDB.databases()).some(database => database.name === 'solveflow-exports')) return [0, 0];
    return new Promise<number[]>((resolve, reject) => {
      const request = indexedDB.open('solveflow-exports'); request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result; const tx = db.transaction(['records', 'files']);
        const records = tx.objectStore('records').count(); const files = tx.objectStore('files').count();
        tx.oncomplete = () => { db.close(); resolve([records.result, files.result]); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
    });
  });
  expect(stored).toEqual([0, 0]); expect(modelCalls()).toBe(0); expect(downloads).toBe(0); expect(errors).toEqual([]); expect(await history(page)).toEqual(before);
  if (phase === 3) await page.screenshot({ path: info.outputPath('admission-cancelled.png') });
});

test('reading background export preserves unanswered records without answer planning or model requests', async ({ page }, info) => {
  const calls = await seed(page);
  const first = LocalRecordSchema.parse(JSON.parse((await history(page))[0]!));
  first.session.runs = [];
  await page.evaluate(({ id, value }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('solveflow-local'); request.onerror = () => reject(request.error);
    request.onsuccess = () => { const db = request.result; const tx = db.transaction('documents', 'readwrite'); tx.objectStore('documents').put(value, `record.${id}`); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); }; };
  }), { id: first.session.id, value: JSON.stringify(first) });
  await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible(); const before = await history(page);
  await page.getByRole('button', { name: '批次操作', exact: true }).click(); await page.getByRole('button', { name: '导出本批 PDF', exact: true }).click();
  await page.getByRole('button', { name: '原始记录', exact: true }).click(); await page.getByRole('button', { name: '后台导出', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '导出 PDF', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('导出任务通知')).toContainText('导出已完成', { timeout: 40000 });
  await openRecords(page); const record = page.getByTestId('export-record'); await expect(record).toHaveAttribute('data-status', 'succeeded');
  const waiting = page.waitForEvent('download'); await record.getByRole('button', { name: '下载文件', exact: true }).click(); const download = await waiting;
  expect(download.suggestedFilename()).toBe('Background PDF_原始记录.pdf'); const file = info.outputPath('reading.pdf'); await download.saveAs(file);
  const bytes = await readFile(file); expect(bytes.subarray(0, 5).toString()).toBe('%PDF-'); expect(bytes.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  expect(await history(page)).toEqual(before); expect(calls()).toBe(0);
  await expect(page.locator('iframe[title="批次 PDF 打印"]')).toHaveCount(0); await expect(page.locator('div[inert][style*="-10000px"]')).toHaveCount(0);
});

test('saved answers export in the background with zero model requests, survives navigation and downloads again after reload', async ({ page }, info) => {
  const calls = await seed(page); const before = await history(page); await openExport(page);
  await expect(page.getByRole('button', { name: '已保存内容', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '后台导出', exact: true }).click(); await expect(page.getByRole('dialog', { name: '导出 PDF', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: '历史题目', exact: true }).click(); await expect(page.getByRole('tab', { name: '历史题目', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('导出任务通知')).toContainText('导出已完成', { timeout: 40000 });
  await openRecords(page); const record = page.getByTestId('export-record'); await expect(record).toHaveAttribute('data-status', 'succeeded');
  await expect(record).toContainText('2 题'); await expect(record).toContainText('已保存内容');
  const waiting = page.waitForEvent('download'); await record.getByRole('button', { name: '下载文件', exact: true }).click(); const download = await waiting;
  expect(download.suggestedFilename()).toBe('Background PDF_作答_第01份_2题_对2_错0.pdf'); const file = info.outputPath('background.pdf'); await download.saveAs(file);
  const bytes = await readFile(file); expect(bytes.subarray(0, 5).toString()).toBe('%PDF-'); expect(bytes.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(2);
  expect(await history(page)).toEqual(before); expect(calls()).toBe(0); await expect(page.locator('iframe[title="批次 PDF 打印"]')).toHaveCount(0);
  await page.reload(); await expect(page.getByTestId('launch-screen')).toBeHidden(); await openRecords(page); await expect(page.getByTestId('export-record')).toHaveAttribute('data-status', 'succeeded');
  const again = page.waitForEvent('download'); await page.getByRole('button', { name: '下载文件', exact: true }).click(); const second = await again; await second.saveAs(info.outputPath('after-reload.pdf'));
  expect(await readFile(info.outputPath('after-reload.pdf'))).toEqual(bytes); expect(calls()).toBe(0);
  await page.getByLabel('搜索导出记录').fill('nothing-matches'); await expect(page.getByTestId('export-record')).toHaveCount(0); await page.getByLabel('搜索导出记录').clear();
  await page.getByRole('button', { name: '删除记录', exact: true }).click(); await page.getByRole('button', { name: '确认删除文件和记录', exact: true }).click(); await expect(page.getByTestId('export-record')).toHaveCount(0);
  const counts = await page.evaluate(() => new Promise<number[]>((resolve, reject) => { const request = indexedDB.open('solveflow-exports'); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result; const tx = db.transaction(['records', 'files', 'sizes']); const requests = ['records', 'files', 'sizes'].map(name => tx.objectStore(name).count()); tx.oncomplete = () => { db.close(); resolve(requests.map(value => value.result)); }; tx.onerror = () => { db.close(); reject(tx.error); }; }; }));
  expect(counts).toEqual([0, 0, 0]); expect(await history(page)).toEqual(before);
});

test('301 subquestions are blocked before preparation, rendering or queueing, in both paper modes', async ({ page }) => {
  const calls = await seed(page); const raw = (await history(page))[0]; const base = LocalRecordSchema.parse(raw ? JSON.parse(raw) : null);
  const rows = Array.from({ length: 100 }, (_, index) => {
    const id = `93100000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    const problem = { text: 'Grouped source.', subject: 'math', uncertainties: [] };
    const candidate = { schemaVersion: 1, kind: 'answer', problem, answer: 'Overview.', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [], questions: Array.from({ length: index === 99 ? 4 : 3 }, (_, question) => ({ number: question + 1, problem: { ...problem, text: `Subquestion ${question + 1}.` }, answer: 'Saved subanswer.', stepIds: [], figureIds: [] })) };
    const run = base.session.runs[0]; if (!run || !base.batch) throw new Error('FIXTURE_MISSING');
    return LocalRecordSchema.parse({ ...base, batch: { ...base.batch, position: index + 1 }, session: { ...base.session, id, upload: { ...base.session.upload, id }, runs: [{ ...run, id, sessionId: id, outcome: { schemaVersion: 1, status: 'completed', candidate, verified: false, verification: null, verificationStatus: 'not_requested', warning: null } }] } });
  });
  await page.evaluate(rows => new Promise<void>((resolve, reject) => { const request = indexedDB.open('solveflow-local'); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result; const tx = db.transaction('documents', 'readwrite'); for (const row of rows) tx.objectStore('documents').put(JSON.stringify(row), `record.${row.session.id}`); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); }; }), rows);
  await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible(); const before = await history(page); let renderers = 0; let downloads = 0;
  await page.route('**/html2canvas-*.js', route => { renderers++; return route.abort(); }); page.on('download', () => { downloads++; });
  await page.getByRole('button', { name: '批次操作', exact: true }).click(); await page.getByRole('button', { name: '导出本批 PDF', exact: true }).click(); await page.getByRole('button', { name: '已保存内容', exact: true }).click();
  for (const name of ['题目与作答', '纯题目']) {
    await page.getByRole('button', { name, exact: true }).click(); await expect(page.getByText('PDF 页数超过上限（每份 300 页），请按题目拆分后重试。', { exact: true })).toBeVisible();
    for (const action of ['打印 / 保存 PDF', '下载 PDF', '后台导出']) await expect(page.getByRole('button', { name: action, exact: true })).toBeDisabled();
  }
  expect(calls()).toBe(0); expect(renderers).toBe(0); expect(downloads).toBe(0); expect(await history(page)).toEqual(before); await expect(page.locator('iframe[title="批次 PDF 打印"]')).toHaveCount(0);
  await page.getByRole('button', { name: '关闭导出', exact: true }).click(); await openRecords(page); await expect(page.getByTestId('export-record')).toHaveCount(0);
});

test('cancellation during renderer loading prevents downloading or reviving a saved artifact', async ({ page }) => {
  const calls = await seed(page); const before = await history(page); await openExport(page);
  let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; }); let stalled = 0; let downloads = 0;
  page.on('download', () => { downloads++; }); await page.route('**/html2canvas-*.js', async route => { stalled++; await gate; await route.continue().catch(() => undefined); });
  try {
    await page.getByRole('button', { name: '后台导出', exact: true }).click(); await expect.poll(() => stalled).toBeGreaterThan(0);
    await openRecords(page); await page.getByRole('button', { name: '取消任务', exact: true }).click(); await expect(page.getByTestId('export-record')).toHaveAttribute('data-status', 'cancelled');
    release(); await expect(page.locator('iframe[title="批次 PDF 打印"]')).toHaveCount(0); await expect(page.getByRole('button', { name: '下载文件', exact: true })).toHaveCount(0);
    expect(downloads).toBe(0); expect(calls()).toBe(0); expect(await history(page)).toEqual(before);
    await page.reload(); await expect(page.getByTestId('launch-screen')).toBeHidden(); await openRecords(page); await expect(page.getByTestId('export-record')).toHaveAttribute('data-status', 'cancelled');
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }); }
});

test('cancels an actually started concurrent document before DOM commit or frame creation', async ({ page }, info) => {
  const calls = await seed(page); const base = LocalRecordSchema.parse(JSON.parse((await history(page))[0]!)); const run = base.session.runs[0];
  if (!run || !base.batch) throw new Error('FIXTURE_MISSING');
  const rows = Array.from({ length: 30 }, (_, index) => {
    const id = `93100000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    const problem = { text: 'Grouped mathematical source.', subject: 'math', uncertainties: [] };
    const candidate = { schemaVersion: 1, kind: 'answer', problem, answer: 'Overview.', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [], questions: Array.from({ length: 3 }, (_, question) => ({ number: question + 1, problem: { ...problem, text: `Subquestion ${question + 1}.\n\n$$\\sum_{i=1}^{n}\\frac{i^2+x_i^2}{\\sqrt{1+i^2}}$$` }, answer: 'Saved subanswer.', stepIds: [], figureIds: [] })) };
    return LocalRecordSchema.parse({ ...base, batch: { ...base.batch, position: index + 1 }, session: { ...base.session, id, upload: { ...base.session.upload, id }, runs: [{ ...run, id, sessionId: id, outcome: { schemaVersion: 1, status: 'completed', candidate, verified: false, verification: null, verificationStatus: 'not_requested', warning: null } }] } });
  });
  await page.evaluate(rows => new Promise<void>((resolve, reject) => { const request = indexedDB.open('solveflow-local'); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result; const tx = db.transaction('documents', 'readwrite'); for (const row of rows) tx.objectStore('documents').put(JSON.stringify(row), `record.${row.session.id}`); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); }; }; }), rows);
  await page.reload(); await expect(page.getByTestId('current-batch')).toBeVisible(); const before = await history(page);
  const errors: string[] = []; let downloads = 0; page.on('pageerror', error => errors.push(error.message)); page.on('download', () => { downloads++; });
  await openExport(page); await page.getByRole('button', { name: '纯题目', exact: true }).click();
  await page.evaluate(() => {
    let scheduled = false; let frames = 0; let result: object | null = null;
    Object.defineProperty(window, '__pendingMount', { get: () => result }); Object.defineProperty(window, '__pendingFrames', { get: () => frames });
    const create = Document.prototype.createElement;
    Document.prototype.createElement = new Proxy(create, { apply(target, context, args) { if (args[0] === 'iframe') frames++; return Reflect.apply(target, context, args); } });
    const attribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(this: Element, name, value) {
      const returned = Reflect.apply(attribute, this, [name, value]);
      if (scheduled || name !== 'data-pdf-question') return returned;
      const root = document.querySelector('div[inert][style*="-10000px"]');
      const key = Object.getOwnPropertyNames(this).find(name => name.startsWith('__reactFiber$'));
      let fiber: unknown = key ? Reflect.get(this, key) : undefined; let owned = false;
      for (let depth = 0; root && fiber && typeof fiber === 'object' && depth < 1000; depth++) {
        if ('stateNode' in fiber && fiber.stateNode && typeof fiber.stateNode === 'object' && 'containerInfo' in fiber.stateNode && fiber.stateNode.containerInfo === root) { owned = true; break; }
        fiber = 'return' in fiber ? fiber.return : undefined;
      }
      if (owned) {
        scheduled = true; queueMicrotask(() => {
          const root = document.querySelector('div[inert][style*="-10000px"]');
          const cancel = Array.from(document.querySelectorAll('button,[role="button"]')).find(node => node.getAttribute('aria-label') === '取消导出' || node.textContent?.trim() === '取消导出');
          if (!(cancel instanceof HTMLElement)) throw new Error('CANCEL_BUTTON_MISSING');
          result = { reactStarted: true, rootPresent: !!root, committed: !!root?.firstElementChild, frames }; cancel.click();
        });
      }
      return returned;
    };
  });
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); await page.getByRole('button', { name: '下载 PDF', exact: true }).click();
    await expect.poll(() => page.evaluate('window.__pendingMount'), { timeout: 40000 }).toEqual({ reactStarted: true, rootPresent: true, committed: false, frames: 0 });
    await expect(page.locator('div[inert][style*="-10000px"]')).toHaveCount(0); await expect(page.getByRole('button', { name: '下载 PDF', exact: true })).toBeEnabled();
    expect(await page.evaluate('window.__pendingFrames')).toBe(0); expect(errors).toEqual([]); expect(downloads).toBe(0); expect(calls()).toBe(0); expect(await history(page)).toEqual(before);
    await page.screenshot({ path: info.outputPath('cancel-before-commit.png') });
    await page.getByRole('button', { name: '关闭导出', exact: true }).click(); await openRecords(page); await expect(page.getByTestId('export-record')).toHaveAttribute('data-status', 'cancelled');
    await expect(page.getByRole('button', { name: '下载文件', exact: true })).toHaveCount(0);
  } finally { await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }); await cdp.detach(); }
});

test('reload marks running work interrupted and never automatically starts the renderer or a model', async ({ page }) => {
  const calls = await seed(page); await openExport(page);
  let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; }); let stalled = 0;
  await page.route('**/html2canvas-*.js', async route => { stalled++; await gate; await route.continue().catch(() => undefined); });
  try {
    await page.getByRole('button', { name: '后台导出', exact: true }).click(); await expect.poll(() => stalled).toBeGreaterThan(0);
    await page.reload({ waitUntil: 'commit' }); release(); await page.unrouteAll({ behavior: 'wait' }); await expect(page.getByTestId('launch-screen')).toBeHidden(); await openRecords(page);
    await expect(page.getByTestId('export-record')).toHaveAttribute('data-status', 'interrupted'); await expect(page.getByRole('button', { name: '下载文件', exact: true })).toHaveCount(0);
    await expect(page.locator('iframe[title="批次 PDF 打印"]')).toHaveCount(0); expect(calls()).toBe(0);
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }); }
});

for (const failure of ['print-frame', 'file-store', 'encode', 'mount'] as const) test(`foreground ${failure} failure reveals feedback above a long copy list and supports the correct retry`, async ({ page }, info) => {
  const calls = await seed(page); const before = await history(page); let downloads = 0; const errors: string[] = []; page.on('download', () => { downloads++; }); page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(failure => {
    let armed = false; let fault = true; let frames = 0;
    Object.defineProperty(window, '__feedbackStart', { value: () => { armed = true; } });
    Object.defineProperty(window, '__feedbackCounts', { value: () => frames });
    Object.defineProperty(window, '__feedbackRestore', { value: () => { fault = false; } });
    const attribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(this: Element, name, value) {
      if (failure === 'mount' && armed && fault && name === 'class' && value.includes('print-copy-document')) throw new Error('UNTRUSTED_MOUNT_DETAIL');
      return Reflect.apply(attribute, this, [name, value]);
    };
    const create = Document.prototype.createElement;
    Document.prototype.createElement = new Proxy(create, { apply(target, context, args) { if (armed && args[0] === 'iframe') frames++; return Reflect.apply(target, context, args); } });
    const descriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentDocument'); const read = descriptor?.get; if (!read) throw new Error('FRAME_GETTER_MISSING');
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentDocument', { ...descriptor, get(this: HTMLIFrameElement) {
      if (failure === 'print-frame' && armed && fault && this.title === '批次 PDF 打印') { fault = false; return null; }
      return Reflect.apply(read, this, []);
    } });
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(this: HTMLCanvasElement, ...args) {
      if (failure === 'encode' && armed && fault && args[1] === 'image/jpeg') { fault = false; queueMicrotask(() => args[0](null)); return; }
      return Reflect.apply(toBlob, this, args);
    };
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(this: IDBDatabase, stores, mode, options) {
      const names = typeof stores === 'string' ? [stores] : Array.from(stores);
      if (failure === 'file-store' && fault && this.name === 'solveflow-exports' && mode === 'readwrite' && names.includes('files')) { fault = false; throw new DOMException('TEST_QUOTA', 'QuotaExceededError'); }
      return Reflect.apply(transaction, this, [stores, mode, options]);
    };
  }, failure);
  let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; }); let imports = 0;
  await page.route('**/html2canvas-*.js', async route => { imports++; await gate; await page.evaluate('window.__feedbackStart()'); await route.continue(); });
  try {
    await openExport(page); await page.getByLabel('导出份数', { exact: true }).fill('20');
    await page.getByRole('button', { name: '下载 PDF 压缩包', exact: true }).click(); await expect.poll(() => imports).toBe(1);
    await page.locator('.pdf-dialog-body').evaluate(node => { node.scrollTop = node.scrollHeight; }); release();
    const alert = page.getByRole('alert'); await expect(alert).toBeVisible({ timeout: 40000 });
    if (failure === 'encode') await expect(alert).toContainText('PDF 页面图像编码失败，请重试。');
    if (failure === 'mount') await expect(alert).toContainText('PDF 文档渲染失败，请重试。');
    await expect(alert).toBeInViewport({ ratio: 1 }); await expect(page.getByTestId('pdf-operation-feedback')).toBeFocused();
    await page.screenshot({ path: info.outputPath(`${failure}-feedback.png`) });
    expect(downloads).toBe(0); expect(calls()).toBe(0); expect(await history(page)).toEqual(before);
    await expect(page.locator('iframe[title="批次 PDF 打印"]')).toHaveCount(0);
    const frames: unknown = await page.evaluate('window.__feedbackCounts()'); if (typeof frames !== 'number' || frames < (failure === 'mount' ? 0 : 1)) throw new Error('COUNTS_MISSING');
    if (failure === 'mount') { expect(frames).toBe(0); await expect(page.locator('div[inert][style*="-10000px"]')).toHaveCount(0); }
    if (failure !== 'file-store') {
      await page.evaluate('window.__feedbackRestore()');
      const waiting = page.waitForEvent('download', { timeout: 40000 }); await page.getByRole('button', { name: '下载 PDF 压缩包', exact: true }).click();
      await (await waiting).saveAs(info.outputPath('render-retry.zip')); expect(await page.evaluate('window.__feedbackCounts()')).toBeGreaterThan(frames);
    } else {
      await page.getByRole('button', { name: '导出记录', exact: true }).click();
      const record = page.getByTestId('export-record'); await expect(record).toContainText('等待保存');
      await record.getByRole('button', { name: '重试保存', exact: true }).click(); await expect(record).toHaveAttribute('data-status', 'succeeded');
      expect(await page.evaluate('window.__feedbackCounts()')).toBe(frames);
      const waiting = page.waitForEvent('download'); await record.getByRole('button', { name: '下载文件', exact: true }).click(); await (await waiting).saveAs(info.outputPath('save-retry.zip'));
    }
    expect(downloads).toBe(1); expect(calls()).toBe(0); expect(await history(page)).toEqual(before); expect(errors).toEqual([]);
    expect((await readFile(info.outputPath(failure !== 'file-store' ? 'render-retry.zip' : 'save-retry.zip'))).subarray(0, 2).toString()).toBe('PK');
    await expect(page.locator('iframe[title="批次 PDF 打印"]')).toHaveCount(0);
  } finally { release(); }
});

test('a failed file save only retries storage and opted-in hidden-page notifications fire after commit', async ({ page }, info) => {
  await page.addInitScript(() => {
    let fileFault = true; let converted = 0; let requests = 0; let notifications = 0;
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(this: IDBDatabase, stores, mode, options) {
      const names = typeof stores === 'string' ? [stores] : Array.from(stores);
      if (this.name === 'solveflow-exports' && mode === 'readwrite' && names.includes('files') && fileFault) { fileFault = false; throw new DOMException('TEST_QUOTA', 'QuotaExceededError'); }
      return Reflect.apply(transaction, this, [stores, mode, options]);
    };
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(this: HTMLCanvasElement, ...args) { converted++; return Reflect.apply(toBlob, this, args); };
    class TestNotification {
      static permission: NotificationPermission = 'default';
      static async requestPermission() { requests++; this.permission = 'granted'; return this.permission; }
      constructor() { notifications++; }
      close() {}
    }
    Object.defineProperty(window, 'Notification', { value: TestNotification, configurable: true });
    Object.defineProperty(window, '__exportCounts', { value: () => [converted, requests, notifications] });
  });
  const calls = await seed(page); const before = await history(page); await openExport(page);
  await page.getByRole('button', { name: '后台导出', exact: true }).click(); await openRecords(page);
  const record = page.getByTestId('export-record'); await expect(record).toContainText('等待保存', { timeout: 30000 }); await expect(record.getByRole('button', { name: '重试保存', exact: true })).toBeEnabled();
  await expect(record.getByRole('button', { name: '下载文件', exact: true })).toHaveCount(0); await expect(page.getByLabel('导出任务通知')).not.toContainText('导出已完成');
  const counts: unknown = await page.evaluate('window.__exportCounts()');
  if (!Array.isArray(counts) || counts.length !== 3 || counts.some(value => typeof value !== 'number')) throw new Error('FIXTURE_COUNTS');
  expect(counts[0]).toBeGreaterThan(0); expect(counts.slice(1)).toEqual([0, 0]);
  await page.getByRole('button', { name: '开启系统通知', exact: true }).click(); await expect(page.getByText('系统通知已开启。', { exact: true })).toBeVisible();
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); });
  await record.getByRole('button', { name: '重试保存', exact: true }).click(); await expect(record).toHaveAttribute('data-status', 'succeeded'); await expect(page.getByLabel('导出任务通知')).toContainText('导出已完成');
  expect(await page.evaluate('window.__exportCounts()')).toEqual([counts[0], 1, 1]); expect(calls()).toBe(0); expect(await history(page)).toEqual(before);
  const waiting = page.waitForEvent('download'); await record.getByRole('button', { name: '下载文件', exact: true }).click(); await (await waiting).saveAs(info.outputPath('save-only-retry.pdf'));
  expect((await readFile(info.outputPath('save-only-retry.pdf'))).subarray(0, 5).toString()).toBe('%PDF-');
});

for (const action of ['retry', 'cancel-save', 'cancel-read', 'abandon'] as const) test(`inline file recovery ${action} stays on the accepted task without rerendering`, async ({ page }, info) => {
  const calls = await seed(page); const before = await history(page); await openExport(page); let downloads = 0; page.on('download', () => { downloads++; });
  await page.evaluate(action => {
    let writes = 0; let frames = 0; let held = false; let release = () => {};
    Object.defineProperty(window, '__inlineResume', { value: () => release() });
    Object.defineProperty(window, '__inlineState', { value: () => ({ writes, frames }) });
    const create = Document.prototype.createElement;
    Document.prototype.createElement = new Proxy(create, { apply(target, context, args) { if (args[0] === 'iframe') frames++; return Reflect.apply(target, context, args); } });
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(this: IDBDatabase, stores, mode, options) {
      const names = typeof stores === 'string' ? [stores] : Array.from(stores);
      if (this.name === 'solveflow-exports' && mode === 'readwrite' && names.includes('files') && ++writes <= (action === 'retry' ? 2 : 1)) throw new DOMException('TEST_QUOTA', 'QuotaExceededError');
      return Reflect.apply(transaction, this, [stores, mode, options]);
    };
    const descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete'); const set = descriptor?.set; if (!set) throw new Error('TX_HANDLER_MISSING');
    Object.defineProperty(IDBTransaction.prototype, 'oncomplete', { ...descriptor, set(this: IDBTransaction, callback: unknown) {
      if (typeof callback !== 'function') return Reflect.apply(set, this, [callback]);
      const tx = this;
      return Reflect.apply(set, tx, [function(event: Event) {
        if (!held && tx.db.name === 'solveflow-exports' && tx.objectStoreNames.contains('files') && ((action === 'cancel-save' && tx.mode === 'readwrite') || (action === 'cancel-read' && tx.mode === 'readonly'))) {
          held = true; document.documentElement.dataset.inlineHeld = action; release = () => { Reflect.apply(callback, tx, [event]); };
        } else Reflect.apply(callback, tx, [event]);
      }]);
    } });
  }, action);
  async function tasks() { const rows: unknown = await page.evaluate(() => new Promise<unknown[]>((resolve, reject) => { const request = indexedDB.open('solveflow-exports'); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result; const tx = db.transaction('records'); const rows = tx.objectStore('records').getAll(); tx.oncomplete = () => { db.close(); resolve(rows.result); }; tx.onerror = () => reject(tx.error); }; })); if (!Array.isArray(rows)) throw new Error('TASKS_MISSING'); return rows.map(row => ExportTaskSchema.parse(row)); }
  try {
    await page.getByRole('button', { name: '下载 PDF', exact: true }).click(); await expect(page.getByRole('alert')).toBeVisible({ timeout: 30000 });
    const retry = page.getByRole('button', { name: '重试保存并下载', exact: true }); await expect(retry).toBeVisible(); await expect(retry).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('button', { name: '下载 PDF', exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: '后台导出', exact: true })).toHaveCount(0);
    const initial = await tasks(); expect(initial).toHaveLength(1); const accepted = initial.at(0); if (!accepted) throw new Error('TASK_MISSING'); const id = accepted.id;
    const counts: unknown = await page.evaluate('window.__inlineState()'); if (!counts || typeof counts !== 'object' || !('frames' in counts) || typeof counts.frames !== 'number') throw new Error('COUNTS_MISSING'); const frames = counts.frames;
    expect(frames).toBeGreaterThan(0); expect(downloads).toBe(0);
    await page.getByLabel('导出份数', { exact: true }).fill('3');
    if (action === 'abandon') {
      await page.getByRole('button', { name: '取消本次导出', exact: true }).click();
    } else if (action === 'retry') {
      await retry.click(); await expect(page.getByRole('alert')).toBeVisible(); await expect(retry).toBeEnabled(); await expect(page.getByTestId('pdf-operation-feedback')).toBeFocused(); expect(downloads).toBe(0);
      const waiting = page.waitForEvent('download'); await retry.evaluate(node => { if (!(node instanceof HTMLElement)) throw new Error('RETRY_BUTTON'); node.click(); node.click(); }); await (await waiting).saveAs(info.outputPath('inline-original.pdf'));
      expect((await readFile(info.outputPath('inline-original.pdf'))).subarray(0, 5).toString()).toBe('%PDF-');
    } else {
      await retry.click(); await expect(page.locator('html')).toHaveAttribute('data-inline-held', action);
      await page.getByRole('button', { name: '取消导出', exact: true }).click(); await page.evaluate('window.__inlineResume()');
    }
    await expect(page.getByRole('button', { name: '取消导出', exact: true })).toHaveCount(0); await expect(retry).toHaveCount(0);
    const final = await tasks(); expect(final).toHaveLength(1); const result = final.at(0); if (!result) throw new Error('TASK_MISSING'); expect(result.id).toBe(id); expect(result.copies).toBe(1); expect(result.status).toBe(action === 'retry' || action === 'cancel-read' ? 'succeeded' : 'cancelled');
    const stored = await page.evaluate(() => new Promise<number[]>((resolve, reject) => { const request = indexedDB.open('solveflow-exports'); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result; const tx = db.transaction(['files', 'sizes']); const files = tx.objectStore('files').count(); const sizes = tx.objectStore('sizes').count(); tx.oncomplete = () => { db.close(); resolve([files.result, sizes.result]); }; tx.onerror = () => reject(tx.error); }; })); expect(stored).toEqual(result.status === 'succeeded' ? [1, 1] : [0, 0]);
    expect(downloads).toBe(action === 'retry' ? 1 : 0); expect(await page.evaluate('window.__inlineState()')).toMatchObject({ frames }); expect(calls()).toBe(0); expect(await history(page)).toEqual(before);
    await expect(page.locator('iframe[title="批次 PDF 打印"]')).toHaveCount(0);
  } finally { await page.evaluate('window.__inlineResume()').catch(() => undefined); }
});

test('background progress does not repeatedly render an idle PDF dialog', async ({ page }, info) => {
  const calls = await seed(page); const before = await history(page); let release = () => {}; let gated = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/html2canvas-*.js', async route => { gated = true; await gate; await route.continue(); });
  await openExport(page); await page.getByLabel('导出份数', { exact: true }).fill('20'); await page.getByRole('button', { name: '后台导出', exact: true }).click();
  await expect.poll(() => gated).toBe(true); await openExport(page);
  const probe = await trackExportRenders(page);
  try {
    await page.getByLabel('导出份数', { exact: true }).fill('2'); await expect.poll(async () => (await probe.read()).renders).toBeGreaterThan(0);
    release(); await expect(page.getByLabel('导出任务通知')).toContainText('导出已完成', { timeout: 30000 });
    const counters = await probe.read(); await info.attach('idle-dialog-render-count', { body: JSON.stringify(counters), contentType: 'application/json' });
    expect(counters.progress).toBeGreaterThanOrEqual(30); if (counters.start === null || counters.end === null) throw new Error('RENDER_WINDOW_MISSING');
    expect(counters.end - counters.start).toBeLessThanOrEqual(2);
    expect(calls()).toBe(0); expect(await history(page)).toEqual(before); await expect(page.locator('iframe[title="批次 PDF 打印"]')).toHaveCount(0);
  } finally { release(); await probe.close(); }
});

test('records storage retry remains cancellable while its file acknowledgement is held', async ({ page }, info) => {
  const calls = await seed(page); const before = await history(page); const errors: string[] = []; let downloads = 0;
  page.on('pageerror', error => errors.push(error.message)); page.on('download', () => { downloads++; });
  await page.evaluate(() => {
    let fault = true; let held = false; let frames = 0; let release = () => {};
    Object.defineProperty(window, '__recordsResume', { value: () => release() });
    Object.defineProperty(window, '__recordsFrames', { value: () => frames });
    const create = Document.prototype.createElement;
    Document.prototype.createElement = new Proxy(create, { apply(target, context, args) { if (args[0] === 'iframe') frames++; return Reflect.apply(target, context, args); } });
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(this: IDBDatabase, stores, mode, options) {
      const names = typeof stores === 'string' ? [stores] : Array.from(stores);
      if (fault && this.name === 'solveflow-exports' && mode === 'readwrite' && names.includes('files')) { fault = false; throw new DOMException('TEST_QUOTA', 'QuotaExceededError'); }
      return Reflect.apply(transaction, this, [stores, mode, options]);
    };
    const descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete'); const set = descriptor?.set; if (!set) throw new Error('TX_HANDLER_MISSING');
    Object.defineProperty(IDBTransaction.prototype, 'oncomplete', { ...descriptor, set(this: IDBTransaction, callback: unknown) {
      if (typeof callback !== 'function') return Reflect.apply(set, this, [callback]);
      const tx = this;
      return Reflect.apply(set, tx, [function(event: Event) {
        if (!held && tx.db.name === 'solveflow-exports' && tx.mode === 'readwrite' && tx.objectStoreNames.contains('files')) {
          held = true; document.documentElement.dataset.recordsHeld = 'true'; release = () => { release = () => {}; Reflect.apply(callback, tx, [event]); };
        } else Reflect.apply(callback, tx, [event]);
      }]);
    } });
  });
  try {
    await openExport(page); await page.getByRole('button', { name: '后台导出', exact: true }).click(); await openRecords(page);
    const record = page.getByTestId('export-record'); await expect(record).toContainText('等待保存', { timeout: 30000 });
    const id = await record.getAttribute('data-export-id'); const frames: unknown = await page.evaluate('window.__recordsFrames()'); expect(frames).toBeGreaterThan(0);
    await record.getByRole('button', { name: '重试保存', exact: true }).click(); await expect(page.locator('html')).toHaveAttribute('data-records-held', 'true');
    const cancel = record.getByRole('button', { name: '取消任务', exact: true }); await expect(cancel).toBeEnabled({ timeout: 2000 });
    await cancel.evaluate(node => { if (!(node instanceof HTMLButtonElement)) throw new Error('CANCEL_CONTROL_MISSING'); node.click(); node.click(); });
    const cancelling = record.getByRole('button', { name: '正在取消…', exact: true }); await expect(cancelling).toBeDisabled(); await expect(cancelling).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: info.outputPath('records-cancelling-save.png') }); await page.evaluate('window.__recordsResume()');
    await expect(record).toHaveAttribute('data-status', 'cancelled'); await expect(record).toContainText('已取消'); await expect(record.getByRole('button', { name: '重试保存', exact: true })).toHaveCount(0);
    expect(await record.getAttribute('data-export-id')).toBe(id); expect(await page.evaluate('window.__recordsFrames()')).toBe(frames);
    const counts = await page.evaluate(() => new Promise<number[]>((resolve, reject) => { const request = indexedDB.open('solveflow-exports'); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result; const tx = db.transaction(['files', 'sizes']); const files = tx.objectStore('files').count(); const sizes = tx.objectStore('sizes').count(); tx.oncomplete = () => { db.close(); resolve([files.result, sizes.result]); }; tx.onerror = () => reject(tx.error); }; }));
    expect(counts).toEqual([0, 0]); expect(downloads).toBe(0); expect(calls()).toBe(0); expect(errors).toEqual([]); expect(await history(page)).toEqual(before);
    await expect(page.locator('iframe[title="批次 PDF 打印"]')).toHaveCount(0);
  } finally { await page.evaluate('window.__recordsResume()').catch(() => undefined); }
});

test('records download errors reveal and focus feedback after repeated failures at the bottom of a long list', async ({ page }, info) => {
  const calls = await seed(page); const before = await history(page); const errors: string[] = []; let downloads = 0;
  page.on('pageerror', error => errors.push(error.message)); page.on('download', () => { downloads++; });
  await openExport(page); await page.getByRole('button', { name: '后台导出', exact: true }).click(); await openRecords(page);
  await expect(page.getByTestId('export-record')).toHaveAttribute('data-status', 'succeeded', { timeout: 30000 });
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('solveflow-exports'); request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result; const tx = db.transaction(['records', 'files', 'sizes'], 'readwrite'); const records = tx.objectStore('records'); const read = records.getAll();
      read.onsuccess = () => {
        const original = read.result[0]; const file = tx.objectStore('files').get(original.id);
        file.onsuccess = () => {
          for (let index = 1; index <= 24; index++) {
            const id = crypto.randomUUID(); const clone = { ...original, id, title: `Saved export ${index}`, createdAt: new Date(Date.parse(original.createdAt) - index * 60000).toISOString() };
            records.put(clone, id); tx.objectStore('files').put(file.result, id); tx.objectStore('sizes').put(file.result.data.byteLength, id);
          }
        };
      };
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }));
  await page.reload(); await expect(page.getByTestId('launch-screen')).toBeHidden(); await openRecords(page); await expect(page.getByTestId('export-record')).toHaveCount(25);
  await page.evaluate(() => {
    let faults = 2; const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function(this: IDBObjectStore, ...args: Parameters<IDBObjectStore['get']>) {
      if (faults > 0 && this.transaction.db.name === 'solveflow-exports' && this.name === 'files') { faults--; throw new DOMException('TEST_READ', 'UnknownError'); }
      return Reflect.apply(get, this, args);
    };
  });
  const row = page.getByTestId('export-record').last();
  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.locator('.pdf-dialog-body').evaluate(node => { node.scrollTop = node.scrollHeight; });
    await row.getByRole('button', { name: '下载文件', exact: true }).click();
    const alert = page.getByRole('alert'); await expect(alert).toBeVisible(); await expect(alert).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('export-records-feedback')).toBeFocused();
    await expect(row.getByRole('button', { name: '下载文件', exact: true })).toBeEnabled(); await page.screenshot({ path: info.outputPath(`records-read-failure-${attempt}.png`) });
  }
  await page.evaluate(() => {
    const state = { reads: 0, held: false, release: null as (() => void) | null }; Object.defineProperty(window, '__recordsDownloadProbe', { value: state });
    const descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete'); const set = descriptor?.set; if (!set) throw new Error('TX_HANDLER_MISSING');
    Object.defineProperty(IDBTransaction.prototype, 'oncomplete', { ...descriptor, set(this: IDBTransaction, callback: unknown) {
      if (typeof callback !== 'function') return Reflect.apply(set, this, [callback]); const tx = this;
      return Reflect.apply(set, tx, [function(event: Event) {
        if (tx.db.name === 'solveflow-exports' && tx.mode === 'readonly' && tx.objectStoreNames.contains('files') && ++state.reads === 1) {
          state.held = true; state.release = () => { state.release = null; Reflect.apply(callback, tx, [event]); };
        } else Reflect.apply(callback, tx, [event]);
      }]);
    } });
  });
  try {
    const waiting = page.waitForEvent('download');
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-testid="export-record"]')];
      const current = rows.at(-1)?.querySelector<HTMLButtonElement>('button[aria-label="下载文件"]'); const other = rows[0]?.querySelector<HTMLButtonElement>('button[aria-label="下载文件"]');
      if (!current || !other) throw new Error('DOWNLOAD_CONTROLS_MISSING'); current.click(); current.click(); other.click();
    });
    await expect.poll(() => page.evaluate(() => Reflect.get(window, '__recordsDownloadProbe').held)).toBe(true);
    expect(await page.evaluate(() => Reflect.get(window, '__recordsDownloadProbe').reads)).toBe(1);
    await expect(row.getByRole('button', { name: '下载文件', exact: true })).toBeDisabled();
    await page.evaluate(() => Reflect.get(window, '__recordsDownloadProbe').release()); await (await waiting).saveAs(info.outputPath('records-read-retry.pdf'));
    await expect(row.getByRole('button', { name: '下载文件', exact: true })).toBeEnabled(); expect(await page.evaluate(() => Reflect.get(window, '__recordsDownloadProbe').reads)).toBe(1);
    expect((await readFile(info.outputPath('records-read-retry.pdf'))).subarray(0, 5).toString()).toBe('%PDF-'); expect(downloads).toBe(1); expect(calls()).toBe(0); expect(errors).toEqual([]); expect(await history(page)).toEqual(before);
  } finally { await page.evaluate(() => Reflect.get(window, '__recordsDownloadProbe').release?.()).catch(() => undefined); }
});

test('records keep different task cancellations independent while an ordinary file read is held', async ({ page }, info) => {
  const calls = await seed(page); const before = await history(page); const errors: string[] = []; let downloads = 0;
  page.on('pageerror', error => errors.push(error.message)); page.on('download', () => { downloads++; });
  async function stored() {
    return page.evaluate(() => new Promise<{ records: unknown[]; files: IDBValidKey[]; sizes: IDBValidKey[] }>((resolve, reject) => {
      const request = indexedDB.open('solveflow-exports'); request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result; const tx = db.transaction(['records', 'files', 'sizes']);
        const records = tx.objectStore('records').getAll(); const files = tx.objectStore('files').getAllKeys(); const sizes = tx.objectStore('sizes').getAllKeys();
        tx.oncomplete = () => { db.close(); resolve({ records: records.result, files: files.result, sizes: sizes.result }); }; tx.onerror = () => { db.close(); reject(tx.error); };
      };
    }));
  }
  await openExport(page); await page.getByRole('button', { name: '后台导出', exact: true }).click();
  await expect(page.getByLabel('导出任务通知')).toContainText('导出已完成', { timeout: 30000 });
  const baseline = await stored(); expect(baseline.records).toHaveLength(1);
  const saved = ExportTaskSchema.parse(baseline.records[0]); expect(saved.status).toBe('succeeded'); expect(saved.file).not.toBeNull();
  expect(baseline.files).toEqual([saved.id]); expect(baseline.sizes).toEqual([saved.id]);
  await page.evaluate(savedId => {
    const create = Document.prototype.createElement; const toBlob = HTMLCanvasElement.prototype.toBlob;
    const get = IDBObjectStore.prototype.get; const put = IDBObjectStore.prototype.put; const remove = IDBObjectStore.prototype.delete;
    const abort = AbortController.prototype.abort; const descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete');
    const set = descriptor?.set; if (!descriptor || !set) throw new Error('TX_HANDLER_MISSING');
    const state = {
      frames: 0, jpegs: 0, armBlob: true, restored: false, blobHeld: false, readHeld: false, readObserved: false, lateCallbacks: 0,
      nativeBlob: null as { type: string; bytes: number } | null, canvas: null as HTMLCanvasElement | null,
      reads: [] as string[], writes: [] as { id: string; status: string }[], fileWrites: [] as string[], deletions: [] as string[],
      cancellingId: null as string | null, aborts: [] as { id: string; signal: AbortSignal }[], expired: [] as string[],
      resumeRead: () => {}, resumeBlob: () => {}, restore: () => {},
    };
    const readTransactions = new WeakSet<IDBTransaction>(); let readTimer: number | undefined; let blobTimer: number | undefined;
    Object.defineProperty(window, '__recordsConcurrentProbe', { value: state });
    Document.prototype.createElement = new Proxy(create, { apply(target, context, args) { if (args[0] === 'iframe') state.frames++; return Reflect.apply(target, context, args); } });
    HTMLCanvasElement.prototype.toBlob = function(this: HTMLCanvasElement, callback, type, quality) {
      if (type === 'image/jpeg') state.jpegs++;
      if (!state.armBlob || type !== 'image/jpeg') return Reflect.apply(toBlob, this, [callback, type, quality]);
      state.armBlob = false; state.canvas = this;
      // Hold only a real browser-produced JPEG; cancellation must settle before its late callback.
      return Reflect.apply(toBlob, this, [(blob: Blob | null) => {
        if (!blob || state.restored) { callback(blob); return; }
        state.nativeBlob = { type: blob.type, bytes: blob.size }; state.blobHeld = true;
        state.resumeBlob = () => { state.resumeBlob = () => {}; clearTimeout(blobTimer); state.blobHeld = false; state.lateCallbacks++; callback(blob); };
        blobTimer = window.setTimeout(() => { state.expired.push('blob'); state.resumeBlob(); }, 20000);
      }, type, quality]);
    };
    IDBObjectStore.prototype.get = function(...args: Parameters<IDBObjectStore['get']>) {
      const result = Reflect.apply(get, this, args);
      if (this.transaction.db.name === 'solveflow-exports' && this.name === 'files') {
        state.reads.push(String(args[0])); if (args[0] === savedId) readTransactions.add(this.transaction);
      }
      return result;
    };
    IDBObjectStore.prototype.put = function(...args: Parameters<IDBObjectStore['put']>) {
      const result = Reflect.apply(put, this, args); const value: unknown = args[0];
      if (this.transaction.db.name === 'solveflow-exports') {
        if (this.name === 'files') state.fileWrites.push(String(args[1]));
        if (this.name === 'records' && value && typeof value === 'object' && 'id' in value && typeof value.id === 'string' && 'status' in value && typeof value.status === 'string') state.writes.push({ id: value.id, status: value.status });
      }
      return result;
    };
    IDBObjectStore.prototype.delete = function(...args: Parameters<IDBObjectStore['delete']>) { if (this.transaction.db.name === 'solveflow-exports') state.deletions.push(String(args[0])); return Reflect.apply(remove, this, args); };
    AbortController.prototype.abort = function(...args: Parameters<AbortController['abort']>) {
      const id = state.cancellingId; const result = Reflect.apply(abort, this, args); if (id) state.aborts.push({ id, signal: this.signal }); return result;
    };
    Object.defineProperty(IDBTransaction.prototype, 'oncomplete', { ...descriptor, set(this: IDBTransaction, callback: unknown) {
      if (typeof callback !== 'function') return Reflect.apply(set, this, [callback]); const tx = this;
      return Reflect.apply(set, tx, [function(event: Event) {
        if (!state.restored && readTransactions.has(tx) && !state.readObserved) {
          // The transaction has really committed; only its application acknowledgement is pending.
          state.readObserved = true; state.readHeld = true;
          state.resumeRead = () => { state.resumeRead = () => {}; clearTimeout(readTimer); state.readHeld = false; Reflect.apply(callback, tx, [event]); };
          readTimer = window.setTimeout(() => { state.expired.push('read'); state.resumeRead(); }, 8000);
        } else Reflect.apply(callback, tx, [event]);
      }]);
    } });
    state.restore = () => {
      state.restored = true; state.resumeRead(); state.resumeBlob(); clearTimeout(readTimer); clearTimeout(blobTimer);
      Document.prototype.createElement = create; HTMLCanvasElement.prototype.toBlob = toBlob;
      IDBObjectStore.prototype.get = get; IDBObjectStore.prototype.put = put; IDBObjectStore.prototype.delete = remove;
      AbortController.prototype.abort = abort; Object.defineProperty(IDBTransaction.prototype, 'oncomplete', descriptor);
    };
  }, saved.id);
  try {
    await openExport(page); await page.getByRole('button', { name: '后台导出', exact: true }).click();
    await expect.poll(() => page.evaluate(() => Reflect.get(window, '__recordsConcurrentProbe').blobHeld), { timeout: 30000 }).toBe(true);
    await openExport(page); await page.getByRole('button', { name: '后台导出', exact: true }).click(); await openRecords(page);
    await expect(page.getByTestId('export-record')).toHaveCount(3);
    const initial = (await stored()).records.map(value => ExportTaskSchema.parse(value));
    const running = initial.find(task => task.status === 'running'); const queued = initial.find(task => task.status === 'queued');
    if (!running || !queued) throw new Error('RUNNING_AND_QUEUED_TASKS_MISSING');
    const a = page.locator(`[data-export-id="${saved.id}"]`); const b = page.locator(`[data-export-id="${running.id}"]`); const c = page.locator(`[data-export-id="${queued.id}"]`);
    await expect(a).toHaveAttribute('data-status', 'succeeded'); await expect(b).toHaveAttribute('data-status', 'running'); await expect(c).toHaveAttribute('data-status', 'queued');
    const frames: unknown = await page.evaluate(() => Reflect.get(window, '__recordsConcurrentProbe').frames); expect(frames).toBeGreaterThan(0);
    await a.getByRole('button', { name: '删除记录', exact: true }).click();
    await a.evaluate(node => {
      const download = node.querySelector<HTMLButtonElement>('button[aria-label="下载文件"]'); const remove = node.querySelector<HTMLButtonElement>('button[aria-label="确认删除文件和记录"]');
      if (!download || !remove) throw new Error('ORDINARY_CONTROLS_MISSING'); download.click(); download.click(); remove.click();
    });
    await expect.poll(() => page.evaluate(() => Reflect.get(window, '__recordsConcurrentProbe').readHeld)).toBe(true);
    await expect(a.getByRole('button', { name: '下载文件', exact: true })).toBeDisabled(); await expect(a.getByRole('button', { name: '确认删除文件和记录', exact: true })).toBeDisabled();
    for (const [row, id] of [[b, running.id], [c, queued.id]] as const) {
      const cancel = row.getByRole('button', { name: '取消任务', exact: true }); await expect(cancel).toBeEnabled({ timeout: 2000 });
      await cancel.scrollIntoViewIfNeeded(); await expect(cancel).toBeInViewport();
      const observed = await cancel.evaluate((node, id) => {
        if (!(node instanceof HTMLButtonElement)) throw new Error('CANCEL_CONTROL_MISSING');
        const state = Reflect.get(window, '__recordsConcurrentProbe'); state.cancellingId = id;
        try { node.click(); const first = state.aborts.filter((entry: { id: string }) => entry.id === id).length; node.click(); return { first, second: state.aborts.filter((entry: { id: string }) => entry.id === id).length }; } finally { state.cancellingId = null; }
      }, id);
      expect(observed.first).toBeGreaterThan(0); expect(observed.second).toBe(observed.first);
      await expect(row.getByRole('button', { name: '正在取消…', exact: true })).toBeDisabled({ timeout: 2000 });
    }
    await expect(page.getByRole('button', { name: '正在取消…', exact: true })).toHaveCount(2);
    await expect(b).toHaveAttribute('data-status', 'running'); await expect(c).toHaveAttribute('data-status', 'queued');
    const held = await page.evaluate(({ runningId, queuedId }) => {
      const state = Reflect.get(window, '__recordsConcurrentProbe');
      const running = state.aborts.filter((entry: { id: string; signal: AbortSignal }) => entry.id === runningId).map((entry: { signal: AbortSignal }) => entry.signal);
      const queued = state.aborts.filter((entry: { id: string; signal: AbortSignal }) => entry.id === queuedId).map((entry: { signal: AbortSignal }) => entry.signal);
      return { readHeld: state.readHeld, blobHeld: state.blobHeld, reads: state.reads, frames: state.frames, jpegs: state.jpegs, expired: state.expired, deletions: state.deletions,
        runningAborted: running.length > 0 && running.every((signal: AbortSignal) => signal.aborted), queuedAborted: queued.length > 0 && queued.every((signal: AbortSignal) => signal.aborted), independent: running.every((signal: AbortSignal) => !queued.includes(signal)) };
    }, { runningId: running.id, queuedId: queued.id });
    expect(held).toEqual({ readHeld: true, blobHeld: true, reads: [saved.id], frames, jpegs: 1, expired: [], deletions: [], runningAborted: true, queuedAborted: true, independent: true }); expect(downloads).toBe(0);
    const waiting = page.waitForEvent('download'); await page.evaluate(() => Reflect.get(window, '__recordsConcurrentProbe').resumeRead());
    await (await waiting).saveAs(info.outputPath('records-independent-cancel.pdf'));
    await expect(b).toHaveAttribute('data-status', 'cancelled'); await expect(c).toHaveAttribute('data-status', 'cancelled');
    await expect(page.getByRole('button', { name: '正在取消…', exact: true })).toHaveCount(0);
    await page.evaluate(() => Reflect.get(window, '__recordsConcurrentProbe').resumeBlob());
    await expect(a.getByRole('button', { name: '下载文件', exact: true })).toBeEnabled();
    await expect(page.locator('div[inert][style*="-10000px"],iframe[title="批次 PDF 打印"]')).toHaveCount(0);
    const final = await stored(); const tasks = final.records.map(value => ExportTaskSchema.parse(value)); expect(tasks).toHaveLength(3);
    expect(tasks.find(task => task.id === saved.id)).toEqual(saved);
    expect(tasks.find(task => task.id === running.id)).toMatchObject({ status: 'cancelled', file: null });
    expect(tasks.find(task => task.id === queued.id)).toMatchObject({ status: 'cancelled', startedAt: null, file: null });
    expect(final.files).toEqual([saved.id]); expect(final.sizes).toEqual([saved.id]);
    const settled = await page.evaluate(() => {
      const state = Reflect.get(window, '__recordsConcurrentProbe'); return { reads: state.reads, writes: state.writes, fileWrites: state.fileWrites, deletions: state.deletions, frames: state.frames, jpegs: state.jpegs, lateCallbacks: state.lateCallbacks, expired: state.expired, nativeBlob: state.nativeBlob, canvas: [state.canvas?.width, state.canvas?.height] };
    });
    expect(settled).toMatchObject({ reads: [saved.id], fileWrites: [], deletions: [], frames, jpegs: 1, lateCallbacks: 1, expired: [], nativeBlob: { type: 'image/jpeg' }, canvas: [0, 0] }); expect(settled.nativeBlob?.bytes).toBeGreaterThan(0);
    expect(settled.writes.filter((write: { id: string }) => write.id === running.id).map((write: { status: string }) => write.status)).toEqual(['queued', 'running', 'cancelled']);
    expect(settled.writes.filter((write: { id: string }) => write.id === queued.id).map((write: { status: string }) => write.status)).toEqual(['queued', 'cancelled']);
    const bytes = await readFile(info.outputPath('records-independent-cancel.pdf')); expect(bytes.subarray(0, 5).toString()).toBe('%PDF-'); expect(bytes.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(2);
    expect(downloads).toBe(1); expect(calls()).toBe(0); expect(errors).toEqual([]); expect(await history(page)).toEqual(before);
  } finally { await page.evaluate(() => Reflect.get(window, '__recordsConcurrentProbe').restore()).catch(() => undefined); }
});

const codecPhases: PdfCodecPhase[] = ['blob', 'bytes'];
for (const phase of codecPhases) test(`native ${phase} cancellation isolates late results from a new two-copy export`, async ({ page }, info) => {
  const calls = await seed(page); const original = await history(page); await openExport(page);
  const errors: string[] = []; let downloads = 0;
  page.on('pageerror', error => errors.push(error.message)); page.on('download', () => { downloads++; });
  async function stored() {
    const raw = await page.evaluate(() => new Promise<{ records: unknown[]; files: IDBValidKey[]; sizes: IDBValidKey[] }>((resolve, reject) => {
      const request = indexedDB.open('solveflow-exports'); request.onerror = () => reject(request.error);
      request.onsuccess = () => { const db = request.result; const tx = db.transaction(['records', 'files', 'sizes']);
        const records = tx.objectStore('records').getAll(), files = tx.objectStore('files').getAllKeys(), sizes = tx.objectStore('sizes').getAllKeys();
        tx.oncomplete = () => { db.close(); resolve({ records: records.result, files: files.result, sizes: sizes.result }); }; tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
      };
    }));
    return { ...raw, records: raw.records.map(value => ExportTaskSchema.parse(value)) };
  }
  await installPdfCodecProbe(page);
  try {
    await page.evaluate(phase => window.__pdfCodecProbe.arm('A', phase, true), phase);
    await page.getByRole('button', { name: '下载 PDF', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__pdfCodecProbe.state().cells.A?.held), { timeout: 30000 }).toBe(true);
    await expect(page.getByText('导出已取消。', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '下载 PDF', exact: true })).toBeEnabled();
    const canceled = await stored(); expect(canceled.records).toHaveLength(1);
    const a = canceled.records[0]; if (!a) throw new Error('CANCELLED_TASK_MISSING');
    expect(a).toMatchObject({ status: 'cancelled', file: null }); expect(canceled.files).toEqual([]); expect(canceled.sizes).toEqual([]);
    const first = await page.evaluate(() => window.__pdfCodecProbe.state());
    expect(first.cells.A).toMatchObject({ nativeReturned: true, nativeReady: true, held: true, expired: false, cancelClicked: true, readyAtCancel: false,
      blob: { type: 'image/jpeg' }, canvas: [0, 0], readStarts: phase === 'bytes' ? 1 : 0 });
    expect(first.cells.A?.blob?.bytes).toBeGreaterThan(0); expect(first.cells.A?.abortsAtCancel).toBeGreaterThan(0);
    if (phase === 'bytes') expect(first.cells.A?.byteLength).toBe(first.cells.A?.blob?.bytes);
    expect(first.frames.some(frame => frame.connected)).toBe(false); expect(first.liveEncodedCanvases).toEqual([]);
    expect(first.filePutAttempts).toEqual([]); expect(first.artifactUrls).toEqual([]); expect(downloads).toBe(0);
    await page.getByLabel('导出份数', { exact: true }).fill('2'); await expect(page.getByLabel('第2份答错题数', { exact: true })).toHaveValue('0');
    await page.evaluate(phase => window.__pdfCodecProbe.arm('B', phase, false), phase);
    const download = page.getByRole('button', { name: '下载 PDF 压缩包', exact: true }); await download.click();
    await expect.poll(() => page.evaluate(() => window.__pdfCodecProbe.state().cells.B?.held), { timeout: 30000 }).toBe(true);
    const held = await stored(); expect(held.records).toHaveLength(2);
    const b = held.records.find(task => task.id !== a.id); if (!b) throw new Error('NEW_TASK_MISSING');
    expect(b.status).toBe('running'); expect(held.records.find(task => task.id === a.id)).toEqual(a);
    const before = await page.evaluate(() => window.__pdfCodecProbe.state());
    expect(before.frames.some(frame => frame.owner === 'B' && frame.connected)).toBe(true);
    expect(before.cells.B?.canvas.every(value => value > 0)).toBe(true); await expect(download).toHaveCount(0);
    await expect(page.getByRole('button', { name: '取消导出', exact: true })).toBeEnabled();
    await page.evaluate(() => window.__pdfCodecProbe.release('A'));
    const quiet = await page.evaluate(() => window.__pdfCodecProbe.quiet()); expect(await stored()).toEqual(held);
    for (const key of ['encodes', 'aborts', 'filePutAttempts', 'recordWrites', 'artifactUrls', 'frames', 'liveEncodedCanvases'] as const) {
      expect(quiet.before[key]).toEqual(before[key]); expect(quiet.after[key]).toEqual(before[key]);
    }
    expect(quiet.after.cells.A).toMatchObject({ released: true, held: false, canvas: [0, 0] }); expect(quiet.after.cells.B).toEqual(before.cells.B);
    expect(downloads).toBe(0); await expect(download).toHaveCount(0); await expect(page.getByRole('button', { name: '取消导出', exact: true })).toBeEnabled(); await page.screenshot({ path: info.outputPath(`native-${phase}-handoff.png`) });
    const waiting = page.waitForEvent('download'); await page.evaluate(() => window.__pdfCodecProbe.release('B')); const artifact = await waiting;
    expect(artifact.suggestedFilename()).toBe('Background PDF_作答_2份.zip'); await artifact.saveAs(info.outputPath(`native-${phase}-recovered.zip`));
    await expect(download).toBeEnabled(); const final = await stored(); expect(final.records.find(task => task.id === a.id)).toEqual(a);
    expect(final.records.find(task => task.id === b.id)).toMatchObject({ status: 'succeeded', file: { mimeType: 'application/zip' } }); expect(final.files).toEqual([b.id]); expect(final.sizes).toEqual([b.id]);
    const settled = await page.evaluate(() => window.__pdfCodecProbe.state());
    expect(settled.filePutAttempts).toEqual([b.id]); expect(settled.encodes).toBe(5); expect(settled.artifactUrls).toHaveLength(1);
    expect(settled.artifactUrls[0]).toMatchObject({ type: 'application/zip' }); expect(settled.liveEncodedCanvases).toEqual([]); expect(settled.frames.some(frame => frame.connected)).toBe(false);
    expect(Object.values(settled.cells).every(cell => cell.released && !cell.expired && !cell.held && cell.canvas.every(value => value === 0))).toBe(true);
    const module: unknown = createRequire(new URL('../../apps/mobile/package.json', import.meta.url))('fflate');
    if (!module || typeof module !== 'object' || !('unzipSync' in module) || typeof module.unzipSync !== 'function') throw new Error('ZIP_READER');
    const files: unknown = module.unzipSync(await readFile(info.outputPath(`native-${phase}-recovered.zip`)));
    if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error('ZIP_FILES');
    expect(Object.keys(files).sort()).toEqual(['Background PDF_作答_第01份_2题_对2_错0.pdf', 'Background PDF_作答_第02份_2题_对2_错0.pdf']);
    for (const bytes of Object.values(files)) {
      if (!(bytes instanceof Uint8Array)) throw new Error('ZIP_ENTRY'); const pdf = Buffer.from(bytes);
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-'); expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(2);
    }
    expect(downloads).toBe(1); expect(calls()).toBe(0); expect(errors).toEqual([]); expect(await history(page)).toEqual(original);
  } finally { await page.evaluate(() => window.__pdfCodecProbe.restore()).catch(() => undefined); }
});
