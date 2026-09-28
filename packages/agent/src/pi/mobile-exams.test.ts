import { describe, expect, it } from 'vitest';
import { LocalSettingsSchema, type ExamType } from '@solveflow/contracts/local';
import { type SolverInput } from '@solveflow/contracts/agent';
import { preloadExamResources, readMobileSkill, solveOnDevice, modelTransport, testModelConnection } from './mobile.js';
const settings = LocalSettingsSchema.parse({ schemaVersion: 1, exam: 'sat', solver: { provider: 'fixture', baseURL: 'https://fixture.invalid/v1', model: 'fixture-model', api: 'openai-responses', contextWindow: 32768, maxTokens: 8192, maxTokensField: 'max_tokens' }, verifier: null });
const input: SolverInput = { schemaVersion: 1, role: 'solver', exam: 'sat', identity: { ownerId: 'local-device', sessionId: 'session', runId: 'run' }, message: '', image: { bytes: Uint8Array.of(1, 2, 3), mimeType: 'image/jpeg' }, evidence: [], answerMode: 'brief', verificationMode: 'manual' };
const candidate = { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3，求x', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
function response(value: object, call?: { name: string; arguments: object }) {
  const item = call ? { type: 'function_call', id: 'fc_fixture', call_id: 'call_fixture', name: call.name, arguments: JSON.stringify(call.arguments) } : { type: 'message', id: 'msg_fixture', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(value), annotations: [] }] };
  const events = [{ type: 'response.created', response: { id: 'resp_fixture' } }, { type: 'response.output_item.added', output_index: 0, item: call ? { ...item, arguments: '' } : { ...item, content: [] } }, { type: 'response.output_item.done', output_index: 0, item }, { type: 'response.completed', response: { id: 'resp_fixture', status: 'completed', output: [item], usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 } } }];
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
}
describe('exam context and Responses', () => {
  it.each(['sat', 'act', 'ap'] as const)('preloads exactly the reviewed %s resources without dropping their content', exam => {
    const text = preloadExamResources(exam); expect(text).toContain(readMobileSkill('/skills/exams/SKILL.md')); expect(text).toContain(readMobileSkill(`/skills/exams/references/${exam}.md`));
    for (const other of ['sat', 'act', 'ap']) if (exam !== other) expect(text).not.toContain(`来源：/skills/exams/references/${other}.md`);
    expect(text).not.toContain('AGENTS.md'); expect(text).toContain('无需重复read');
  });
  it('keeps unspecified exams on demand and rejects unapproved paths', () => { expect(preloadExamResources()).toBe(''); expect(() => preloadExamResources('../../.env' as ExamType)).toThrow(); });
  it('sends original image and selected rules on the first Responses request, completes tool continuation and keeps default reasoning unspecified', async () => {
    const bodies: unknown[] = []; let calls = 0;
    const outcome = await solveOnDevice(input, settings, { solver: 'synthetic', verifier: null }, async (url, init) => {
      expect(url).toBe('https://fixture.invalid/v1/responses'); expect(init?.redirect).toBe('error'); expect(init?.credentials).toBe('omit');
      bodies.push(JSON.parse(String(init?.body))); calls++;
      return calls === 1 ? response({}, { name: 'calculate', arguments: { schemaVersion: 1, expression: '3-1', angleUnit: 'rad' } }) : response(candidate);
    }, new AbortController().signal, () => {});
    expect(outcome).toMatchObject({ status: 'completed', verified: false, candidate: { answer: 'x=2' } }); expect(calls).toBe(2);
    for (const body of bodies) { expect(body).toMatchObject({ model: 'fixture-model', store: false, max_output_tokens: 8192, include: ['reasoning.encrypted_content'] }); expect(body).not.toHaveProperty('reasoning'); expect(body).not.toHaveProperty('max_tokens'); }
    expect(JSON.stringify(bodies[0])).toContain('data:image/jpeg;base64,AQID'); expect(JSON.stringify(bodies[0])).toContain('已加载考试方法'); expect(JSON.stringify(bodies[0])).toContain('来源：/skills/exams/references/sat.md');
    expect(JSON.stringify(bodies[1])).toContain('function_call_output');
  });
  it.each(['low', 'medium', 'high'] as const)('uses native Responses %s reasoning regardless of the old Chat protocol field', async effort => {
    const profile = { ...settings.solver, thinking: { mode: 'on' as const, effort, protocol: 'thinking-type' as const } }; let body: unknown;
    await testModelConnection(profile, 'synthetic', async (_url, init) => { body = JSON.parse(String(init?.body)); return response({ ok: true }); }, new AbortController().signal);
    expect(body).toMatchObject({ reasoning: { effort } }); expect(body).not.toHaveProperty('thinking'); expect(body).not.toHaveProperty('reasoning_effort');
  });
  it('keeps unknown and legacy record context independent of the changed setting', async () => {
    let body: unknown; const outcome = await solveOnDevice({ ...input, exam: 'general' }, settings, { solver: 'synthetic', verifier: null }, async (_url, init) => { body = JSON.parse(String(init?.body)); return response(candidate); }, new AbortController().signal, () => {});
    expect(outcome.status).toBe('completed'); expect(JSON.stringify(body)).not.toContain('已加载考试方法');
  });
  it('rejects the wrong endpoint and maps provider errors without fallback', async () => {
    let calls = 0; const transport = modelTransport(settings.solver, async () => { calls++; return response(candidate); });
    await expect(transport('https://fixture.invalid/v1/chat/completions', { method: 'POST' })).rejects.toThrow(); expect(calls).toBe(0);
    const outcome = await solveOnDevice(input, settings, { solver: 'synthetic', verifier: null }, async () => { calls++; return new Response('{}', { status: 400 }); }, new AbortController().signal, () => {});
    expect(outcome).toMatchObject({ status: 'failed', error: { code: 'MODEL_UNAVAILABLE' } }); expect(calls).toBe(1);
  });
  it('cancels Responses without accepting late output', async () => {
    const controller = new AbortController(); const outcome = await solveOnDevice(input, settings, { solver: 'synthetic', verifier: null }, async () => { controller.abort(); return response(candidate); }, controller.signal, () => {});
    expect(outcome.status).toBe('cancelled');
  });
  it('keeps verification tool-free, sends its own image/context and never persists reasoning', async () => {
    let calls = 0; const diagnostics: unknown[] = [];
    const outcome = await solveOnDevice({ ...input, verificationMode: 'automatic' }, settings, { solver: 'synthetic', verifier: null }, async (_url, init) => {
      const body: unknown = JSON.parse(String(init?.body)); calls++;
      if (calls === 2) { expect(body).not.toHaveProperty('tools'); expect(JSON.stringify(body)).toContain('data:image/jpeg;base64,AQID'); expect(JSON.stringify(body)).toContain('来源：/skills/exams/references/sat.md'); }
      return response(calls === 1 ? candidate : { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'arithmetic'], issues: [] });
    }, new AbortController().signal, () => {}, entry => diagnostics.push(entry));
    expect(outcome).toMatchObject({ status: 'completed', verified: true }); expect(calls).toBe(2);
    expect(JSON.stringify(diagnostics)).not.toContain('encrypted_content'); expect(JSON.stringify(outcome)).not.toContain('encrypted_content');
  });
  it('retains the single bounded format repair on Responses', async () => {
    let calls = 0;
    const outcome = await solveOnDevice(input, settings, { solver: 'synthetic', verifier: null }, async () => response(++calls === 1 ? {} : candidate), new AbortController().signal, () => {});
    expect(outcome.status).toBe('completed'); expect(calls).toBe(2);
    calls = 0;
    const failed = await solveOnDevice(input, settings, { solver: 'synthetic', verifier: null }, async () => { calls++; return response({}); }, new AbortController().signal, () => {});
    expect(failed).toMatchObject({ status: 'failed', error: { code: 'MODEL_OUTPUT_INVALID' } }); expect(calls).toBe(2);
  });
});
