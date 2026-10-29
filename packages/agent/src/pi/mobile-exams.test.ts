import { describe, expect, it } from 'vitest';
import { LocalSettingsSchema, type ExamType, type LocalDiagnostic } from '@solveflow/contracts/local';
import { AnswerCandidateSchema, ProblemStatementSchema, type SolverInput } from '@solveflow/contracts/agent';
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
const isCapture = (init?: RequestInit) => String(init?.body).includes('act-transcription');
// Synthetic source fixtures precede the existing solve/review dispatch counters.
// The dedicated transcription suite checks total calls, immutable paragraphs and cancellation.
function captured(value: unknown) {
  const problem = ProblemStatementSchema.parse(value);
  return { schemaVersion: 1, kind: 'act-transcript', subject: problem.subject, ...(problem.module ? { module: problem.module } : {}), blocks: [], uncertainties: [],
    questions: [{ number: 1, text: problem.text, ...(problem.sourceNumber ? { sourceNumber: problem.sourceNumber } : {}), ...(problem.options ? { options: problem.options } : {}), ...(problem.response ? { response: problem.response } : {}), activeSpan: null, uncertainties: problem.uncertainties }] };
}
const actChecks = { body: 'pass', question: 'pass', options: 'pass', activeSpan: 'pass', tables: 'pass' };
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
  it('preserves the active ACT English span and exposes punctuation transcription failures even when the choice is unchanged', async () => {
    const english = AnswerCandidateSchema.parse({ ...candidate, problem: { text: 'The workers found two owlets. **Wrapped in a warm blanket,** the birds arrived safely.\nWhich choice best describes their care?', subject: 'english', sourceNumber: 'Item 1', options: [{ label: 'A', text: 'NO CHANGE' }, { label: 'B', text: 'Although they arrived,' }], uncertainties: [] }, selectedOptions: ['A'], answer: 'The blanket indicates care during transport.' });
    let calls = 0;
    const solved = await solveOnDevice({ ...input, exam: 'act' }, settings, { solver: 'synthetic', verifier: null }, async (_url, init) => {
      if (isCapture(init)) return response(captured(english.problem));
      calls++;
      const body = String(init?.body);
      expect(body).toContain('当前黄色高亮'); expect(body).toContain('不能为了语法通顺先修正原文');
      return response(english);
    }, new AbortController().signal, () => {});
    expect(solved).toMatchObject({ status: 'completed', candidate: { problem: english.problem, selectedOptions: ['A'] } });
    const altered = { ...english, problem: { ...english.problem, text: english.problem.text.replace('owlets. **Wrapped', 'owlets, **wrapped') } };
    const checked = await solveOnDevice({ ...input, exam: 'act', verificationTarget: altered }, settings, { solver: 'synthetic', verifier: null }, async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      expect(body).not.toHaveProperty('tools');
      expect(JSON.stringify(body)).toContain('即使所选字母碰巧正确也不能通过');
      expect(JSON.stringify(body)).toContain('data:image/jpeg;base64,AQID');
      return response({ schemaVersion: 1, verdict: 'fail', checked: ['transcription'], issues: [{ code: 'TRANSCRIPTION', message: 'The original period and capital letter were changed.' }] });
    }, new AbortController().signal, () => {});
    expect(checked).toMatchObject({ status: 'completed', verified: false, candidate: { selectedOptions: ['A'] }, verification: { verdict: 'fail', issues: [{ code: 'TRANSCRIPTION' }] } });
    expect(calls).toBe(2);
  });
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

type ActApi = 'openai-completions' | 'openai-responses';
function actSettings(api: ActApi) { return LocalSettingsSchema.parse({ ...settings, solver: { ...settings.solver, api } }); }
function actResponse(api: ActApi, value: object) {
  if (api === 'openai-responses') return response(value);
  const events = [
    { id: 'act_fixture', choices: [{ index: 0, delta: { role: 'assistant', content: JSON.stringify(value) }, finish_reason: null }] },
    { id: 'act_fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
  ];
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
}
// Fake providers exercise transport, resources and output gates, not ACT answer accuracy.
describe('ACT device behavior', () => {
  it.each(['openai-completions', 'openai-responses'] as const)('preserves English NO CHANGE on %s without preloading writing or another exam', async api => {
    let calls = 0;
    const english = { ...candidate, problem: { text: 'The notes on the desk are ready. Choose the best replacement for "are".', subject: 'english', exam: 'act', module: 'English', sourceNumber: '12', uncertainties: [], options: [{ label: 'A', text: 'NO CHANGE' }, { label: 'B', text: 'is' }, { label: 'C', text: 'was' }, { label: 'D', text: 'has been' }], response: { type: 'single-choice' } }, selectedOptions: ['A'], answer: 'The plural subject notes takes are; on the desk does not change agreement.' };
    const result = await solveOnDevice({ ...input, exam: 'act', message: 'Solve ACT English question 12.' }, actSettings(api), { solver: 'synthetic', verifier: null }, async (url, init) => {
      if (isCapture(init)) return actResponse(api, captured(english.problem));
      calls++;
      expect(String(url)).toBe(`https://fixture.invalid/v1/${api === 'openai-responses' ? 'responses' : 'chat/completions'}`);
      const body = String(init?.body);
      expect(body).toContain(JSON.stringify(readMobileSkill('/skills/exams/references/act.md')).slice(1, -1));
      for (const exam of ['sat', 'ap', 'esat', 'tmua', 'tara']) expect(body).not.toContain(`来源：/skills/exams/references/${exam}.md`);
      expect(body).not.toContain(JSON.stringify(readMobileSkill('/skills/writing/SKILL.md')).slice(1, -1));
      return actResponse(api, english);
    }, new AbortController().signal, () => {});
    expect(result).toMatchObject({ status: 'completed', verified: false, verificationStatus: 'not_requested', candidate: { problem: english.problem, selectedOptions: ['A'], answer: english.answer, steps: [] } });
    expect(calls).toBe(1);
  });

  it.each([
    { api: 'openai-responses' as const, labels: ['F', 'G', 'H', 'J'], selected: 'J', target: 14, solution: 4 },
    { api: 'openai-completions' as const, labels: ['F', 'G', 'H', 'J', 'K'], selected: 'K', target: 17, solution: 5 },
  ])('keeps $labels.length Math choices and original $selected on $api', async ({ api, labels, selected, target, solution }) => {
    let calls = 0;
    const math = { ...candidate, problem: { text: `If 3x+2=${target}, what is x?`, subject: 'math', exam: 'act', module: 'Math', sourceNumber: '2', uncertainties: [], options: labels.map((label, index) => ({ label, text: String(index + 1) })), response: { type: 'single-choice' } }, selectedOptions: [selected], answer: `x=${solution}` };
    const result = await solveOnDevice({ ...input, exam: 'act', message: math.problem.text }, actSettings(api), { solver: 'synthetic', verifier: null }, async (_url, init) => {
      if (isCapture(init)) return actResponse(api, captured(math.problem));
      calls++;
      expect(String(init?.body)).toContain('来源：/skills/exams/references/act.md');
      return actResponse(api, math);
    }, new AbortController().signal, () => {});
    expect(result).toMatchObject({ status: 'completed', verified: false, candidate: { problem: { options: math.problem.options, sourceNumber: '2' }, selectedOptions: [selected], answer: math.answer } });
    expect(calls).toBe(1);
  });

  it('asks only for the missing Reading passage, then uses the explicitly supplied material in a new solve', async () => {
    const question = 'Please supply lines 12–16 of the passage.';
    const missing = { ...candidate, kind: 'clarification', answer: null, problem: { text: 'Why does the narrator return in lines 12–16?', subject: 'english', exam: 'act', module: 'Reading', uncertainties: ['The referenced passage is outside the question image.'] }, clarificationQuestions: [question] };
    const method = JSON.stringify(readMobileSkill('/skills/exams/references/act.md')).slice(1, -1);
    let missingCalls = 0;
    const initial = await solveOnDevice({ ...input, exam: 'act', verificationMode: 'automatic' }, settings, { solver: 'synthetic', verifier: null }, async (_url, init) => {
      missingCalls++;
      expect(String(init?.body)).toContain(method);
      return response(missing);
    }, new AbortController().signal, () => {});
    expect(initial).toMatchObject({ status: 'needs_clarification', verified: false, candidate: { kind: 'clarification', answer: null, clarificationQuestions: [question] } });
    expect(missingCalls).toBe(1);

    const passage = { id: '00000000-0000-4000-8000-000000000011', image: { bytes: Uint8Array.of(4, 5, 6), mimeType: 'image/jpeg' as const } };
    const reading = { ...candidate, problem: { text: missing.problem.text, subject: 'english', exam: 'act', module: 'Reading', uncertainties: [], options: [{ label: 'A', text: 'To avoid a visitor.' }, { label: 'B', text: 'To find a new route.' }, { label: 'C', text: 'To retrieve the notebook.' }, { label: 'D', text: 'To meet a friend.' }], response: { type: 'single-choice' } }, selectedOptions: ['C'], answer: 'Lines 12–16 state that the narrator returned for the notebook.' };
    let completedCalls = 0;
    const completed = await solveOnDevice({ ...input, exam: 'act', verificationMode: 'automatic', message: 'Here are lines 12–16: I went back for the notebook. Solve the same question.', history: [{ message: missing.problem.text, answer: question }], materials: [passage] }, settings, { solver: 'synthetic', verifier: null }, async (_url, init) => {
      if (isCapture(init)) return response(captured(reading.problem));
      const body: unknown = JSON.parse(String(init?.body)); const wire = JSON.stringify(body); completedCalls++;
      expect(wire).toContain(method);
      expect(wire.match(/data:image\/jpeg;base64,[A-Za-z0-9+/=]+/g)).toEqual(['data:image/jpeg;base64,AQID', 'data:image/jpeg;base64,BAUG']);
      expect(wire).toContain(passage.id);
      expect(wire).toContain('I went back for the notebook.');
      if (completedCalls === 2) { expect(body).not.toHaveProperty('tools'); expect(wire).toContain(reading.answer); }
      return response(completedCalls === 1 ? reading : { schemaVersion: 1, verdict: 'pass', evidenceStatus: 'sufficient', checked: ['transcription', 'logic'], issues: [], actTranscription: actChecks });
    }, new AbortController().signal, () => {});
    expect(completedCalls).toBe(2);
    expect(completed).toMatchObject({ status: 'completed', verified: true, candidate: { selectedOptions: ['C'], answer: reading.answer }, verification: { verdict: 'pass' } });
  });

  it.each([
    { api: 'openai-completions' as const, evidenceStatus: 'sufficient' as const, verdict: 'pass', verified: true },
    { api: 'openai-responses' as const, evidenceStatus: 'uncertain' as const, verdict: 'unknown', verified: false },
  ])('sends Science materials in order to both $api phases and maps $evidenceStatus evidence to $verdict', async ({ api, evidenceStatus, verdict, verified }) => {
    const materials = [
      { id: '00000000-0000-4000-8000-000000000021', image: { bytes: Uint8Array.of(4, 5, 6), mimeType: 'image/jpeg' as const } },
      { id: '00000000-0000-4000-8000-000000000022', image: { bytes: Uint8Array.of(7, 8, 9), mimeType: 'image/jpeg' as const } },
    ];
    const science = { ...candidate, problem: { text: 'Use Experiment 1 and Table 2 to identify the changed condition and its measured effect.', subject: 'physics', exam: 'act', module: 'Science', sourceNumber: '18', uncertainties: [], options: [{ label: 'F', text: 'Volume changed; rate stayed constant.' }, { label: 'G', text: 'Pressure changed; rate decreased.' }, { label: 'H', text: 'Both temperature and volume changed.' }, { label: 'J', text: 'Temperature changed; rate increased.' }], response: { type: 'single-choice' } }, selectedOptions: ['J'], answer: 'Only temperature changed; the measured rate increased from 2 to 4 units/s.' };
    let calls = 0;
    const result = await solveOnDevice({ ...input, exam: 'act', materials, verificationMode: 'automatic' }, actSettings(api), { solver: 'synthetic', verifier: null }, async (_url, init) => {
      if (isCapture(init)) return actResponse(api, captured(science.problem));
      calls++; const body: unknown = JSON.parse(String(init?.body)); const wire = JSON.stringify(body);
      expect(wire.match(/data:image\/jpeg;base64,[A-Za-z0-9+/=]+/g)).toEqual(['data:image/jpeg;base64,AQID', 'data:image/jpeg;base64,BAUG', 'data:image/jpeg;base64,BwgJ']);
      for (const material of materials) expect(wire).toContain(material.id);
      expect(wire.indexOf(materials[0]!.id)).toBeLessThan(wire.indexOf(materials[1]!.id));
      expect(wire).toContain('来源：/skills/exams/references/act.md');
      expect(wire).not.toContain('来源：/skills/exams/references/sat.md');
      expect(wire).not.toMatch(/bytes\\*":/);
      if (calls === 2) { expect(body).not.toHaveProperty('tools'); expect(wire).toContain(science.answer); }
      return actResponse(api, calls === 1 ? science : { schemaVersion: 1, verdict: 'pass', evidenceStatus, checked: ['transcription', 'logic', 'units'], issues: [], actTranscription: actChecks });
    }, new AbortController().signal, () => {});
    expect(calls).toBe(2);
    expect(result).toMatchObject({ status: 'completed', verified, candidate: { problem: { module: 'Science', options: science.problem.options }, selectedOptions: ['J'] }, verification: { verdict, evidenceStatus } });
    if (!verified) expect(result).toMatchObject({ verification: { issues: [expect.objectContaining({ code: 'INSUFFICIENT_EVIDENCE' })] } });
  });

  it('loads writing only after an ACT composition read and preserves the complete English body in brief mode', async () => {
    const path = '/skills/writing/SKILL.md'; const method = JSON.stringify(readMobileSkill(path)).slice(1, -1);
    const essay = [
      'A school library should extend its evening hours on a limited trial. Later access would help students whose homes offer little quiet space, while a trial would let the school assess the cost before making a permanent commitment.',
      'The first perspective rightly values access, but access means more than leaving a door open. Students need a place with reliable lighting, books, and support. Opening on two evenings each week could provide that opportunity without assuming that every student can stay late every day.',
      'The second perspective raises a fair concern about staffing costs. A small trial respects that concern: existing shifts could be adjusted by agreement, participation could be recorded, and the budget could be reviewed. This approach does not assume that volunteers can replace qualified staff or that demand is already known.',
      'The strongest policy therefore combines the perspectives rather than treating them as absolute opposites. After a month, the school should compare attendance, student feedback, and actual costs. It should continue the trial only if the educational benefit justifies the resources used.',
    ].join('\n\n');
    const composition = { ...candidate, problem: { text: 'Discuss perspectives on access and staffing costs, and argue your view on later school library hours.', subject: 'english', exam: 'act', module: 'Writing', uncertainties: [], response: { type: 'essay' } }, writing: { mode: 'composition', title: 'Library Hours and Access' }, answer: essay };
    let calls = 0; const diagnostics: LocalDiagnostic[] = [];
    const result = await solveOnDevice({ ...input, exam: 'act', message: 'Write the full essay in English; do not give an outline.' }, settings, { solver: 'synthetic', verifier: null }, async (_url, init) => {
      if (isCapture(init)) return response(captured(composition.problem));
      calls++; const body = String(init?.body);
      if (calls === 1) { expect(body).not.toContain(method); return response({}, { name: 'read', arguments: { path } }); }
      expect(calls).toBe(2);
      expect(body).toContain(method);
      expect(body).toContain('function_call_output');
      return response(composition);
    }, new AbortController().signal, () => {}, entry => diagnostics.push(entry));
    expect(calls).toBe(2);
    expect(diagnostics.filter(entry => entry.event === 'tool')).toEqual([expect.objectContaining({ toolName: 'read', toolStatus: 'completed', resourcePath: path })]);
    expect(result).toMatchObject({ status: 'completed', verified: false, verificationStatus: 'not_requested', candidate: { problem: { response: { type: 'essay' } }, answer: essay, writing: composition.writing, steps: [] } });
    if (result.status === 'completed') { expect(result.candidate.answer.split('\n\n')).toHaveLength(4); expect(result.candidate.answer).not.toContain(composition.writing.title); }
  });

  it.each([
    { api: 'openai-completions' as const, repair: true },
    { api: 'openai-responses' as const, repair: false },
  ])('bounds the ACT multi-selection repair on $api: repair=$repair', async ({ api, repair }) => {
    const invalid = { ...candidate, problem: { text: 'Which value equals 3+1?', subject: 'math', module: 'Math', uncertainties: [], options: [{ label: 'F', text: '1' }, { label: 'G', text: '2' }, { label: 'H', text: '3' }, { label: 'J', text: '4' }], response: { type: 'multiple-choice' } }, selectedOptions: ['F', 'J'], answer: '3+1=4.' };
    let calls = 0;
    const result = await solveOnDevice({ ...input, exam: 'act' }, actSettings(api), { solver: 'synthetic', verifier: null }, async (_url, init) => {
      if (isCapture(init)) return actResponse(api, captured(invalid.problem));
      calls++; const body: unknown = JSON.parse(String(init?.body));
      if (calls === 2) {
        expect(JSON.stringify(body)).toContain('本考试选择题必须只选择一个原始选项');
        expect(body).toMatchObject({ tool_choice: 'none' });
        expect(JSON.stringify(body)).not.toContain('function_call_output');
      }
      return actResponse(api, calls === 2 && repair ? { ...invalid, selectedOptions: ['J'] } : invalid);
    }, new AbortController().signal, () => {});
    expect(calls).toBe(2);
    if (repair) expect(result).toMatchObject({ status: 'completed', verified: false, candidate: { selectedOptions: ['J'], answer: invalid.answer } });
    else { expect(result).toMatchObject({ status: 'failed', error: { code: 'MODEL_OUTPUT_INVALID' } }); expect(result).not.toHaveProperty('candidate'); }
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
