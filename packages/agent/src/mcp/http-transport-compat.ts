import type { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

/** SDK 1.30.0 HTTP accessors return undefined while Transport uses exact optional
 * properties. Forward runtime behavior without widening project strictness/casts. */
export function compatibleHttpTransport(
  source: StreamableHTTPClientTransport | StreamableHTTPServerTransport,
): Transport {
  const syncSession = () => {
    if (source.sessionId === undefined) delete target.sessionId;
    else target.sessionId = source.sessionId;
  };
  const target: Transport = {
    async start() { await source.start(); syncSession(); },
    async send(message, options) { await source.send(message, options); syncSession(); },
    async close() { await source.close(); syncSession(); },
  };
  source.onclose = () => { syncSession(); target.onclose?.(); };
  source.onerror = error => target.onerror?.(error);
  source.onmessage = (message, extra) => { syncSession(); target.onmessage?.(message, extra); };
  if ("setProtocolVersion" in source) {
    target.setProtocolVersion = version => source.setProtocolVersion(version);
  }
  syncSession();
  return target;
}
