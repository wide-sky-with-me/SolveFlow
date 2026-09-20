import { expect, it, vi } from 'vitest';
import { apiOrigin, base64, createClient, type ClientStore } from './client.js';
import { RunEventDecoder } from './sse.js';
import { RunSubmission } from './submission.js';
import { RunViewSchema } from '@solveflow/contracts/http';
const id = '11111111-1111-4111-8111-111111111111'; const other = '22222222-2222-4222-8222-222222222222';
const memory = (): ClientStore => { const map = new Map<string, string>(); return { async get(key) { return map.get(key) ?? null; }, async set(key, value) { map.set(key, value); }, async remove(key) { map.delete(key); } }; };
const event = (seq = 1, runId = id) => ({ schemaVersion: 1, runId, seq, type: 'run.status', status: 'solving' });
it('parses split UTF-8/CRLF events, heartbeats and duplicates without cross-run leakage', () => {
  const decoder = new RunEventDecoder(id); const source = new TextEncoder().encode(`: 中文心跳\r\n\r\ndata: ${JSON.stringify(event())}\r\n\r\ndata: ${JSON.stringify(event())}\n\n`);
  const events = [...source].flatMap(byte => decoder.push(new Uint8Array([byte]))); expect(events).toEqual([event()]);
  expect(() => decoder.push(new TextEncoder().encode(`data: ${JSON.stringify(event(2, other))}\n\n`))).toThrow('不匹配');
});
it('bounds unfinished events and rejects unsafe event schemas', () => {
  expect(() => new RunEventDecoder(id).push(new TextEncoder().encode('x'.repeat(130 * 1024)))).toThrow('过大');
  expect(() => new RunEventDecoder(id).push(new TextEncoder().encode(`data: ${JSON.stringify({ ...event(), thinking: 'private' })}\n\n`))).toThrow();
});
it.each(['https://api.example.test/path', 'https://user:secret@api.example.test', 'http://api.example.test', 'file:///tmp', 'https://api.example.test?token=x'])('rejects unsafe configured origin %s', value => { expect(() => apiOrigin(value, true)).toThrow(); });
it('permits local HTTP only in development and encodes private image bytes correctly', () => {
  expect(apiOrigin('http://10.0.2.2:3100', true)).toBe('http://10.0.2.2:3100'); expect(() => apiOrigin('http://10.0.2.2:3100')).toThrow();
  for (const text of ['', 'x', 'xy', 'xyz', '数学题图']) expect(base64(new TextEncoder().encode(text))).toBe(Buffer.from(text).toString('base64'));
});
it('native bootstrap persists bearer only in the supplied store and authenticates images/SSE without URL credentials', async () => {
  const token = 'a'.repeat(64) + '.' + 'b'.repeat(43); const requests: { url: string; init: RequestInit }[] = [];
  const transport = vi.fn(async (url: string, init: RequestInit = {}) => {
    requests.push({ url, init });
    if (url.endsWith('/native/bootstrap')) return Response.json({ schemaVersion: 1, ownerId: id, mode: 'demo', solvingAvailable: true, accessToken: token });
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${token}`); expect(init.credentials).toBe('omit'); expect(url).not.toContain(token);
    if (url.endsWith('/image')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } });
    return new Response(`data: ${JSON.stringify(event())}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  });
  const store = memory(); const client = createClient({ origin: 'https://api.example.test', native: true, store, transport });
  expect(await client.bootstrap()).not.toHaveProperty('accessToken'); expect(await client.image(id)).toBe('data:image/jpeg;base64,AQID');
  const seen: unknown[] = []; await client.events(id, 0, new AbortController().signal, value => seen.push(value)); expect(seen).toEqual([event()]);
  const restart = createClient({ origin: 'https://api.example.test', native: true, store, transport }); await restart.bootstrap();
  expect(new Headers(requests.at(-1)?.init.headers).get('authorization')).toBe(`Bearer ${token}`);
});
it('browser bootstrap keeps cookie credentials and never requests native bearer credentials', async () => {
  const transport = vi.fn(async (url: string, init: RequestInit = {}) => { expect(url).toBe('https://app.example.test/api/v1/bootstrap'); expect(init.credentials).toBe('same-origin'); expect(new Headers(init.headers).has('authorization')).toBe(false); return Response.json({ schemaVersion: 1, ownerId: id, mode: 'demo', solvingAvailable: true }); });
  await createClient({ origin: 'https://app.example.test', native: false, store: memory(), transport }).bootstrap(); expect(transport).toHaveBeenCalledOnce();
});
it('preserves an ambiguous submission key across restart and recovers by read-only lookup', async () => {
  const store = memory(); const payload = RunViewSchema.parse({ schemaVersion: 1, id: other, sessionId: id, status: 'queued', message: 'why', createdAt: new Date().toISOString(), seq: 1, outcome: null });
  const keys: string[] = []; let failed = true;
  const transport = vi.fn(async (url: string, init: RequestInit = {}) => {
    if (init.method === 'POST') { keys.push(new Headers(init.headers).get('Idempotency-Key') ?? ''); if (failed) { failed = false; throw new TypeError('lost reply'); } }
    expect(url).not.toContain('why'); return Response.json(payload);
  });
  const client = createClient({ origin: 'https://app.example.test', native: false, store, transport });
  const hash = async () => 'a'.repeat(64);
  await expect(new RunSubmission(client, store, hash, () => other).submit(id, 'why')).rejects.toThrow();
  expect(await store.get(`pending-run.${id}`)).not.toContain('why');
  expect(await new RunSubmission(client, store, hash, () => id).recover(id)).toEqual(payload);
  expect(keys).toHaveLength(1); expect(await store.get(`pending-run.${id}`)).toBeNull();
});
it('reuses the exact key for explicit retry and blocks edited text until the prior submission is resolved', async () => {
  const store = memory(); const keys: string[] = [];
  const transport = async (_url: string, init: RequestInit = {}) => { keys.push(new Headers(init.headers).get('Idempotency-Key') ?? ''); throw new TypeError('offline'); };
  const client = createClient({ origin: 'https://app.example.test', native: false, store, transport });
  const hash = async (text: string) => (text.includes('changed') ? 'b' : 'a').repeat(64);
  await expect(new RunSubmission(client, store, hash, () => other).submit(id, 'original')).rejects.toThrow();
  await expect(new RunSubmission(client, store, hash, () => id).submit(id, 'original')).rejects.toThrow();
  await expect(new RunSubmission(client, store, hash, () => id).submit(id, 'changed')).rejects.toThrow('尚未确认');
  expect(keys).toEqual([other, other]);
});
it('cancels an active stream and releases its reader without creating a run', async () => {
  const controller = new AbortController(); let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event())}\n\n`)); }, cancel() { cancelled = true; } });
  const transport = vi.fn(async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
  const client = createClient({ origin: 'https://app.example.test', native: false, store: memory(), transport });
  await client.events(id, 0, controller.signal, () => controller.abort()); expect(cancelled).toBe(true); expect(transport).toHaveBeenCalledOnce();
});

it('invokes browser fetch without rebinding its receiver', async () => {
  async function transport(this: unknown) { expect(this).toBeUndefined(); return Response.json({ schemaVersion: 1, ownerId: id, mode: 'demo', solvingAvailable: true }); }
  await createClient({ origin: 'https://app.example.test', native: false, store: memory(), transport }).bootstrap();
});

it('a rejected submission releases its key while another session keeps an uncertain request', async () => {
  const store = memory(); let denied = false;
  const transport = async () => { if (!denied) throw new TypeError('offline'); return Response.json({ error: { code: 'SERVICE_UNAVAILABLE', message: '服务暂不可用', retryable: true, traceId: id } }, { status: 503 }); };
  const client = createClient({ origin: 'https://app.example.test', native: false, store, transport });
  const submit = new RunSubmission(client, store, async () => 'a'.repeat(64), () => other);
  await expect(submit.submit(id, 'original')).rejects.toThrow(); denied = true;
  await expect(submit.submit(other, 'new question')).rejects.toThrow();
  expect(await store.get(`pending-run.${id}`)).not.toBeNull(); expect(await store.get(`pending-run.${other}`)).toBeNull();
});
