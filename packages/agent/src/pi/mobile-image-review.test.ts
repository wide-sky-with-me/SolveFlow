import { describe, expect, it } from 'vitest';
import { LocalSettingsSchema } from '@solveflow/contracts/local';
import { type SolverInput } from '@solveflow/contracts/agent';
import { solveOnDevice } from './mobile.js';

const settings = LocalSettingsSchema.parse({ schemaVersion: 1, solver: { provider: 'fixture', baseURL: 'https://fixture.invalid/v1', api: 'openai-completions', model: 'fixture', streaming: false, contextWindow: 32768, maxTokens: 8192, maxTokensField: 'max_tokens' }, verifier: null });
const input: SolverInput = { schemaVersion: 1, role: 'solver', exam: 'general', identity: { ownerId: 'local', sessionId: 'session', runId: 'run' }, message: '', image: { bytes: Uint8Array.of(1, 2, 3), mimeType: 'image/jpeg' }, materials: [{ id: '00000000-0000-4000-8000-000000000002', image: { bytes: Uint8Array.of(4, 5, 6), mimeType: 'image/jpeg' } }], evidence: [], answerMode: 'brief', verificationMode: 'automatic' };
const candidate = { schemaVersion: 1, kind: 'answer', problem: { text: 'A table gives x = 2.', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
const source = { schemaVersion: 1, kind: 'act-transcript', subject: 'math', blocks: [], questions: [{ number: 1, text: candidate.problem.text, activeSpan: null, uncertainties: [] }], uncertainties: [] };
const region = { imageIndex: 1, x: .2, y: .3, width: .4, height: .1 };
const fail = { schemaVersion: 1, verdict: 'fail', checked: ['transcription'], issues: [{ code: 'TRANSCRIPTION', message: 'Read this source table cell again.', imageRegion: region }] };
const pass = { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'arithmetic'], issues: [], actTranscription: { body: 'pass', question: 'pass', options: 'not_applicable', activeSpan: 'not_applicable', tables: 'not_applicable' } };
function reply(value: unknown) { return new Response(JSON.stringify({ id: 'fixture', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(value) }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 50, total_tokens: 70 } }), { headers: { 'content-type': 'application/json' } }); }
type Request = { role?: string; task?: string; revision?: unknown; derivedViews?: { source?: string; regions?: unknown[] } };
function requestData(init?: RequestInit): Request {
  const body = JSON.parse(String(init?.body)); const user = body.messages.find((message: { role: string }) => message.role === 'user');
  return JSON.parse(user.content.find((part: { type: string }) => part.type === 'text').text);
}

describe('bounded visual issue review across exams', () => {
  it.each(['general', 'act', 'sat', 'ap', 'esat', 'tmua', 'tara'] as const)('%s reuses a source-linked local view in its only correction and final check', async exam => {
    const requests: Request[] = []; let checks = 0; let preparations = 0; const bodies: string[] = [];
    const outcome = await solveOnDevice({ ...input, exam }, settings, { solver: 'fixture', verifier: null }, async (_url, init) => {
      const data = requestData(init); requests.push(data); bodies.push(String(init?.body));
      return reply(data.task === 'act-transcription' ? source : data.role === 'verifier' ? ++checks === 1 ? fail : pass : candidate);
    }, new AbortController().signal, () => {}, () => {}, undefined, undefined, undefined, async (value, regions) => {
      preparations++; expect(value.materials?.[0]?.image.bytes).toEqual(Uint8Array.of(4, 5, 6));
      expect(regions).toHaveLength(1); expect(regions[0]).toMatchObject({ imageIndex: 1 });
      return [{ bytes: Uint8Array.of(7, 8, 9), mimeType: 'image/jpeg' }];
    });
    expect(outcome).toMatchObject({ status: 'completed', verified: true }); expect(preparations).toBe(1);
    expect(requests).toHaveLength(exam === 'act' ? 6 : 4);
    const focused = requests.filter(data => data.derivedViews?.source === 'issue-regions');
    expect(focused).toHaveLength(exam === 'act' ? 3 : 2);
    for (const data of focused) expect(data.derivedViews?.regions?.[0]).toMatchObject({ imageIndex: 1 });
    for (const body of bodies) for (const bytes of ['AQID', 'BAUG']) expect(body).toContain(`data:image/jpeg;base64,${bytes}`);
    expect(bodies.filter(body => body.includes('data:image/jpeg;base64,BwgJ'))).toHaveLength(exam === 'act' ? 3 : 2);
  });
  it('keeps UNKNOWN and manual historical verification from starting automatic correction', async () => {
    for (const historical of [false, true]) {
      let calls = 0; let preparations = 0;
      const outcome = await solveOnDevice({ ...input, ...(historical ? { verificationTarget: { ...candidate, schemaVersion: 1 as const, kind: 'answer' as const } } : {}) }, settings, { solver: 'fixture', verifier: null }, async (_url, init) => { calls++; return reply(requestData(init).role === 'verifier' ? { ...fail, verdict: historical ? 'fail' : 'unknown' } : candidate); }, new AbortController().signal, () => {}, () => {}, undefined, undefined, undefined, async () => { preparations++; return []; });
      expect(outcome).toMatchObject({ status: 'completed', verified: false }); expect(calls).toBe(historical ? 1 : 2); expect(preparations).toBe(0);
    }
  });
  it('cancels during crop preparation before sending correction or accepting a late view', async () => {
    const controller = new AbortController(); let calls = 0;
    const outcome = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null }, async (_url, init) => { calls++; return reply(requestData(init).role === 'verifier' ? fail : candidate); }, controller.signal, () => {}, () => {}, undefined, undefined, undefined, async () => { controller.abort(); return [input.image]; });
    expect(outcome.status).toBe('cancelled'); expect(calls).toBe(2);
  });
  it('reports optional crop failures and falls back to unchanged original images', async () => {
    let calls = 0; let reviews = 0; const reasons: unknown[] = [];
    const outcome = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null }, async (_url, init) => { calls++; expect(requestData(init)).not.toHaveProperty('derivedViews'); return reply(requestData(init).role === 'verifier' ? ++reviews === 1 ? fail : pass : candidate); }, new AbortController().signal, () => {}, value => reasons.push(value.reason), undefined, undefined, undefined, async () => { throw new Error('CANVAS_UNAVAILABLE'); });
    expect(outcome).toMatchObject({ status: 'completed', verified: true }); expect(calls).toBe(4); expect(reasons).toContain('image_review');
  });
  it('does not add retries when the local reread still fails', async () => {
    let calls = 0; let preparations = 0;
    const outcome = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null }, async (_url, init) => { calls++; return reply(requestData(init).role === 'verifier' ? fail : candidate); }, new AbortController().signal, () => {}, () => {}, undefined, undefined, undefined, async () => { preparations++; return [input.image]; });
    expect(outcome).toMatchObject({ status: 'completed', verified: false, verification: { verdict: 'fail' } }); expect(calls).toBe(4); expect(preparations).toBe(1);
  });
  it('keeps all eight source images and two bounded crops without rejecting truthful image-count diagnostics', async () => {
    const materials = Array.from({ length: 7 }, (_, index) => ({ id: `00000000-0000-4000-8000-${String(index + 2).padStart(12, '0')}`, image: input.image }));
    const review = { ...fail, issues: [{ ...fail.issues[0], imageRegion: { ...region, imageIndex: 7 } }, { ...fail.issues[0], imageRegion: { ...region, imageIndex: 0 } }] };
    let reviews = 0; const imageCounts: number[] = [];
    const outcome = await solveOnDevice({ ...input, materials }, settings, { solver: 'fixture', verifier: null }, async (_url, init) => reply(requestData(init).role === 'verifier' ? ++reviews === 1 ? review : pass : candidate), new AbortController().signal, () => {}, value => { if (value.event === 'request' && value.imageCount !== undefined) imageCounts.push(value.imageCount); }, undefined, undefined, undefined, async () => [input.image, input.image]);
    expect(outcome).toMatchObject({ status: 'completed', verified: true }); expect(imageCounts).toEqual([8, 8, 10, 10]);
  });
  it.each([undefined, { ...region, imageIndex: 2 }])('keeps unlocated or unavailable-source issues on the existing full-image correction path', async imageRegion => {
    let calls = 0; let reviews = 0; let preparations = 0;
    const review = { ...fail, issues: [{ code: 'TRANSCRIPTION', message: 'Recheck the original.', ...(imageRegion ? { imageRegion } : {}) }] };
    const outcome = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null }, async (_url, init) => { calls++; return reply(requestData(init).role === 'verifier' ? ++reviews === 1 ? review : pass : candidate); }, new AbortController().signal, () => {}, () => {}, undefined, undefined, undefined, async () => { preparations++; return []; });
    expect(outcome).toMatchObject({ status: 'completed', verified: true }); expect(calls).toBe(4); expect(preparations).toBe(0);
  });
});
