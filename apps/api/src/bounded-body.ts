import { ApiError } from "@solveflow/contracts/http";
export async function boundedBody(request: Request, limit: number, timeoutMs = 10_000) {
  if (!request.body) throw new ApiError("INVALID_INPUT");
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted(); const next = await reader.read(); signal.throwIfAborted();
      if (next.done) return Buffer.concat(chunks);
      size += next.value.byteLength; if (size > limit) throw new ApiError("TOO_LARGE"); chunks.push(next.value);
    }
  } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError("INVALID_INPUT"); }
  finally { signal.removeEventListener("abort", abort); await reader.cancel(); reader.releaseLock(); }
}
