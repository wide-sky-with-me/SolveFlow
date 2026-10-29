import { describe, expect, it } from 'vitest';
import { LocalSettingsSchema } from '@solveflow/contracts/local';
import { type SolverInput } from '@solveflow/contracts/agent';
import { solveOnDevice } from './mobile.js';
import { bindActSource } from './act-source.js';
import { ActTranscriptSchema } from '@solveflow/contracts/agent';

const settings = LocalSettingsSchema.parse({ schemaVersion: 1, solver: { provider: 'fixture', baseURL: 'https://fixture.invalid/v1', api: 'openai-completions', model: 'fixture', streaming: false, contextWindow: 32768, maxTokens: 8192, maxTokensField: 'max_tokens' }, verifier: null });
const input: SolverInput = { schemaVersion: 1, role: 'solver', exam: 'act', identity: { ownerId: 'local', sessionId: 'session', runId: 'run' }, message: '', image: { bytes: Uint8Array.of(1, 2, 3), mimeType: 'image/jpeg' }, evidence: [], answerMode: 'brief', verificationMode: 'manual' };
const options = [{ label: 'A', text: 'NO CHANGE' }, { label: 'B', text: 'however;' }, { label: 'C', text: 'however,' }];
const source = { schemaVersion: 1, kind: 'act-transcript', subject: 'english', blocks: [{ kind: 'passage', text: 'First, the archive were quiet.' }, { kind: 'passage', text: 'The next room, however, was crowded.' }], questions: [{ number: 8, sourceNumber: '8', text: 'Which choice is grammatically acceptable?', options, activeSpan: { block: 1, text: 'however', occurrence: 1 }, uncertainties: [] }], uncertainties: [] };
const candidate = { schemaVersion: 1, kind: 'answer', problem: { text: 'The archive was quiet. **First,** the next room was crowded.', subject: 'english', uncertainties: [], options: [{ label: 'A', text: 'NO CHANGE' }, { label: 'B', text: 'however,' }, { label: 'C', text: 'however;' }] }, selectedOptions: ['A'], answer: 'The transition fits the context.', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
const pass = { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'logic'], issues: [] };
const checks = { body: 'pass', question: 'pass', options: 'pass', activeSpan: 'pass', tables: 'not_applicable' };
function reply(value: unknown) { return new Response(JSON.stringify({ id: 'fixture', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(value) }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 50, total_tokens: 70 } }), { headers: { 'content-type': 'application/json' } }); }
function requestData(init?: RequestInit): { role?: string; task?: string; candidate?: { problem?: { illustrations?: unknown } } } {
  const body = JSON.parse(String(init?.body));
  const user = body.messages.find((message: { role: string }) => message.role === 'user');
  return JSON.parse(typeof user.content === 'string' ? user.content : user.content.find((part: { type: string }) => part.type === 'text').text);
}
const capture = (init?: RequestInit) => requestData(init).task === 'act-transcription';

describe('ACT transcription before solving', () => {
  it.each([undefined, 8])('isolates regeneration capture from prior OCR with question selection %s and every material', async questionNumber => {
    const requests: { role?: string; task?: string }[] = []; const bodies: string[] = [];
    const materialOrder = ['00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003'];
    const questionSource = { imageIndex: 0, ...(questionNumber === undefined ? {} : { questionNumber }) };
    const request: SolverInput = { ...input, verificationMode: 'automatic', materials: [{ id: materialOrder[0]!, image: { mimeType: 'image/jpeg', bytes: Uint8Array.of(4, 5, 6) } }, { id: materialOrder[1]!, image: { mimeType: 'image/jpeg', bytes: Uint8Array.of(7, 8, 9) } }],
      focus: { sourceRunId: '00000000-0000-4000-8000-000000000001', kind: 'regenerate', ...(questionNumber === undefined ? {} : { questionNumber }), content: 'STALE_OCR_CANARY: table2 was absent in the old capture.', answer: 'STALE_ANSWER_CANARY', verified: false },
      history: [{ message: 'Earlier question', answer: 'STALE_HISTORY_CANARY' }] };
    const result = await solveOnDevice(request, settings, { solver: 'fixture', verifier: null }, async (_url, init) => {
      const data = requestData(init); requests.push(data); bodies.push(String(init?.body));
      return reply(data.task === 'act-transcription' ? source : data.role === 'verifier' ? { ...pass, actTranscription: checks } : candidate);
    }, new AbortController().signal, () => {});
    expect(result).toMatchObject({ status: 'completed', verified: true, candidate: { problem: { sourceNumber: '8' } } });
    const captureRequest = requests.find(value => value.task === 'act-transcription');
    expect(captureRequest).toMatchObject({ focus: { kind: 'regenerate' }, questionSource, materialOrder });
    for (const path of ['focus.content', 'focus.answer', 'history', 'candidate']) expect(captureRequest).not.toHaveProperty(path);
    expect(JSON.stringify(captureRequest)).not.toMatch(/STALE_(?:OCR|ANSWER|HISTORY)_CANARY/);
    expect(requests).toHaveLength(3);
    for (const data of requests) expect(data).toMatchObject({ questionSource });
    for (const body of bodies) for (const bytes of ['AQID', 'BAUG', 'BwgJ']) expect(body).toContain(`data:image/jpeg;base64,${bytes}`);
  });
  it('retains solver-located source illustrations while binding exact ACT text before independent review', async () => {
    const illustrations = [{ id: 'source-figure', alt: 'A source diagram with its labels', x: .1, y: .2, width: .4, height: .3 }];
    let reviewed = false;
    const result = await solveOnDevice({ ...input, verificationMode: 'automatic' }, settings, { solver: 'fixture', verifier: null }, async (_url, init) => {
      const data = requestData(init);
      if (data.task === 'act-transcription') return reply(source);
      if (data.role === 'verifier') {
        reviewed = JSON.stringify(data.candidate?.problem?.illustrations) === JSON.stringify(illustrations);
        return reply({ ...pass, checked: [...pass.checked, 'diagram'], actTranscription: checks });
      }
      return reply({ ...candidate, problem: { ...candidate.problem, illustrations } });
    }, new AbortController().signal, () => {});
    expect(reviewed).toBe(true);
    expect(result).toMatchObject({ status: 'completed', verified: true, candidate: { problem: { illustrations, options, text: 'First, the archive were quiet.\n\nThe next room, **however**, was crowded.\n\nWhich choice is grammatically acceptable?' } } });
  });
  it.each([
    [{ id: 'crop', alt: 'Outside source image', x: .9, y: .1, width: .2, height: .2 }],
    [{ id: 'crop', alt: 'Not a material-image coordinate', x: .1, y: .1, width: .2, height: .2, imageIndex: 1 }],
  ])('rejects invalid illustration metadata instead of silently dropping it', illustrations => {
    expect(() => bindActSource({ ...candidate, problem: { ...candidate.problem, illustrations } }, ActTranscriptSchema.parse(source))).toThrow();
  });
  it('retains all captured paragraphs, the exact target and original option punctuation when the solver rewrites them', async () => {
    let calls = 0;
    const result = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null }, async (_url, init) => { calls++; return reply(capture(init) ? source : candidate); }, new AbortController().signal, () => {});
    expect(result).toMatchObject({ status: 'completed', candidate: { problem: { sourceNumber: '8', text: 'First, the archive were quiet.\n\nThe next room, **however**, was crowded.\n\nWhich choice is grammatically acceptable?', options }, selectedOptions: ['A'] } });
    expect(calls).toBe(2);
  });
  it('does not accept a bare answer PASS as proof of full ACT transcription', async () => {
    const result = await solveOnDevice({ ...input, verificationMode: 'automatic' }, settings, { solver: 'fixture', verifier: null }, async (_url, init) => reply(capture(init) ? source : requestData(init).role === 'verifier' ? pass : candidate), new AbortController().signal, () => {});
    expect(result).toMatchObject({ status: 'completed', verified: false, verification: { verdict: 'unknown', issues: [{ code: 'INSUFFICIENT_EVIDENCE' }] } });
  });
  it('accepts separately checked ACT source components', async () => {
    const result = await solveOnDevice({ ...input, verificationMode: 'automatic' }, settings, { solver: 'fixture', verifier: null }, async (_url, init) => reply(capture(init) ? source : requestData(init).role === 'verifier' ? { ...pass, actTranscription: checks } : candidate), new AbortController().signal, () => {});
    expect(result).toMatchObject({ status: 'completed', verified: true, verification: { actTranscription: checks } });
  });
  it('cancels after capture without dispatching the solver or accepting a late transcript', async () => {
    const controller = new AbortController(); let calls = 0;
    const result = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null }, async () => { calls++; controller.abort(); return reply(source); }, controller.signal, () => {});
    expect(result.status).toBe('cancelled'); expect(calls).toBe(1);
  });
  it('leaves non-ACT solving at one request', async () => {
    let calls = 0;
    const result = await solveOnDevice({ ...input, exam: 'sat' }, settings, { solver: 'fixture', verifier: null }, async () => { calls++; return reply(candidate); }, new AbortController().signal, () => {});
    expect(result.status).toBe('completed'); expect(calls).toBe(1);
  });
  it('reuses the captured source on a logic-only revision', async () => {
    let captures = 0; let reviews = 0; let calls = 0;
    const result = await solveOnDevice({ ...input, verificationMode: 'automatic' }, settings, { solver: 'fixture', verifier: null }, async (_url, init) => {
      calls++;
      if (capture(init)) { captures++; return reply(source); }
      if (requestData(init).role === 'verifier') return reply(++reviews === 1 ? { schemaVersion: 1, verdict: 'fail', checked: ['transcription', 'logic'], issues: [{ code: 'LOGIC', message: 'Recheck the selected transition.' }] } : { ...pass, actTranscription: checks });
      return reply(candidate);
    }, new AbortController().signal, () => {});
    expect(result).toMatchObject({ status: 'completed', verified: true }); expect(captures).toBe(1); expect(calls).toBe(5);
  });
  it('recaptures from the image once when the reviewer identifies a transcription failure', async () => {
    let captures = 0; let reviews = 0; let calls = 0;
    const corrected = { ...source, blocks: [...source.blocks, { kind: 'passage', text: 'The final visible paragraph must also be retained.' }] };
    const result = await solveOnDevice({ ...input, verificationMode: 'automatic' }, settings, { solver: 'fixture', verifier: null }, async (_url, init) => {
      calls++;
      if (capture(init)) { captures++; expect(requestData(init)).not.toHaveProperty('candidate'); return reply(captures === 1 ? source : corrected); }
      if (requestData(init).role === 'verifier') return reply(++reviews === 1 ? { schemaVersion: 1, verdict: 'fail', checked: ['transcription'], issues: [{ code: 'TRANSCRIPTION', message: 'The last visible paragraph was omitted.' }] } : { ...pass, actTranscription: checks });
      return reply(candidate);
    }, new AbortController().signal, () => {});
    expect(result).toMatchObject({ status: 'completed', verified: true });
    if (result.status === 'completed') expect(result.candidate.problem.text).toContain('The final visible paragraph must also be retained.');
    expect(captures).toBe(2); expect(calls).toBe(6);
  });
  it('preserves both capture and solve warnings while keeping the original table and options', async () => {
    const warning = 'A source caption is partly obscured.';
    const result = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null }, async (_url, init) => reply(capture(init) ? { ...source, uncertainties: ['The screen cuts off the next paragraph.'] } : { ...candidate, problem: { ...candidate.problem, uncertainties: [warning] } }), new AbortController().signal, () => {});
    expect(result).toMatchObject({ status: 'completed', candidate: { problem: { options, uncertainties: ['The screen cuts off the next paragraph.', warning] } } });
  });
  it('rejects a fabricated active span and uses only the existing one-time format repair', async () => {
    let calls = 0;
    const invalid = { ...source, questions: [{ ...source.questions[0], activeSpan: { block: 1, text: 'invented phrase', occurrence: 1 } }] };
    const result = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null }, async () => { calls++; return reply(invalid); }, new AbortController().signal, () => {});
    expect(result).toMatchObject({ status: 'failed', error: { code: 'MODEL_OUTPUT_INVALID' } }); expect(calls).toBe(2);
  });
  it('shares a source capture with backup takeover after the primary answer format fails', async () => {
    const backed = LocalSettingsSchema.parse({ ...settings, backup: { ...settings.solver, model: 'backup' } });
    let captures = 0; let calls = 0;
    const result = await solveOnDevice({ ...input, verificationMode: 'automatic' }, backed, { solver: 'fixture', verifier: null, backup: 'backup' }, async (_url, init) => {
      calls++;
      if (capture(init)) { captures++; return reply(source); }
      if (requestData(init).role === 'verifier') return reply({ ...pass, actTranscription: checks });
      const body = JSON.parse(String(init?.body)); return reply(body.model === 'backup' ? candidate : {});
    }, new AbortController().signal, () => {});
    expect(result).toMatchObject({ status: 'completed', verified: true }); expect(captures).toBe(1); expect(calls).toBe(5);
  });
  it('keeps source capture out of a same-question step follow-up', async () => {
    let calls = 0;
    const result = await solveOnDevice({ ...input, focus: { kind: 'step', sourceRunId: '00000000-0000-4000-8000-000000000001', content: 'Explain the transition.', verified: false } }, settings, { solver: 'fixture', verifier: null }, async (_url, init) => { expect(capture(init)).toBe(false); calls++; return reply(candidate); }, new AbortController().signal, () => {});
    expect(result.status).toBe('completed'); expect(calls).toBe(1);
  });
  it('owns and clears both timers within the original solver phase allowance', async () => {
    const durations: number[] = []; let cleared = 0;
    const result = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null }, async (_url, init) => reply(capture(init) ? source : candidate), new AbortController().signal, () => {}, () => {}, (_callback, duration) => { durations.push(duration); return () => { cleared++; }; });
    expect(result.status).toBe('completed'); expect(durations).toHaveLength(2); expect(durations[1]).toBeLessThanOrEqual(durations[0]!); expect(cleared).toBe(2);
  });
  it('binds shared article text to each explicitly requested question by its original number', async () => {
    const multiSource = { ...source, questions: [source.questions[0], { ...source.questions[0], number: 9, sourceNumber: '9', text: 'Which choice fits the second question?' }] };
    const { selectedOptions: _selection, ...base } = candidate;
    const illustration = (number: number) => ({ id: `crop-${number}`, alt: `Source diagram for ${number}`, x: .1, y: .2, width: .3, height: .4 });
    const multi = { ...base, problem: { text: 'Two questions.', subject: 'english', uncertainties: [] }, questions: [9, 8].map(number => ({ number, problem: { ...candidate.problem, illustrations: [illustration(number)] }, answer: 'The transition fits.', selectedOptions: ['A'], stepIds: [], figureIds: [] })) };
    const result = await solveOnDevice({ ...input, message: 'Answer questions 8 and 9.' }, settings, { solver: 'fixture', verifier: null }, async (_url, init) => reply(capture(init) ? multiSource : multi), new AbortController().signal, () => {});
    expect(result).toMatchObject({ status: 'completed', candidate: { questions: [{ number: 9, problem: { sourceNumber: '9', options, illustrations: [illustration(9)] } }, { number: 8, problem: { sourceNumber: '8', options, illustrations: [illustration(8)] } }] } });
    if (result.status === 'completed') for (const question of result.candidate.questions ?? []) expect(question.problem?.text).toContain('First, the archive were quiet.');
  });
  it('retains the authoritative original and labels cached derived views only in capture and review', async () => {
    let preparations = 0; const counts: number[] = [];
    const result = await solveOnDevice({ ...input, verificationMode: 'automatic' }, settings, { solver: 'fixture', verifier: null }, async (_url, init) => {
      const data = requestData(init); const body = JSON.parse(String(init?.body)); const user = body.messages.find((message: { role: string }) => message.role === 'user');
      const images = user.content.filter((part: { type: string }) => part.type === 'image_url'); counts.push(images.length);
      expect(images[0].image_url.url).toBe('data:image/jpeg;base64,AQID');
      return reply(capture(init) ? source : data.role === 'verifier' ? { ...pass, actTranscription: checks } : candidate);
    }, new AbortController().signal, () => {}, () => {}, undefined, undefined, async () => {
      preparations++; return [{ mimeType: 'image/jpeg', bytes: Uint8Array.of(4, 5, 6) }, { mimeType: 'image/jpeg', bytes: Uint8Array.of(7, 8, 9) }];
    });
    expect(result).toMatchObject({ status: 'completed', verified: true }); expect(counts).toEqual([3, 1, 3]); expect(preparations).toBe(1);
  });
  it('does not send a request when cancelled while preparing optional visual aids', async () => {
    const controller = new AbortController(); let calls = 0;
    const result = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null }, async () => { calls++; return reply(candidate); }, controller.signal, () => {}, () => {}, undefined, undefined, async () => { controller.abort(); return []; });
    expect(result.status).toBe('cancelled'); expect(calls).toBe(0);
  });
});
