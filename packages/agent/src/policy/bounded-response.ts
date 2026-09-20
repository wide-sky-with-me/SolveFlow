export type ResponseFailure = "PROVIDER_RESPONSE_LIMIT" | "PROVIDER_TRANSPORT_FAILED";

/** Caps decoded bytes forwarded to the SDK, not socket buffers or native memory.
 * Underlying reads/cancellation must cooperate or be contained by the worker boundary.
 */
export function boundProviderResponse(response: Response, onFailure: (code: ResponseFailure) => void, maximumBytes = 1024 * 1024): Response {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 1024 * 1024) throw new Error("INVALID_RESPONSE_LIMIT");
  if (!response.body) return response;
  const reader = response.body.getReader(); let bytes = 0; let stopped = false;
  const stop = async () => {
    if (stopped) return; stopped = true;
    try { await reader.cancel(); } finally { reader.releaseLock(); }
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (stopped) return;
        if (chunk.done) { stopped = true; reader.releaseLock(); controller.close(); return; }
        bytes += chunk.value.byteLength;
        if (bytes > maximumBytes) {
          onFailure("PROVIDER_RESPONSE_LIMIT"); controller.error(new Error("PROVIDER_RESPONSE_LIMIT")); await stop(); return;
        }
        controller.enqueue(chunk.value);
      } catch {
        if (!stopped) {
          stopped = true; reader.releaseLock(); onFailure("PROVIDER_TRANSPORT_FAILED"); controller.error(new Error("PROVIDER_TRANSPORT_FAILED"));
        }
      }
    },
    async cancel() { try { await stop(); } catch { onFailure("PROVIDER_TRANSPORT_FAILED"); throw new Error("PROVIDER_TRANSPORT_FAILED"); } },
  });
  const headers = new Headers(response.headers);
  headers.delete("content-length"); headers.delete("content-encoding");
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}
