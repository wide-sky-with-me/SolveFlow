import { expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { encodeAnswerDocument, decodeAnswerDocument, type AnswerDocumentPayload } from './answer-payload.js';
import { z } from 'zod';
// Reproduce RNCWebView 13.16.1 Android's injectedObjectJson template literal.
function androidInitialProps(props: unknown): unknown {
  return runInNewContext('JSON.parse(`' + JSON.stringify({ initialProps: { props, names: [] } }) + '`)', {}, { timeout: 100 });
}
it('preserves mathematical answers through Android initial-props injection', () => {
  const value: AnswerDocumentPayload = { schemaVersion: 1, runId: 'run-1', image: null, width: 800, height: 1200, number: null, disabled: false,
    outcome: { schemaVersion: 1, status: 'completed', verified: true, verification: { schemaVersion: 1, verdict: 'pass', checked: ['transcription'], issues: [] }, warning: null, candidate: { schemaVersion: 1, kind: 'answer', problem: { text: '求值', subject: 'math', uncertainties: [] }, answer: '$\\frac{1}{2}$', steps: [{ id: 's1', title: '计算', explanation: '先取“正根”\n再计算 $\\sqrt{2}$，得到 "答案"。', latex: '\\frac{1}{2}' }], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } } };
  // The old raw-object bridge throws before React can display the answer.
  expect(() => androidInitialProps(value)).toThrow();
  const encoded = encodeAnswerDocument(value);
  const restored = z.object({ initialProps: z.object({ props: z.object({ payload: z.string() }) }) }).parse(androidInitialProps({ payload: encoded }));
  expect(decodeAnswerDocument(restored.initialProps.props.payload)).toEqual(value);
  const untrusted = { ...value, runId: '` ${globalThis.executed = true} </script> \\n' };
  const safe = z.object({ initialProps: z.object({ props: z.object({ payload: z.string() }) }) }).parse(androidInitialProps({ payload: encodeAnswerDocument(untrusted) }));
  expect(decodeAnswerDocument(safe.initialProps.props.payload).runId).toBe(untrusted.runId);
});
it('rejects malformed and oversized payloads before rendering', () => {
  for (const value of ['%', '%7B', encodeURIComponent(JSON.stringify({ schemaVersion: 99 })), 'a'.repeat(18_000_001)]) expect(() => decodeAnswerDocument(value)).toThrow();
});
