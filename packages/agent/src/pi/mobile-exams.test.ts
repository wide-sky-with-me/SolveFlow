import { describe, expect, it } from 'vitest';
import { LocalSettingsSchema, type ExamType } from '@solveflow/contracts/local';
import { type SolverInput } from '@solveflow/contracts/agent';
import { FigureSchema } from '@solveflow/contracts/figure';
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
  it('describes the directional segments that the current figure contract accepts', () => {
    expect(FigureSchema.safeParse({ schemaVersion: 1, id: 'force', kind: 'coordinate', title: 'Direction', description: 'Synthetic vector', xRange: [-1, 2], yRange: [-1, 2], elements: [{ kind: 'segment', from: [0, 0], to: [1, 1], arrow: true }] }).success).toBe(true);
    expect(readMobileSkill('/skills/physics/SKILL.md')).toContain('arrow=true');
    expect(readMobileSkill('/skills/physics/SKILL.md')).not.toContain('没有箭头');
  });
  it('finishes repeated Responses tool calls without tools and keeps the next run independent', async () => {
    let calls = 0;
    const outcome = await solveOnDevice(input, settings, { solver: 'synthetic', verifier: null }, async (_url, init) => {
      calls++;
      if (calls <= 3) return response({}, { name: 'read', arguments: { path: '/skills/math/SKILL.md' } });
      const body = JSON.parse(String(init?.body));
      expect(body.tools ?? []).toEqual([]);
      expect(body.tool_choice).toBe('none');
      expect(JSON.stringify(body)).not.toContain('function_call_output');
      expect(JSON.stringify(body)).toContain('工具观察');
      return response(candidate);
    }, new AbortController().signal, () => {});
    expect(outcome.status).toBe('completed'); expect(calls).toBe(4);
    const next = await solveOnDevice(input, settings, { solver: 'synthetic', verifier: null }, async (_url, init) => {
      expect(JSON.parse(String(init?.body)).tools).toHaveLength(2);
      return response(candidate);
    }, new AbortController().signal, () => {});
    expect(next.status).toBe('completed');
  });
  it.each(['sat', 'act', 'ap', 'esat', 'tmua', 'tara'] as const)('preloads exactly the reviewed %s resources without dropping their content', exam => {
    const text = preloadExamResources(exam); expect(text).toContain(readMobileSkill('/skills/exams/SKILL.md')); expect(text).toContain(readMobileSkill(`/skills/exams/references/${exam}.md`));
    for (const other of ['sat', 'act', 'ap', 'esat', 'tmua', 'tara']) if (exam !== other) expect(text).not.toContain(`来源：/skills/exams/references/${other}.md`);
    expect(text).not.toContain('AGENTS.md'); expect(text).toContain('无需重复read');
  });
  it('keeps unspecified exams on demand and rejects unapproved paths', () => { expect(preloadExamResources()).toBe(''); expect(() => preloadExamResources('../../.env' as ExamType)).toThrow(); });
  it('keeps embedded course references readable through the device whitelist', () => {
    for (const name of ['biology', 'diagram', 'math', 'physics', 'chemistry'] as const) {
      const body = readMobileSkill(`/skills/${name}/SKILL.md`);
      const references = [...body.matchAll(/\/skills\/[a-z]+\/(?:references\/)?[a-zA-Z.-]+\.md/g)].map(match => match[0]);
      expect(body).not.toContain('/solveflow/skills/');
      expect(references.length).toBeGreaterThan(0);
      for (const reference of references) expect(readMobileSkill(reference).length).toBeGreaterThan(0);
    }
  });
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
    expect(outcome).toMatchObject({ status: 'failed', error: { code: 'MODEL_REQUEST_REJECTED' } }); expect(calls).toBe(1);
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
  it.each([63, null])('normalizes Responses sourceNumber %s before strict validation', async sourceNumber => {
    let calls = 0;
    const outcome = await solveOnDevice(input, settings, { solver: 'synthetic', verifier: null }, async () => {
      calls++; return response({ ...candidate, problem: { ...candidate.problem, sourceNumber } });
    }, new AbortController().signal, () => {});
    expect(outcome.status).toBe('completed'); expect(calls).toBe(1);
  });
});

const courseCases = [
  { exam: 'tmua', module: 'Paper 1', subject: 'math', reference: 'algebra' },
  { exam: 'tmua', module: 'Paper 2', subject: 'math', reference: 'algebra' },
  { exam: 'esat', module: 'Mathematics 1', subject: 'math', reference: 'algebra' },
  { exam: 'esat', module: 'Mathematics 2', subject: 'math', reference: 'algebra' },
  { exam: 'esat', module: 'Chemistry', subject: 'chemistry', reference: 'stoichiometry' },
  { exam: 'esat', module: 'Biology', subject: 'biology', reference: 'genetics-and-experiments' },
  { exam: 'esat', module: 'Physics', subject: 'physics', reference: 'models' },
] as const;
describe.each(courseCases)('$exam $module device resource and output boundaries', course => {
  it.each(['pass', 'unknown'] as const)('reads a referenced method, preserves option identity and handles verifier %s', async verdict => {
    let calls = 0;
    const skillPath = `/skills/${course.subject}/SKILL.md`;
    const referencePath = `/skills/${course.subject}/references/${course.reference}.md`;
    const courseCandidate = { ...candidate, problem: { ...candidate.problem, exam: course.exam, module: course.module, subject: course.subject, sourceNumber: 7, options: [{ label: 'D', text: 'first visible option' }, { label: 'B', text: 'second visible option' }, { label: 'A', text: 'third visible option' }] }, selectedOptions: ['B'], answer: 'Synthetic rationale.' };
    const outcome = await solveOnDevice({ ...input, exam: course.exam, verificationMode: 'automatic' }, settings, { solver: 'synthetic', verifier: null }, async (_url, init) => {
      const body = String(init?.body); calls++;
      expect(body).toContain(`来源：/skills/exams/references/${course.exam}.md`);
      expect(body).toContain('data:image/jpeg;base64,AQID');
      if (calls === 1) return response({}, { name: 'read', arguments: { path: skillPath } });
      if (calls === 2) {
        expect(body).toContain(referencePath);
        return response({}, { name: 'read', arguments: { path: referencePath } });
      }
      if (calls === 3) {
        expect(body).toContain(readMobileSkill(referencePath).split('\n')[0]);
        return response(courseCandidate);
      }
      expect(calls).toBe(4);
      expect(JSON.parse(body)).not.toHaveProperty('tools');
      expect(body).toContain(course.module);
      return response({ schemaVersion: 1, verdict, checked: ['transcription', 'logic'], issues: verdict === 'unknown' ? [{ code: 'OTHER', message: 'Cannot confirm a decisive condition in the synthetic image.' }] : [], ...(verdict === 'pass' ? { independentChoices: [{ selectedOptions: ['B'], decisiveEvidence: 'The original condition identifies the second visible option.' }] } : {}) });
    }, new AbortController().signal, () => {});
    expect(calls).toBe(4);
    expect(outcome).toMatchObject({ status: 'completed', verified: verdict === 'pass', candidate: { problem: { module: course.module, sourceNumber: '7', options: courseCandidate.problem.options }, selectedOptions: ['B'] } });
    if (verdict === 'unknown') expect(outcome).toMatchObject({ verification: { verdict: 'unknown' } });
  });
});

it.each(['esat', 'tmua', 'tara'] as const)('carries %s rules and the original image through solver and independent verifier', async exam => {
  let calls = 0;
  const result = await solveOnDevice({ ...input, exam, verificationMode: 'automatic' }, settings, { solver: 'synthetic', verifier: null }, async (_url, init) => {
    const body = JSON.parse(String(init?.body)); calls++;
    expect(JSON.stringify(body)).toContain(`来源：/skills/exams/references/${exam}.md`);
    expect(JSON.stringify(body)).not.toContain('来源：/skills/exams/references/sat.md');
    expect(JSON.stringify(body)).toContain('data:image/jpeg;base64,AQID');
    if (calls === 2) expect(body).not.toHaveProperty('tools');
    return response(calls === 1 ? candidate : { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'logic'], issues: [] });
  }, new AbortController().signal, () => {});
  expect(result).toMatchObject({ status: 'completed', verified: true }); expect(calls).toBe(2);
});

it('sends supplementary images to both phases without JSON-encoding image bytes', async () => {
  let calls = 0;
  const material = { id: '00000000-0000-4000-8000-000000000001', image: { bytes: Uint8Array.of(4, 5, 6), mimeType: 'image/jpeg' as const } };
  const result = await solveOnDevice({ ...input, materials: [material], verificationMode: 'automatic' }, settings, { solver: 'synthetic', verifier: null }, async (_url, init) => {
    const body = String(init?.body); calls++;
    expect(body).toContain('data:image/jpeg;base64,AQID');
    expect(body).toContain('data:image/jpeg;base64,BAUG');
    expect(body).toContain(material.id);
    expect(body).not.toContain('"bytes":');
    return response(calls === 1 ? candidate : { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'logic'], issues: [] });
  }, new AbortController().signal, () => {});
  expect(result).toMatchObject({ status: 'completed', verified: true });
  expect(calls).toBe(2);
});

it('checkpoints an answer before dispatching the independently gated verifier', async () => {
  let calls = 0; let checkpointed = false; let admitted = false; let released = false;
  const result = await solveOnDevice({ ...input, verificationMode: 'automatic' }, settings, { solver: 'synthetic', verifier: null }, async () => {
    calls++;
    if (calls === 2) { expect(checkpointed).toBe(true); expect(admitted).toBe(true); }
    return response(calls === 1 ? candidate : { schemaVersion: 1, verdict: 'pass', evidenceStatus: 'sufficient', checked: ['transcription', 'logic'], issues: [] });
  }, new AbortController().signal, () => {}, () => {}, () => () => {}, {
    candidate: async value => { expect(value.answer).toBe('x=2'); checkpointed = true; },
    verification: async () => { admitted = true; return async () => { released = true; }; },
  });
  expect(result).toMatchObject({ status: 'completed', verified: true }); expect(calls).toBe(2); expect(released).toBe(true);
});

it('answers a sufficient stem with missing choices without inventing option labels or claiming verified', async () => {
  let calls = 0;
  const incomplete = { ...candidate, problem: { ...candidate.problem, optionsComplete: false, options: [{ label: 'A', text: '1' }], uncertainties: ['其他选项未拍到；题干条件完整。'], response: { type: 'single-choice' } } };
  const result = await solveOnDevice({ ...input, exam: 'esat', verificationMode: 'automatic' }, settings, { solver: 'synthetic', verifier: null }, async () => response(++calls === 1 ? incomplete : { schemaVersion: 1, verdict: 'pass', evidenceStatus: 'sufficient', checked: ['transcription', 'logic'], issues: [] }), new AbortController().signal, () => {});
  expect(result).toMatchObject({ status: 'completed', verified: false, candidate: { answer: 'x=2', problem: { optionsComplete: false } }, verification: { verdict: 'unknown' } });
  expect(result.status === 'completed' && result.candidate.selectedOptions).toBeUndefined(); expect(calls).toBe(2);
});

it('gives solving and automatic verification independent finite deadlines', async () => {
  const timers: number[] = []; let calls = 0;
  const result = await solveOnDevice({ ...input, verificationMode: 'automatic' }, settings, { solver: 'synthetic', verifier: null }, async () => response(++calls === 1 ? candidate : { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'logic'], issues: [] }), new AbortController().signal, () => {}, () => {}, (_callback, ms) => { timers.push(ms); return () => {}; });
  expect(result.status).toBe('completed');
  expect(timers).toHaveLength(2);
  expect(timers).toEqual([240_000, 300_000]);
});
it('repairs an invalid single-choice selection once before publishing', async () => {
  let calls = 0;
  const choice = { ...candidate, problem: { ...candidate.problem, options: [{ label: 'A', text: '1' }, { label: 'B', text: '2' }] }, selectedOptions: ['A', 'B'] };
  const result = await solveOnDevice({ ...input, exam: 'esat' }, settings, { solver: 'synthetic', verifier: null }, async (_url, init) => {
    calls++;
    if (calls === 2) expect(String(init?.body)).toContain('本考试选择题必须只选择一个原始选项');
    return response(calls === 1 ? choice : { ...choice, selectedOptions: ['B'] });
  }, new AbortController().signal, () => {});
  expect(result).toMatchObject({ status: 'completed', candidate: { selectedOptions: ['B'] } });
  expect(calls).toBe(2);
});

it('admits the writing method and repairs an unbalanced reaction without claiming verification', async () => {
  expect(readMobileSkill('/skills/writing/SKILL.md')).toContain('writing.mode=revision');
  let calls = 0;
  const term = (formula: string, coefficient: number) => ({ formula, coefficient, charge: 0 });
  const result = await solveOnDevice({ ...input, exam: 'general' }, settings, { solver: 'synthetic', verifier: null }, async (_url, init) => {
    calls++;
    if (calls === 2) expect(String(init?.body)).toContain('守恒');
    return response({ ...candidate, chemistry: { reactions: [{ reactants: [term('H2', 2), term('O2', 1)], products: [term('H2O', calls === 1 ? 1 : 2)], arrow: 'forward' }] } });
  }, new AbortController().signal, () => {});
  expect(result).toMatchObject({ status: 'completed', verified: false, verificationStatus: 'not_requested', candidate: { chemistry: { reactions: [{ products: [{ coefficient: 2 }] }] } } });
  expect(calls).toBe(2);
});

it('accepts the full image budget after base64 expansion and refuses an over-budget request before dispatch', async () => {
  let calls = 0;
  const image = { bytes: new Uint8Array(4 * 1024 * 1024), mimeType: 'image/jpeg' as const };
  const material = { id: '00000000-0000-4000-8000-000000000001', image };
  const request = { ...input, image, materials: [material] };
  const fetch = async () => { calls++; return response(candidate); };
  const result = await solveOnDevice(request, settings, { solver: 'synthetic', verifier: null }, fetch, new AbortController().signal, () => {});
  expect(result.status).toBe('completed');
  expect(calls).toBe(1);
  await expect(solveOnDevice({ ...request, materials: [material, { id: '00000000-0000-4000-8000-000000000002', image: input.image }] }, settings, { solver: 'synthetic', verifier: null }, fetch, new AbortController().signal, () => {})).rejects.toThrow();
  expect(calls).toBe(1);
});
it('uses available time for long-answer verification within the same run deadline', async () => {
  const timers: number[] = []; let calls = 0;
  const longAnswer = { ...candidate, answer: 'Complete argument. '.repeat(200) };
  const result = await solveOnDevice({ ...input, verificationMode: 'automatic' }, settings, { solver: 'synthetic', verifier: null }, async () => response(++calls === 1 ? longAnswer : { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'logic'], issues: [] }), new AbortController().signal, () => {}, () => {}, (_callback, ms) => { timers.push(ms); return () => {}; });
  expect(result.status).toBe('completed');
  expect(timers[1]).toBe(300000);
});
