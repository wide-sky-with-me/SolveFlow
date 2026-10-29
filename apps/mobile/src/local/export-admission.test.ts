import { afterEach, expect, it, vi } from 'vitest';
import { waitForExportInitialization, yieldExportAdmission } from './export-admission.web';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
interface Port {
  onmessage: ((event: MessageEvent) => unknown) | null;
  onmessageerror: ((event: MessageEvent) => unknown) | null;
  close: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
}
function channelFixture() {
  const port1: Port = { onmessage: null, onmessageerror: null, close: vi.fn(), postMessage: vi.fn() };
  const port2: Port = { onmessage: null, onmessageerror: null, close: vi.fn(), postMessage: vi.fn() };
  const constructor = vi.fn(function () { return { port1, port2 }; });
  vi.stubGlobal('MessageChannel', constructor);
  return { port1, port2, constructor, deliver: () => port1.onmessage?.(new MessageEvent('message')) };
}

it('really yields to a message task rather than resolving in a microtask', async () => {
  let finished = false;
  const pending = yieldExportAdmission().then(() => { finished = true; });
  await Promise.resolve(); await Promise.resolve(); expect(finished).toBe(false);
  await pending; expect(finished).toBe(true);
});
it('settles on a message and releases both ports, handlers and cancellation listener', async () => {
  const f = channelFixture(); const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  const pending = yieldExportAdmission(controller.signal); expect(f.port2.postMessage).toHaveBeenCalledExactlyOnceWith('solveflow-pdf-admission');
  f.deliver(); await pending;
  expect(f.port1.close).toHaveBeenCalledTimes(1); expect(f.port2.close).toHaveBeenCalledTimes(1);
  expect(f.port1.onmessage).toBeNull(); expect(f.port1.onmessageerror).toBeNull(); expect(remove).toHaveBeenCalledTimes(1);
});
it('cancels a pending turn and ignores its late queued callback', async () => {
  const f = channelFixture(); const controller = new AbortController(); const reason = new Error('USER_CANCELLED');
  const outcome = yieldExportAdmission(controller.signal).then(() => null, (error: unknown) => error);
  const late = f.port1.onmessage; controller.abort(reason); expect(await outcome).toBe(reason);
  late?.(new MessageEvent('message')); await Promise.resolve();
  expect(f.port1.close).toHaveBeenCalledTimes(1); expect(f.port2.close).toHaveBeenCalledTimes(1);
});
it('does not construct a channel for an already cancelled operation', async () => {
  const f = channelFixture(); const controller = new AbortController(); controller.abort('CANCELLED');
  await expect(yieldExportAdmission(controller.signal)).rejects.toBe('CANCELLED'); expect(f.constructor).not.toHaveBeenCalled();
});
it.each(['construct', 'post', 'message', 'close'])('classifies %s failures without exposing host details', async stage => {
  const f = channelFixture(); const fail = () => { throw new Error('UNTRUSTED_HOST_DETAIL'); };
  if (stage === 'construct') f.constructor.mockImplementation(fail);
  if (stage === 'post') f.port2.postMessage.mockImplementation(fail);
  if (stage === 'close') f.port1.close.mockImplementation(fail);
  const outcome = yieldExportAdmission().then(() => null, (error: unknown) => error);
  if (stage === 'message') f.port1.onmessageerror?.(new MessageEvent('messageerror')); else if (stage === 'close') f.deliver();
  expect(await outcome).toMatchObject({ message: '导出暂未启动，请重试。' });
  if (stage !== 'construct') { expect(f.port1.close).toHaveBeenCalledTimes(1); expect(f.port2.close).toHaveBeenCalledTimes(1); }
});
it('keeps cancellation ahead of a simultaneous port cleanup failure', async () => {
  const f = channelFixture(); const controller = new AbortController(); const reason = new Error('USER_CANCELLED');
  f.port1.close.mockImplementation(() => { throw new Error('UNTRUSTED_CLEANUP'); });
  const outcome = yieldExportAdmission(controller.signal).then(() => null, (error: unknown) => error);
  controller.abort(reason); expect(await outcome).toBe(reason); expect(f.port2.close).toHaveBeenCalledTimes(1);
});
it('cancels only the initialization waiter and consumes a later shared rejection', async () => {
  let rejectLate: (cause: unknown) => void = () => {};
  const shared = new Promise<void>((_resolve, reject) => { rejectLate = reject; });
  const controller = new AbortController(); const reason = new Error('USER_CANCELLED');
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  const outcome = waitForExportInitialization(shared, controller.signal).then(() => null, (error: unknown) => error);
  controller.abort(reason); expect(await outcome).toBe(reason); rejectLate(new Error('LATE_INITIALIZATION'));
  await Promise.resolve(); expect(remove).toHaveBeenCalledTimes(1);
});
it('consumes initialization rejected synchronously with an already aborted signal', async () => {
  const controller = new AbortController(); controller.abort('CANCELLED');
  await expect(waitForExportInitialization(Promise.reject(new Error('LATE_ERROR')), controller.signal)).rejects.toBe('CANCELLED');
});
it('preserves initialization success and failure without cancellation', async () => {
  await expect(waitForExportInitialization(Promise.resolve())).resolves.toBeUndefined();
  const reason = new Error('INITIALIZATION_FAILED');
  await expect(waitForExportInitialization(Promise.reject(reason))).rejects.toBe(reason);
});

it('returns a storage inspection value and consumes a late rejection after cancellation', async () => {
  expect(await waitForExportInitialization(Promise.resolve({ available: 42 }))).toEqual({ available: 42 });
  const controller = new AbortController(); let reject = (_error: Error) => {};
  const pending = waitForExportInitialization(new Promise<number>((_resolve, no) => { reject = no; }), controller.signal).catch(() => 'cancelled');
  controller.abort(); expect(await pending).toBe('cancelled'); reject(new Error('LATE_INSPECTION_FAILURE')); await Promise.resolve();
});
