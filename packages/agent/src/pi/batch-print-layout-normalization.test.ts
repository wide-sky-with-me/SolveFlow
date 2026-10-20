import { expect, it } from 'vitest';
import { BatchPrintLayoutSchema, LocalSettingsSchema } from '@solveflow/contracts/local';
import { analyzeBatchPrintQuestion } from './batch-print-layout.js';
const settings = LocalSettingsSchema.parse({ schemaVersion: 1, solver: { provider: 'fixture', baseURL: 'https://layout.invalid/v1', model: 'fixture', api: 'openai-completions', contextWindow: 32768, maxTokens: 16384, maxTokensField: 'max_tokens', streaming: false }, verifier: null });
const problem = { text: 'Synthetic saved problem.', subject: 'math', uncertainties: [] };
const id = '10000000-0000-4000-8000-000000000001';
const input = { purpose: 'reference' as const, questions: [{ key: 'q1', problem }], sources: [{ id, image: 'data:image/jpeg;base64,AQID' }] };
const region = { id: 'diagram', alt: 'Synthetic diagram', role: 'option', x: .1, y: .1, width: .2, height: .2 };
const output = (source: object = { id, kind: 'illustrations', rotation: 0, regions: [region] }) => ({ schemaVersion: 1, questions: [{ key: 'q1', problem: { ...problem, sourceNumber: '' }, sources: [source], warnings: [], confidence: 1 }] });
const response = (value: unknown) => Response.json({ id: 'fixture', model: 'fixture', choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(value) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
it.each([
  ['thinking-type', { thinking: { type: 'disabled' } }],
  ['enable-thinking', { enable_thinking: false }],
  ['reasoning-effort', { reasoning_effort: 'none' }],
] as const)('disables extraction thinking via %s without changing solve settings', async (protocol, expected) => {
  const configured = LocalSettingsSchema.parse({ ...settings, solver: { ...settings.solver, thinking: { mode: 'on', protocol, effort: 'high' } } });
  const before = JSON.stringify(configured); let calls = 0;
  await analyzeBatchPrintQuestion(input, configured, { solver: 'synthetic-secret', verifier: null }, async (_url, init) => {
    calls++; const body: unknown = JSON.parse(String(init?.body)); expect(body).toMatchObject(expected); return response(output());
  }, new AbortController().signal);
  expect(calls).toBe(1); expect(JSON.stringify(configured)).toBe(before);
});
it('normalizes an empty optional number and conservatively keeps an unlabelled option source', async () => {
  expect(BatchPrintLayoutSchema.safeParse(output()).success).toBe(false);
  const value = await analyzeBatchPrintQuestion(input, settings, { solver: 'synthetic-secret', verifier: null }, async () => response(output()), new AbortController().signal);
  expect(value.questions[0]?.problem.sourceNumber).toBeUndefined();
  expect(value.questions[0]?.sources).toEqual([{ id, kind: 'retain-source', rotation: 0, regions: [] }]);
  expect(value.questions[0]?.warnings.join('')).toContain('保留原图');
});
it.each([
  { id, kind: 'illustrations', rotation: 0, regions: [{ ...region, x: .95 }] },
  { id, kind: 'illustrations', rotation: 0, regions: [region, region] },
  { id: '20000000-0000-4000-8000-000000000001', kind: 'illustrations', rotation: 0, regions: [region] },
  { id, kind: 'illustrations', rotation: 0, regions: [{ ...region, role: 'other' }] },
  { id, kind: 'illustrations', rotation: 0, regions: [region], extra: true },
])('never conceals malformed bounds, duplicate regions, foreign sources or fields', async source => {
  await expect(analyzeBatchPrintQuestion(input, settings, { solver: 'synthetic-secret', verifier: null }, async () => response(output(source)), new AbortController().signal)).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' });
});
