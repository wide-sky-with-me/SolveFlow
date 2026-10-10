import { z } from 'zod';
// Decision: .agents/notes/implemented/agent/2026-10-09-non-stream-model-transport.md
import { SolvePhaseError } from '../orchestration/solve.js';
const text = z.string().max(1024 * 1024);
const completion = z.looseObject({
  choices: z.array(z.looseObject({ index: z.number().int().nonnegative(), finish_reason: z.enum(['stop', 'length', 'tool_calls', 'function_call', 'content_filter']),
    message: z.looseObject({ role: z.literal('assistant'), content: text.nullable().optional(), reasoning_content: text.nullable().optional(),
      tool_calls: z.array(z.looseObject({ id: z.string().max(256), type: z.literal('function'), function: z.looseObject({ name: z.string().max(256), arguments: text }) })).max(16).optional() }),
  })).min(1).max(8),
});
const responses = z.looseObject({ id: z.string().max(256), status: z.enum(['completed', 'incomplete', 'failed', 'cancelled']),
  output: z.array(z.looseObject({ type: z.enum(['message', 'function_call', 'reasoning']) })).max(128),
});
/** Translate one bounded JSON response into Pi's existing event parser, not a model loop. */
export function nonStreamEvents(api: 'openai-completions' | 'openai-responses', value: unknown): string {
  const event = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
  try {
    if (api === 'openai-completions') {
      const parsed = completion.parse(value);
      return event({ ...parsed, object: 'chat.completion.chunk', choices: parsed.choices.map(choice => {
        const { message, ...rest } = choice;
        return { ...rest, delta: { ...message, ...(message.tool_calls ? { tool_calls: message.tool_calls.map((tool, index) => ({ ...tool, index })) } : {}) } };
      }) }) + 'data: [DONE]\n\n';
    }
    const parsed = responses.parse(value);
    return event({ type: 'response.created', response: { id: parsed.id } })
      + parsed.output.map((item, output_index) => event({ type: 'response.output_item.added', output_index, item }) + event({ type: 'response.output_item.done', output_index, item })).join('')
      + event({ type: parsed.status === 'completed' ? 'response.completed' : parsed.status === 'incomplete' ? 'response.incomplete' : 'response.failed', response: parsed });
  } catch { throw new SolvePhaseError('MODEL_OUTPUT_INVALID'); }
}

export async function nonStreamResponse(response: Response, api: 'openai-completions' | 'openai-responses', signal?: AbortSignal | null): Promise<Response> {
  const reader = response.body!.getReader(); const decoder = new TextDecoder(); let raw = '';
  try {
    for (;;) {
      if (signal?.aborted) throw new SolvePhaseError('CANCELLED');
      const part = await reader.read(); if (part.done) break; raw += decoder.decode(part.value, { stream: true });
    }
    raw += decoder.decode();
    if (signal?.aborted) throw new SolvePhaseError('CANCELLED');
    let value: unknown; try { value = JSON.parse(raw); } catch { throw new SolvePhaseError('MODEL_OUTPUT_INVALID'); }
    const bytes = new TextEncoder().encode(nonStreamEvents(api, value));
    const headers = new Headers(response.headers); headers.set('content-type', 'text/event-stream'); headers.delete('content-length');
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } });
    // Expo's native Response must survive; RN's global Response cannot take a stream.
    return new Proxy(response, { get(target, key) { if (key === 'body') return body; if (key === 'headers') return headers; const item: unknown = Reflect.get(target, key, target); return typeof item === 'function' ? item.bind(target) : item; } });
  } finally { await reader.cancel(); reader.releaseLock(); }
}
