import { expect, it } from 'vitest';
import { LocalSettingsSchema, type LocalDiagnostic } from '@solveflow/contracts/local';
import type { SolverInput } from '@solveflow/contracts/agent';
import { solveOnDevice } from './mobile.js';
const answer = { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
const pass = { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'logic'], issues: [] };
const input: SolverInput = { schemaVersion: 1, role: 'solver', identity: { ownerId: 'device', sessionId: 'session', runId: 'run' }, message: '', image: { bytes: Uint8Array.of(1, 2), mimeType: 'image/jpeg' }, evidence: [], verificationMode: 'automatic', answerMode: 'brief', useBackup: true, focus: { sourceRunId: '00000000-0000-4000-8000-000000000001', kind: 'regenerate', content: '原题', verified: false } };
for (const api of ['openai-completions', 'openai-responses'] as const) it(`runs non-stream ${api} backup tool continuation and verification through Pi`, async () => {
  const profile = { provider: 'fixture', baseURL: 'https://fixture.invalid/v1', model: 'fixture', api, contextWindow: 32768, maxTokens: 8192, maxTokensField: 'max_tokens' };
  const settings = LocalSettingsSchema.parse({ schemaVersion: 1, solver: profile, verifier: profile, backup: profile });
  const diagnostics: LocalDiagnostic[] = []; let calls = 0;
  const result = await solveOnDevice(input, settings, { solver: 'fixture', verifier: 'fixture', backup: 'fixture' }, async (_url, init) => {
    const body: unknown = JSON.parse(String(init?.body)); expect(body).toMatchObject({ stream: false }); expect(body).not.toHaveProperty('stream_options');
    const n = ++calls; const value = n === 3 ? pass : answer;
    if (n === 2 && api === 'openai-responses') expect(JSON.stringify(body)).toContain('fixture-encrypted-signature');
    return Response.json(api === 'openai-completions'
      ? { id: 'chat_fixture', model: 'fixture', choices: [{ index: 0, message: n === 1 ? { role: 'assistant', content: null, tool_calls: [{ id: 'call_fixture', type: 'function', function: { name: 'read', arguments: JSON.stringify({ path: '/skills/math/SKILL.md' }) } }] } : { role: 'assistant', content: JSON.stringify(value) }, finish_reason: n === 1 ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }
      : { id: 'resp_fixture', model: 'fixture', status: 'completed', output: n === 1 ? [{ type: 'reasoning', id: 'rs_fixture', summary: [], encrypted_content: 'fixture-encrypted-signature' }, { type: 'function_call', id: 'fc_fixture', call_id: 'call_fixture', name: 'read', arguments: JSON.stringify({ path: '/skills/math/SKILL.md' }) }] : [{ type: 'message', id: 'msg_fixture', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(value), annotations: [] }] }], usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } });
  }, new AbortController().signal, () => {}, entry => diagnostics.push(entry));
  expect({ result, calls, diagnostics }).toMatchObject({ result: { status: 'completed', verified: true, candidate: { answer: 'x=2' } }, calls: 3 });
  expect(diagnostics.filter(entry => entry.event === 'request').every(entry => entry.streaming === false)).toBe(true);
  expect(diagnostics.filter(entry => entry.event === 'response').every(entry => entry.responseFormat === 'json')).toBe(true);
  expect(diagnostics).toContainEqual(expect.objectContaining({ event: 'tool', toolName: 'read', toolStatus: 'completed' }));
  expect(JSON.stringify(diagnostics)).not.toContain('fixture-encrypted-signature');
});

it.each(['incomplete', 'failed', 'queued'])('does not accept a non-stream Responses %s envelope as a valid answer', async status => {
  const profile = { provider: 'fixture', baseURL: 'https://fixture.invalid/v1', model: 'fixture', api: 'openai-responses', contextWindow: 32768, maxTokens: 8192, maxTokensField: 'max_tokens' };
  const settings = LocalSettingsSchema.parse({ schemaVersion: 1, solver: profile, verifier: null, backup: profile }); let calls = 0;
  const result = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null, backup: 'fixture' }, async () => { calls++; return Response.json({ id: 'resp_fixture', status, output: [{ type: 'message', id: 'msg_fixture', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(answer), annotations: [] }] }], incomplete_details: { reason: 'max_output_tokens' }, error: { code: 'fixture_failure', message: 'synthetic private failure' } }); }, new AbortController().signal, () => {});
  expect(result).toMatchObject({ status: 'failed', verified: false }); expect(calls).toBeLessThanOrEqual(2);
  expect(JSON.stringify(result)).not.toContain('synthetic private failure');
});
