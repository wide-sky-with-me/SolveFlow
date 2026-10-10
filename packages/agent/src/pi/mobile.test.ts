import { describe, expect, it, vi } from 'vitest';
import { LocalSettingsSchema } from '@solveflow/contracts/local';
import { solveOnDevice, modelTransport, readMobileSkill, testModelConnection, thinkingLevelOf } from './mobile.js';
import { AnswerCandidateSchema, type SolverInput } from '@solveflow/contracts/agent';
const settings = LocalSettingsSchema.parse({ schemaVersion: 1, solver: { provider: 'my-provider', baseURL: 'https://model.invalid/v1', model: 'user-selected-model', api: 'openai-completions', contextWindow: 32768, maxTokens: 8192, maxTokensField: 'max_tokens' }, verifier: null });
const input: SolverInput = { schemaVersion: 1, role: 'solver', identity: { ownerId: 'local-device', sessionId: 'test-session', runId: 'test-run' }, message: '求解x+1=3', image: { bytes: Uint8Array.of(1, 2, 3), mimeType: 'image/jpeg' }, evidence: [] };
const candidate = { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3，求x', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [{ id: 's1', title: '移项', explanation: '两边同时减1，得x=2。' }], knowledgePoints: ['等式性质'], knowledgeDetails: [{ name: '等式性质', explanation: '等式两边同时减去同一个数，等式仍成立。', application: '两边同时减1。' }], citationIds: [], clarificationQuestions: [] };
const pass = { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'arithmetic', 'logic'], issues: [] };
it('solves with tools and verifies when native AbortSignal lacks throwIfAborted', async () => {
  // RN 0.86 uses abort-controller 3; Expo adds static any/timeout but not this method.
  const method = vi.spyOn(AbortSignal.prototype, 'throwIfAborted');
  Object.defineProperty(AbortSignal.prototype, 'throwIfAborted', { configurable: true, value: undefined });
  try {
    await testModelConnection(settings.solver, 'fixture', async () => sse({ ok: true }), new AbortController().signal);
    let calls = 0;
    const outcome = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null }, async () => {
      calls++;
      if (calls === 1) return tool('read', { path: '/skills/math/SKILL.md' });
      if (calls === 2) return tool('calculate', { schemaVersion: 1, expression: '3-1', angleUnit: 'rad' });
      return sse(calls === 3 ? candidate : pass);
    }, new AbortController().signal, () => {});
    expect(outcome).toMatchObject({ status: 'completed', verified: true });
    expect(calls).toBe(4);
    const cancelled = new AbortController(); cancelled.abort();
    const late = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null }, async () => { throw new Error('must not call provider'); }, cancelled.signal, () => {});
    expect(late).toMatchObject({ status: 'cancelled' });
  } finally { method.mockRestore(); }
});
function sse(content: object) { return new Response(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'user-selected-model', choices: [{ index: 0, delta: { role: 'assistant', content: JSON.stringify(content) }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } }); }
it.each([63, 0, null, '', '   '])('normalizes optional generated sourceNumber %s without another model request', async sourceNumber => {
  let calls = 0;
  const result = await solveOnDevice({ ...input, verificationMode: 'manual' }, settings, { solver: 'fixture', verifier: null }, async () => {
    calls++;
    return sse(calls === 1 ? { ...candidate, problem: { ...candidate.problem, sourceNumber } } : candidate);
  }, new AbortController().signal, () => {});
  expect(result.status).toBe('completed');
  expect(calls).toBe(1);
  if (result.status === 'completed') {
    if (typeof sourceNumber === 'number') expect(result.candidate.problem.sourceNumber).toBe(String(sourceNumber));
    else expect(result.candidate.problem).not.toHaveProperty('sourceNumber');
  }
});
it('still repairs a substantive invalid answer when sourceNumber can be normalized', async () => {
  let calls = 0;
  const result = await solveOnDevice({ ...input, verificationMode: 'manual' }, settings, { solver: 'fixture', verifier: null }, async () => {
    calls++;
    return sse(calls === 1 ? { ...candidate, answer: null, problem: { ...candidate.problem, sourceNumber: 63 } } : candidate);
  }, new AbortController().signal, () => {});
  expect(result.status).toBe('completed'); expect(calls).toBe(2);
});
describe('on-device Pi', () => {
  it.each([
    ['disabled-thinking', { thinking: { type: 'disabled' } }],
    ['disabled-enable-thinking', { enable_thinking: false }],
    ['disabled-reasoning-effort', { reasoning_effort: 'none' }],
  ] as const)('sends configured %s on connection, every tool round, and verification', async (thinkingControl, expected) => {
    const configured = LocalSettingsSchema.parse({ ...settings, solver: { ...settings.solver, thinkingControl } });
    const bodies: unknown[] = [];
    await testModelConnection(configured.solver, 'fixture', async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return sse({ ok: true }); }, new AbortController().signal);
    let calls = 0;
    const result = await solveOnDevice(input, configured, { solver: 'fixture', verifier: null }, async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body))); calls++;
      return calls === 1 ? tool('read', { path: '/skills/math/SKILL.md' }) : sse(calls === 2 ? candidate : pass);
    }, new AbortController().signal, () => {});
    expect(result.status).toBe('completed'); expect(bodies).toHaveLength(4);
    for (const body of bodies) {
      expect(body).toMatchObject({ model: 'user-selected-model', ...expected });
      for (const name of ['thinking', 'enable_thinking', 'reasoning_effort']) if (!(name in expected)) expect(body).not.toHaveProperty(name);
    }
  });
  it('keeps unconfigured providers unchanged and rejects unknown thinking controls', async () => {
    const bodies: unknown[] = [];
    for (const thinkingControl of [undefined, 'provider-default']) {
      const configured = LocalSettingsSchema.parse({ ...settings, solver: { ...settings.solver, thinkingControl } });
      await testModelConnection(configured.solver, 'fixture', async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return sse({ ok: true }); }, new AbortController().signal);
    }
    for (const body of bodies) for (const name of ['thinking', 'enable_thinking', 'reasoning_effort']) expect(body).not.toHaveProperty(name);
    expect(LocalSettingsSchema.safeParse({ ...settings, solver: { ...settings.solver, thinkingControl: 'guess-from-model-name' } }).success).toBe(false);
  });
  it.each([
    ['thinking-type', 'low', { thinking: { type: 'enabled' }, reasoning_effort: 'low' }],
    ['thinking-type', 'medium', { thinking: { type: 'enabled' }, reasoning_effort: 'high' }],
    ['thinking-type', 'high', { thinking: { type: 'enabled' }, reasoning_effort: 'max' }],
    ['enable-thinking', 'medium', { enable_thinking: true, reasoning_effort: 'medium' }],
    ['reasoning-effort', 'high', { reasoning_effort: 'high' }],
  ] as const)('sends %s thinking at %s effort on connection, tool rounds and verification', async (protocol, effort, expected) => {
    const configured = LocalSettingsSchema.parse({ ...settings, solver: { ...settings.solver, thinking: { mode: 'on', protocol, effort } } });
    const bodies: unknown[] = [];
    await testModelConnection(configured.solver, 'fixture', async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return sse({ ok: true }); }, new AbortController().signal);
    let calls = 0;
    const result = await solveOnDevice(input, configured, { solver: 'fixture', verifier: null }, async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body))); calls++;
      return calls === 1 ? tool('read', { path: '/skills/math/SKILL.md' }) : sse(calls === 2 ? candidate : pass);
    }, new AbortController().signal, () => {});
    expect(result.status).toBe('completed'); expect(bodies).toHaveLength(4);
    for (const body of bodies) expect(body).toMatchObject({ model: 'user-selected-model', ...expected });
  });
  it('keeps stored controls readable and stops thinking when the switch is off', async () => {
    const bodies: unknown[] = [];
    const stored = LocalSettingsSchema.parse({ ...settings, solver: { ...settings.solver, thinkingControl: 'disabled-thinking' } });
    await testModelConnection(stored.solver, 'fixture', async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return sse({ ok: true }); }, new AbortController().signal);
    expect(bodies[0]).toMatchObject({ thinking: { type: 'disabled' } }); expect(bodies[0]).not.toHaveProperty('reasoning_effort');
    expect(thinkingLevelOf({ ...settings.solver, thinking: { mode: 'on', effort: 'high' } })).toBe('high');
    expect(thinkingLevelOf({ ...settings.solver, thinking: { mode: 'off' } })).toBe('off');
    expect(thinkingLevelOf({ ...settings.solver, thinkingControl: 'disabled-thinking' })).toBe('off');
    expect(thinkingLevelOf(settings.solver)).toBe('off');
  });
  it('uses configured endpoint/model and independently supplies the image to verifier', async () => {
    const calls: { url: string; body: string }[] = [];
    const result = await solveOnDevice(input, settings, { solver: 'fixture-secret', verifier: null }, async (url, init) => { calls.push({ url: String(url), body: String(init?.body) }); expect(new Headers(init?.headers).get('authorization')).toBe('Bearer fixture-secret'); expect(init?.redirect).toBe('error'); return sse(calls.length === 1 ? candidate : pass); }, new AbortController().signal, () => {});
    expect(result).toMatchObject({ status: 'completed', verified: true }); expect(calls).toHaveLength(2);
    for (const call of calls) { expect(call.url).toBe('https://model.invalid/v1/chat/completions'); expect(call.body).toContain('user-selected-model'); expect(call.body).toContain('data:image/jpeg;base64,AQID'); expect(call.body).not.toContain('AGENTS.md'); }
    expect(JSON.parse(calls[1]!.body).tools).toBeUndefined();
  });
  it('forces one revision after FAIL and refuses a policy-violating candidate', async () => {
    let calls = 0;
    const fail = { schemaVersion: 1, verdict: 'fail', checked: ['transcription'], issues: [{ code: 'ARITHMETIC', message: '请核对计算' }] };
    const outcome = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null }, async () => sse([candidate, fail, candidate, pass][calls++]!), new AbortController().signal, () => {});
    expect(outcome).toMatchObject({ status: 'completed', verified: true }); expect(calls).toBe(4);
    calls = 0;
    const refused = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null }, async () => sse(calls++ === 0 ? candidate : { ...fail, issues: [{ code: 'POLICY_VIOLATION', message: '超出解题范围' }] }), new AbortController().signal, () => {});
    expect(refused).toMatchObject({ status: 'needs_clarification', candidate: { refusalReason: 'policy' } });
  });
  it('allows only embedded skill paths, and prevents alternate request destinations', async () => {
    expect(readMobileSkill('/skills/math/SKILL.md')).toContain('calculate');
    for (const path of ['/skills/math/../../AGENTS.md', '/home/private/.env', '/skills/unknown/SKILL.md']) expect(() => readMobileSkill(path)).toThrow();
    let calls = 0; const transport = modelTransport(settings.solver, async () => { calls++; return sse(pass); });
    await expect(transport('https://other.invalid/chat/completions', { method: 'POST' })).rejects.toThrow(); expect(calls).toBe(0);
  });
  it('cancels without accepting a late result', async () => {
    const controller = new AbortController();
    const outcome = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null }, async () => { controller.abort(); return sse(candidate); }, controller.signal, () => {});
    expect(outcome).toMatchObject({ status: 'cancelled', verified: false });
  });
});
function tool(name: string, args: object) { return new Response(`data: ${JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } }); }
it('Pi actually executes Skill read and numeric calculation before independent verification', async () => {
  const bodies: string[] = [];
  const outcome = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null }, async (_url, init) => { bodies.push(String(init?.body)); if (bodies.length === 1) return tool('read', { path: '/skills/math/SKILL.md' }); if (bodies.length === 2) return tool('calculate', { schemaVersion: 1, expression: '3-1', angleUnit: 'rad' }); return sse(bodies.length === 3 ? candidate : pass); }, new AbortController().signal, () => {});
  expect(outcome).toMatchObject({ status: 'completed', verified: true }); expect(bodies).toHaveLength(4); expect(bodies[2]).toContain('tool_call_id'); expect(bodies[2]).toContain('approximate');
});
it('stops a model that keeps requesting tools after a final-answer-only turn', async () => {
  let calls = 0;
  const outcome = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null }, async () => { calls++; return tool('read', { path: '/skills/math/SKILL.md' }); }, new AbortController().signal, () => {});
  expect(calls).toBe(5); expect(outcome).toMatchObject({ status: 'failed', error: { code: 'MODEL_OUTPUT_INVALID' } });
});
it('rejects malformed, credential-bearing and insecure model settings', () => {
  for (const baseURL of ['http://model.invalid/v1', 'https://key@model.invalid/v1', 'https://model.invalid/v1?key=bad', 'https://model.invalid/v1#key']) expect(LocalSettingsSchema.safeParse({ ...settings, solver: { ...settings.solver, baseURL } }).success).toBe(false);
});
it('does not require constructing a global Response for native streamed responses', async () => {
  const response = sse(pass); const original = globalThis.Response;
  try {
    Object.defineProperty(globalThis, 'Response', { configurable: true, value: class { constructor() { throw new Error('Native Response cannot accept streams'); } } });
    const result = await modelTransport(settings.solver, async () => response)('https://model.invalid/v1/chat/completions', { method: 'POST' });
    expect(result.headers.get('content-type')).toBe('text/event-stream'); const reader = result.body!.getReader(); expect((await reader.read()).value?.byteLength).toBeGreaterThan(0); await reader.cancel(); reader.releaseLock();
  } finally { Object.defineProperty(globalThis, 'Response', { configurable: true, value: original }); }
});

it.each([[400, 'MODEL_REQUEST_REJECTED'], [413, 'MODEL_REQUEST_REJECTED'], [422, 'MODEL_REQUEST_REJECTED'], [401, 'CAPABILITY_DENIED'], [402, 'SPEND_LIMIT'], [404, 'MODEL_UNAVAILABLE'], [429, 'MODEL_RATE_LIMITED'], [503, 'MODEL_UNAVAILABLE']] as const)('preserves HTTP %i failure through Pi and records only safe metadata', async (status, code) => {
  const entries: import('@solveflow/contracts/local').LocalDiagnostic[] = [];
  const outcome = await solveOnDevice(input, settings, { solver: 'private-fixture-key', verifier: null }, async () => new Response('private-provider-body', { status }), new AbortController().signal, () => {}, entry => entries.push(entry));
  expect(outcome).toMatchObject({ status: 'failed', error: { code } });
  expect(entries).toContainEqual(expect.objectContaining({ event: 'failure', httpStatus: status, reason: 'http' }));
  expect(JSON.stringify(entries)).not.toMatch(/private-fixture-key|private-provider-body|x\+1=3/);
});
it('explicitly disables tools for the final answer and its one format repair', async () => {
  const bodies: Record<string, unknown>[] = [];
  const entries: import('@solveflow/contracts/local').LocalDiagnostic[] = [];
  const result = await solveOnDevice({ ...input, verificationMode: 'manual' }, settings, { solver: 'fixture', verifier: null }, async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    if (bodies.length <= 3) return tool('read', { path: '/skills/math/SKILL.md' });
    return sse(bodies.length === 4 ? {} : candidate);
  }, new AbortController().signal, () => {}, entry => entries.push(entry));
  expect(result.status).toBe('completed'); expect(bodies).toHaveLength(5);
  expect(entries.filter(entry => entry.event === 'request').slice(3).map(entry => entry.toolStopReason)).toEqual(['repeated', 'repeated']);
  expect(bodies[0]).not.toHaveProperty('tool_choice');
  for (const body of bodies.slice(3)) {
    expect(body.tool_choice).toBe('none'); expect(body.tools).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('tool_call_id');
    expect(JSON.stringify(body)).toContain('工具观察');
  }
});
it('keeps schema repair tool-free even when no tool limit was reached', async () => {
  const bodies: Record<string, unknown>[] = [];
  const result = await solveOnDevice({ ...input, verificationMode: 'manual' }, settings, { solver: 'fixture', verifier: null }, async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body))); return sse(bodies.length === 1 ? {} : candidate);
  }, new AbortController().signal, () => {});
  expect(result.status).toBe('completed'); expect(bodies).toHaveLength(2);
  expect(bodies[1]).toHaveProperty('tool_choice', 'none'); expect(bodies[1]?.tools ?? []).toEqual([]);
});
it.each([[400, 'MODEL_REQUEST_REJECTED'], [429, 'MODEL_RATE_LIMITED']] as const)('keeps connection-test HTTP %i classification without exposing provider text', async (status, code) => {
  await expect(testModelConnection(settings.solver, 'fixture', async () => new Response('private-provider-body', { status }), new AbortController().signal)).rejects.toMatchObject({ code });
});
it('preserves network failure instead of misclassifying it as output format', async () => {
  const outcome = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null }, async () => { throw new Error('private request details'); }, new AbortController().signal, () => {});
  expect(outcome).toMatchObject({ status: 'failed', error: { code: 'MODEL_UNAVAILABLE' } });
});
it('repairs valid JSON with missing schema fields once, then independently verifies', async () => {
  let calls = 0; const entries: import('@solveflow/contracts/local').LocalDiagnostic[] = [];
  const result = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null }, async () => sse([ { ...candidate, problem: undefined }, candidate, pass ][calls++]!), new AbortController().signal, () => {}, entry => entries.push(entry));
  expect(result).toMatchObject({ status: 'completed', verified: true }); expect(calls).toBe(3);
  expect(entries).toContainEqual(expect.objectContaining({ event: 'validation', reason: 'schema', fields: ['problem'] }));
  calls = 0;
  const failure = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null }, async () => { calls++; return sse({ kind: 'answer', answer: 'incomplete' }); }, new AbortController().signal, () => {});
  expect(failure).toMatchObject({ status: 'failed', error: { code: 'MODEL_OUTPUT_INVALID' } }); expect(calls).toBe(2);
});
it('explains single-question grouping in the bounded format repair without inventing another question', async () => {
  const bodies: string[] = [];
  const result = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null }, async (_url, init) => {
    bodies.push(String(init?.body));
    return sse([{ ...candidate, questions: [] }, candidate, pass][bodies.length - 1]!);
  }, new AbortController().signal, () => {});
  expect(result).toMatchObject({ status: 'completed', verified: true });
  expect(bodies).toHaveLength(3);
  expect(bodies[1]).toContain('单题省略questions');
  expect(bodies[1]).toContain('同一道题的小问');
});
it('identifies token truncation and does not silently publish the partial answer', async () => {
  const entries: import('@solveflow/contracts/local').LocalDiagnostic[] = [];
  const response = async () => new Response((await sse(candidate).text()).replace('"finish_reason":"stop"', '"finish_reason":"length"'));
  const result = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null }, response, new AbortController().signal, () => {}, entry => entries.push(entry));
  expect(result).toMatchObject({ status: 'failed', error: { code: 'MODEL_OUTPUT_INVALID' } });
  expect(entries).toContainEqual(expect.objectContaining({ reason: 'truncated' }));
});
it('uses the injected native phase timer and preserves verifier timeout semantics', async () => {
  let expire = () => {}; const scheduled: number[] = []; let cleared = 0; let calls = 0;
  const result = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null }, async () => {
    calls++; if (calls === 1) return sse(candidate);
    expire(); throw new Error('aborted by native phase timer');
  }, new AbortController().signal, () => {}, () => {}, (callback, ms) => { scheduled.push(ms); expire = callback; return () => { cleared++; }; });
  expect(result).toMatchObject({ status: 'completed', verified: false, warning: 'MODEL_TIMEOUT' });
  expect(scheduled).toEqual([240000, 300000]); expect(cleared).toBe(2);
});

it('sanitizes unescaped LaTeX backslashes and fences in verifier JSON output', async () => {
  let calls = 0;
  // Markdown fence and raw LaTeX backslashes inside message
  const fail = { schemaVersion: 1, verdict: 'fail', checked: ['transcription'], issues: [{ code: 'ARITHMETIC', message: '步骤中 \\frac{1}{2} 与 \\sqrt{3} 符号错误' }] };
  const rawVerifierText = '```json\n' + JSON.stringify(fail) + '\n```';
  const outcome = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null }, async () => {
    calls++;
    if (calls === 1) return sse(candidate);
    if (calls === 2) {
      return new Response(`data: ${JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', content: rawVerifierText }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    }
    // Solver revision on call 3, then verifier pass on call 4
    return sse(calls === 3 ? candidate : pass);
  }, new AbortController().signal, () => {});
  expect(outcome).toMatchObject({ status: 'completed', verified: true });
  expect(calls).toBe(4);
});

it('allows verifier 1 format repair when initial JSON has invalid syntax', async () => {
  let calls = 0;
  const outcome = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null }, async () => {
    calls++;
    if (calls === 1) return sse(candidate);
    if (calls === 2) {
      return new Response(`data: ${JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', content: '{"verdict": "pass", broken' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    }
    return sse(pass);
  }, new AbortController().signal, () => {});
  expect(outcome).toMatchObject({ status: 'completed', verified: true });
  expect(calls).toBe(3);
});

it('keeps the 300s verifier budget when candidate includes figures or illustrations', async () => {
  const scheduled: number[] = [];
  const candidateWithIllustration = {
    ...candidate,
    problem: {
      ...candidate.problem,
      illustrations: [{ id: 'i1', alt: '几何示意图', x: 0, y: 0, width: 1, height: 1 }],
    },
  };
  const passWithDiagram = { ...pass, checked: ['transcription', 'arithmetic', 'logic', 'diagram'] };
  let calls = 0;
  const result = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null }, async () => {
    calls++;
    return sse(calls === 1 ? candidateWithIllustration : passWithDiagram);
  }, new AbortController().signal, () => {}, () => {}, (_callback, ms) => {
    scheduled.push(ms);
    return () => {};
  });
  expect(scheduled).toEqual([240000, 300000]);
  expect(result).toMatchObject({ status: 'completed', verified: true });
});

// Self-authored curriculum fixtures; exercises routing/schema/Pi Skill loading, not LLM accuracy.
it.each([
  { subject: 'english', question: 'Choose: She (go/goes) to school every day.', answer: 'goes', concept: '主谓一致' },
  { subject: 'chinese', question: '“小树像一把伞”用了什么修辞？', answer: '比喻，把小树比作伞。', concept: '比喻' },
  { subject: 'history', question: '材料甲发生于1911年，材料乙发生于1919年，哪件事在先？', answer: '材料甲在先。', concept: '时间顺序' },
  { subject: 'geography', question: '图上标注向上为北，向右是什么方向？', answer: '东方。', concept: '地图方向' },
  { subject: 'computer-science', question: '令a=2，再令a=a+1，最后a是多少？只手工分析。', answer: 'a=3。', concept: '赋值与顺序执行' },
])('general Skill serves a $subject curriculum question without new execution capabilities', async fixture => {
  const bodies: string[] = [];
  const value = { ...candidate, problem: { text: fixture.question, subject: fixture.subject, uncertainties: [] }, answer: fixture.answer,
    steps: [{ id: 's1', title: '核对题中条件', explanation: fixture.answer }], knowledgePoints: [fixture.concept], knowledgeDetails: [{ name: fixture.concept, explanation: '结合题目明示条件进行判断。', application: '依照题中条件得出结论。' }] };
  const outcome = await solveOnDevice({ ...input, message: fixture.question }, settings, { solver: 'fixture', verifier: null }, async (_url, init) => {
    bodies.push(String(init?.body)); if (bodies.length === 1) return tool('read', { path: '/skills/general/SKILL.md' });
    return sse(bodies.length === 2 ? value : pass);
  }, new AbortController().signal, () => {});
  expect(outcome).toMatchObject({ status: 'completed', verified: true, candidate: { problem: { subject: fixture.subject }, answer: fixture.answer } });
  expect(bodies).toHaveLength(3); expect(bodies[1]).toContain('按题型选择方法');
  expect(bodies[1]).not.toContain('AGENTS.md');
});

it('brief mode omits teaching generation while retaining independent verification', async () => {
  let calls = 0; const bodies: string[] = [];
  const { knowledgeDetails: _details, ...rest } = candidate; const brief = { ...rest, knowledgePoints: [] };
  const outcome = await solveOnDevice({ ...input, answerMode: 'brief' }, settings, { solver: 'fixture', verifier: null }, async (_url, init) => {
    bodies.push(String(init?.body)); return sse(calls++ === 0 ? { ...brief, steps: [] } : pass);
  }, new AbortController().signal, () => {});
  expect(outcome).toMatchObject({ status: 'completed', verified: true, candidate: { answer: 'x=2', steps: [] } });
  expect(calls).toBe(2); expect(bodies[0]).toContain('简洁答案'); expect(bodies[1]).toContain('独立');
});

it('manual answers skip verifier and an explicit check invokes only the independent verifier', async () => {
  const seen: unknown[] = [];
  const result = await solveOnDevice({ ...input, verificationMode: 'manual' }, settings, { solver: 'fixture', verifier: null }, async (_url, init) => { seen.push(JSON.parse(String(init?.body))); return sse(candidate); }, new AbortController().signal, () => {});
  expect(result).toMatchObject({ status: 'completed', verified: false, verificationStatus: 'not_requested', verification: null }); expect(seen).toHaveLength(1);
  const checked = await solveOnDevice({ ...input, verificationMode: 'manual', verificationTarget: AnswerCandidateSchema.parse(candidate) }, settings, { solver: 'fixture', verifier: null }, async (_url, init) => { const body = JSON.parse(String(init?.body)); expect(body.tools).toBeUndefined(); seen.push(body); return sse(pass); }, new AbortController().signal, () => {});
  expect(checked).toMatchObject({ status: 'completed', verified: true }); expect(seen).toHaveLength(2);
});

it('records timing and size metadata without retaining model text or reasoning', async () => {
  const entries: import('@solveflow/contracts/local').LocalDiagnostic[] = [];
  const result = await solveOnDevice({ ...input, verificationMode: 'manual' }, settings, { solver: 'fixture', verifier: null }, async () => sse(candidate), new AbortController().signal, () => {}, entry => entries.push(entry));
  expect(result.status).toBe('completed');
  expect(entries.find(entry => entry.event === 'finish')).toMatchObject({ firstTokenMs: expect.any(Number), textBytes: new TextEncoder().encode(JSON.stringify(candidate)).length });
  expect(JSON.stringify(entries)).not.toContain(candidate.answer);
  expect(JSON.stringify(entries)).not.toContain('fixture-secret');
});
it('repairs missing structured choice labels instead of extracting a letter from the answer', async () => {
  let calls = 0; const entries: import('@solveflow/contracts/local').LocalDiagnostic[] = [];
  const choice = { ...candidate, problem: { ...candidate.problem, options: [{ label: 'A', text: '1' }, { label: 'C', text: '2' }] }, answer: '**答案：C**\n\n两边减1。' };
  const outcome = await solveOnDevice({ ...input, verificationMode: 'manual' }, settings, { solver: 'fixture', verifier: null }, async () => sse(++calls === 1 ? choice : { ...choice, selectedOptions: ['C'], answer: '两边减1。' }), new AbortController().signal, () => {}, entry => entries.push(entry));
  expect(calls).toBe(2);
  expect(entries).toContainEqual(expect.objectContaining({ event: 'validation', fields: ['selectedOptions'] }));
  expect(outcome).toMatchObject({ status: 'completed', candidate: { selectedOptions: ['C'], answer: '两边减1。' } });
});

it('narrows repeated tool work to a final answer and still independently verifies it', async () => {
  let calls = 0;
  const result = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null }, async (_url, init) => {
    calls++;
    if (calls <= 3) return tool('read', { path: '/skills/math/SKILL.md' });
    const body = JSON.parse(String(init?.body));
    expect(body.tools ?? []).toEqual([]);
    return sse(calls === 4 ? candidate : pass);
  }, new AbortController().signal, () => {});
  expect(result).toMatchObject({ status: 'completed', verified: true });
  expect(calls).toBe(5);
});
it('allows the existing one format repair after the final-answer-only turn', async () => {
  let calls = 0;
  const result = await solveOnDevice({ ...input, verificationMode: 'manual' }, settings, { solver: 'fixture', verifier: null }, async (_url, init) => {
    calls++;
    if (calls <= 3) return tool('read', { path: '/skills/math/SKILL.md' });
    expect(JSON.parse(String(init?.body)).tools).toBeUndefined();
    return sse(calls === 4 ? { kind: 'answer' } : candidate);
  }, new AbortController().signal, () => {});
  expect(result.status).toBe('completed'); expect(calls).toBe(5);
});
it('closes consecutive failed tool attempts without pretending a tool succeeded', async () => {
  let calls = 0;
  const result = await solveOnDevice({ ...input, verificationMode: 'manual' }, settings, { solver: 'fixture', verifier: null }, async (_url, init) => {
    calls++;
    if (calls <= 2) return tool('calculate', { schemaVersion: 1, expression: `unknown${calls}`, angleUnit: 'rad' });
    const body = JSON.parse(String(init?.body)); expect(body.tools).toBeUndefined();
    return sse(candidate);
  }, new AbortController().signal, () => {});
  expect(result.status).toBe('completed'); expect(calls).toBe(3);
});
it('preserves the answer after a 130s solve and an independent 300s verifier timeout', async () => {
  let now = 0; let expire = () => {}; let delay = 0; let calls = 0;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  try {
    const result = await solveOnDevice({ ...input, answerMode: 'brief' }, settings, { solver: 'fixture', verifier: null }, async () => {
      if (++calls === 1) { now = 130000; return sse({ ...candidate, steps: [], knowledgePoints: [], knowledgeDetails: [], problem: { ...candidate.problem, options: [{ label: 'A', text: '1' }, { label: 'B', text: '2' }] }, selectedOptions: ['B'] }); }
      expect(delay).toBe(300000); now += delay; expire(); throw new Error('phase expired');
    }, new AbortController().signal, () => {}, () => {}, (callback, ms) => { expire = callback; delay = ms; return () => {}; });
    expect(result).toMatchObject({ status: 'completed', verified: false, warning: 'MODEL_TIMEOUT', candidate: { answer: 'x=2' } });
    expect(now).toBe(430000);
  } finally { clock.mockRestore(); }
});
it('supports a complete essay while keeping brief teaching fields empty', async () => {
  const answer = 'A complete response develops evidence and explains its relevance. '.repeat(80).trim();
  const essay = { ...candidate, answer, steps: [], knowledgePoints: [], knowledgeDetails: [] };
  const result = await solveOnDevice({ ...input, exam: 'ap', answerMode: 'brief' }, settings, { solver: 'fixture', verifier: null }, async (_url, init) => {
    const body = JSON.parse(String(init?.body)); return sse(body.tools ? essay : pass);
  }, new AbortController().signal, () => {});
  expect(result).toMatchObject({ status: 'completed', verified: true, candidate: { answer, steps: [] } });
});

it('does not publish verified when the verifier only transcribed the image', async () => {
  let calls = 0;
  const outcome = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null }, async () => sse(++calls === 1 ? candidate : { ...pass, checked: ['transcription'] }), new AbortController().signal, () => {});
  expect(outcome).toMatchObject({ status: 'completed', verified: false, verification: { verdict: 'unknown', issues: [{ code: 'INSUFFICIENT_EVIDENCE' }] } });
  expect(calls).toBe(2);
});
