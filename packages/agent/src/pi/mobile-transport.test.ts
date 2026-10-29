import { expect, it } from 'vitest';
import { LocalSettingsSchema } from '@solveflow/contracts/local';
import { MAX_MODEL_STREAM_BYTES } from '@solveflow/contracts/agent';
import { modelTransport } from './mobile.js';
const profile = LocalSettingsSchema.parse({ schemaVersion: 1, solver: { provider: 'fixture', baseURL: 'https://fixture.invalid/v1', model: 'fixture', api: 'openai-completions', contextWindow: 32768, maxTokens: 8192, maxTokensField: 'max_tokens' }, verifier: null }).solver;
const url = `${profile.baseURL}/chat/completions`;
it('accepts a streamed response over the old 1MiB client limit without buffering the whole body', async () => {
  let chunks = 0;
  const upstream = new Response(new ReadableStream<Uint8Array>({ pull(controller) { if (++chunks > 32) controller.close(); else controller.enqueue(new Uint8Array(64 * 1024)); } }), { headers: { 'content-type': 'text/event-stream' } });
  const response = await modelTransport(profile, async () => upstream)(url, { method: 'POST' });
  const reader = response.body!.getReader(); let size = 0;
  try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; } }
  finally { reader.releaseLock(); }
  expect(size).toBe(2 * 1024 * 1024);
  expect(upstream.body?.locked).toBe(false);
});
it.each(['text/event-stream', 'application/json'])('rejects oversized %s, cancels upstream and records a size limit instead of a timeout', async type => {
  let cancelled = 0; const failures: unknown[] = [];
  const limit = type === 'text/event-stream' ? MAX_MODEL_STREAM_BYTES : 1024 * 1024;
  const upstream = new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(limit + 1)); }, cancel() { cancelled++; } }), { headers: { 'content-type': type } });
  const response = await modelTransport(profile, async () => upstream, (status, error, reason) => { if (error) failures.push({ status, code: error.code, reason }); })(url, { method: 'POST' });
  await expect(response.body!.getReader().read()).rejects.toThrow('MODEL_OUTPUT_INVALID');
  expect(cancelled).toBe(1); expect(upstream.body?.locked).toBe(false);
  expect(failures).toEqual([{ status: 200, code: 'MODEL_OUTPUT_INVALID', reason: 'output_limit' }]);
});
it('identifies an explicitly marked upload timeout without exposing the response body', async () => {
  const failures: unknown[] = []; let calls = 0;
  const transport = modelTransport(profile, async () => { calls++; return new Response('private-upload-canary', { status: 408, headers: { 'x-solveflow-request-failure': 'upload-timeout' } }); }, (status, error, reason) => failures.push({ status, code: error?.code, reason }));
  await expect(transport(url, { method: 'POST' })).rejects.toMatchObject({ code: 'MODEL_UPLOAD_TIMEOUT' });
  expect(calls).toBe(1); expect(failures).toEqual([{ status: 408, code: 'MODEL_UPLOAD_TIMEOUT', reason: 'upload_timeout' }]);
  expect(JSON.stringify(failures)).not.toContain('private-upload-canary');
});
it.each([{ status: 408, headers: {} }, { status: 400, headers: { 'x-solveflow-request-failure': 'upload-timeout' } }])('does not reinterpret an unmarked or mismatched HTTP failure: $status', async ({ status, headers }) => {
  const transport = modelTransport(profile, async () => new Response('', { status, headers }));
  await expect(transport(url, { method: 'POST' })).rejects.toMatchObject({ code: 'MODEL_REQUEST_REJECTED' });
});
