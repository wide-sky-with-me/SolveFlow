import { request as httpRequest, type ClientRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIPv4, isIP, type LookupFunction } from "node:net";
import { z } from "zod";

const privateNetworks = new BlockList();
for (const [address, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) {
  privateNetworks.addSubnet(address, prefix, "ipv4");
}
privateNetworks.addSubnet("192.88.99.0", 24, "ipv4");

/** Server-admin configuration only. A reviewed IPv4 pin bypasses DNS entirely;
 * HTTPS still verifies the endpoint hostname/certificate. No automatic IP refresh.
 * Internal service exceptions require an explicit pin and flag; plaintext is
 * restricted to loopback fixtures. IPv6 is deliberately not supported yet. */
export const McpHttpEndpointSchema = z.strictObject({
  endpoint: z.string().max(2048),
  address: z.string().refine(isIPv4),
  allowPrivateAddress: z.boolean().default(false),
  authorization: z.string().min(1).max(4096).regex(/^[\x20-\x7e]+$/).optional(),
  lifetimeMs: z.number().int().min(1).max(120_000).default(120_000),
  requestTimeoutMs: z.number().int().min(1).max(10_000).default(10_000),
});
export type McpHttpEndpoint = z.input<typeof McpHttpEndpointSchema>;

export const MCP_HTTP_LIMITS = Object.freeze({ requestBytes: 32 * 1024, responseBytes: 256 * 1024, totalBytes: 1024 * 1024, requests: 32, concurrent: 4 });
const allowedHeaders = new Set(["accept", "content-type", "mcp-session-id", "mcp-protocol-version", "last-event-id"]);
const error = (code: string) => new Error(code);

/** Fixed-destination fetch subset used by SDK 1.30.0. Uses Node HTTP directly:
 * no proxy, DNS lookup, redirect, decompression, cookies, auth discovery or retry.
 * Limits apply before the SDK JSON/SSE parser, including error/keepalive bodies.
 * Native socket/parser buffers are additional bounded Node runtime overhead. */
export function createMcpHttpRequest(value: McpHttpEndpoint, signal: AbortSignal) {
  const parsed = McpHttpEndpointSchema.safeParse(value);
  if (!parsed.success) throw error("MCP_INVALID_ENDPOINT");
  const config = parsed.data;
  let url: URL;
  try {
    url = new URL(config.endpoint);
    if (url.username || url.password || url.hash || url.search || !url.hostname || isIP(url.hostname.replace(/^\[|\]$/g, "")) === 6) throw error("");
    if (isIPv4(url.hostname) && url.hostname !== config.address) throw error("");
    if (privateNetworks.check(config.address, "ipv4") && !config.allowPrivateAddress) throw error("");
    if (url.protocol !== "https:" && !(url.protocol === "http:" && config.allowPrivateAddress && config.address === "127.0.0.1")) throw error("");
  } catch { throw error("MCP_INVALID_ENDPOINT"); }
  const endpoint = url.href;
  const active = new Map<ClientRequest, Promise<void>>();
  let attempts = 0;
  let received = 0;
  let stopped: string | undefined;
  let closing: Promise<void> | undefined;
  let occupied = 0;
  const waiting: Array<{ ready(): void; reject(code: string): void }> = [];
  const release = () => {
    occupied -= 1;
    if (!stopped) waiting.shift()?.ready();
  };
  const acquire = (requestSignal?: AbortSignal | null) => {
    if (occupied < MCP_HTTP_LIMITS.concurrent && waiting.length === 0) { occupied += 1; return Promise.resolve(); }
    if (waiting.length >= MCP_HTTP_LIMITS.concurrent) return Promise.reject(error("MCP_HTTP_REQUEST_LIMIT"));
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); requestSignal?.removeEventListener("abort", abort); };
      const entry = {
        ready() { cleanup(); occupied += 1; resolve(); },
        reject(code: string) { cleanup(); const index = waiting.indexOf(entry); if (index !== -1) waiting.splice(index, 1); reject(error(code)); },
      };
      const abort = () => entry.reject("MCP_CANCELLED");
      const timer = setTimeout(() => entry.reject("MCP_HTTP_TIMEOUT"), config.requestTimeoutMs);
      timer.unref();
      waiting.push(entry);
      requestSignal?.addEventListener("abort", abort, { once: true });
      if (requestSignal?.aborted) abort();
    });
  };
  const stop = (code: string) => {
    if (stopped) return;
    stopped = code;
    clearTimeout(lifetime);
    signal.removeEventListener("abort", onAbort);
    for (const entry of [...waiting]) entry.reject(code);
    for (const request of active.keys()) request.destroy(error(code));
  };
  const onAbort = () => stop("MCP_CANCELLED");
  const lifetime = setTimeout(() => stop("MCP_HTTP_TIMEOUT"), config.lifetimeMs);
  lifetime.unref();
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();
  // The only address returned to the actual socket connect, not a preflight lookup.
  const lookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) callback(null, [{ address: config.address, family: 4 }]);
    else callback(null, config.address, 4);
  };

  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (stopped) throw error(stopped);
    let headers: Headers;
    let body: string | undefined;
    let method: string;
    try {
      if (input instanceof Request || new URL(String(input)).href !== endpoint) throw error("");
      method = init?.method ?? "GET";
      if (!["POST", "GET", "DELETE"].includes(method)) throw error("");
      if (init?.body !== undefined && init.body !== null) {
        if (method !== "POST" || typeof init.body !== "string" || Buffer.byteLength(init.body) > MCP_HTTP_LIMITS.requestBytes) throw error("");
        body = init.body;
      }
      headers = new Headers(init?.headers);
      let headerBytes = 0;
      for (const [name, value] of headers) {
        headerBytes += name.length + Buffer.byteLength(value);
        if (!allowedHeaders.has(name) || value.length > 4096 || !/^[\x20-\x7e]*$/.test(value)) throw error("");
      }
      if (headerBytes > 8192 || init?.signal?.aborted) throw error("");
    } catch { throw error("MCP_HTTP_REQUEST_DENIED"); }
    if (attempts >= MCP_HTTP_LIMITS.requests) throw error("MCP_HTTP_REQUEST_LIMIT");
    attempts += 1;
    headers.set("accept-encoding", "identity");
    if (body !== undefined) headers.set("content-length", String(Buffer.byteLength(body)));
    if (config.authorization) headers.set("authorization", config.authorization);
    await acquire(init?.signal);
    if (stopped || init?.signal?.aborted) { release(); throw error(stopped ?? "MCP_CANCELLED"); }
    return new Promise<Response>((resolve, reject) => {
      let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
      let ended = false;
      let bytes = 0;
      const fail = (code: string) => {
        if (!ended) { ended = true; stream?.error(error(code)); }
        reject(error(code));
      };
      let request: ClientRequest;
      try {
        request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
          method, headers: Object.fromEntries(headers), lookup, family: 4,
          agent: false, maxHeaderSize: 16 * 1024,
          ...(url.protocol === "https:" ? { rejectUnauthorized: true } : {}),
        });
      } catch { release(); reject(error("MCP_HTTP_REQUEST_DENIED")); return; }
      const done = Promise.withResolvers<void>();
      active.set(request, done.promise);
      const abort = () => request.destroy(error("MCP_CANCELLED"));
      const timeout = setTimeout(() => request.destroy(error("MCP_HTTP_TIMEOUT")), method === "GET" ? config.lifetimeMs : config.requestTimeoutMs);
      timeout.unref();
      init?.signal?.addEventListener("abort", abort, { once: true });
      request.once("close", () => {
        clearTimeout(timeout);
        init?.signal?.removeEventListener("abort", abort);
        active.delete(request);
        release();
        done.resolve();
      });
      request.on("error", () => fail(stopped ?? (init?.signal?.aborted ? "MCP_CANCELLED" : "MCP_HTTP_FAILED")));
      request.on("information", () => { fail("MCP_HTTP_FAILED"); stop("MCP_HTTP_FAILED"); });
      request.on("upgrade", (_response, socket) => { socket.destroy(); fail("MCP_HTTP_FAILED"); stop("MCP_HTTP_FAILED"); });
      request.once("response", response => {
        const status = response.statusCode ?? 500;
        const rejectResponse = (code: string) => { fail(code); stop(code); response.destroy(); };
        if (status < 200 || status > 599) { rejectResponse("MCP_HTTP_FAILED"); return; }
        if (status >= 300 && status < 400) { rejectResponse("MCP_HTTP_REDIRECT_DENIED"); return; }
        if (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") { rejectResponse("MCP_HTTP_ENCODING_DENIED"); return; }
        const length = response.headers["content-length"];
        if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > Math.min(MCP_HTTP_LIMITS.responseBytes, MCP_HTTP_LIMITS.totalBytes - received))) { rejectResponse("MCP_HTTP_RESPONSE_LIMIT"); return; }
        // Only protocol headers reach the SDK. No cookies, redirects or auth URLs.
        const responseHeaders = new Headers();
        for (const name of ["content-type", "mcp-session-id", "mcp-protocol-version"]) {
          const value = response.headers[name];
          if (typeof value === "string") {
            if (value.length > 4096 || !/^[\x20-\x7e]*$/.test(value)) { rejectResponse("MCP_HTTP_FAILED"); return; }
            responseHeaders.set(name, value);
          }
        }
        const readable = new ReadableStream<Uint8Array>({
          start(controller) { stream = controller; },
          cancel() { ended = true; response.destroy(); request.destroy(); return done.promise; },
        });
        response.on("data", (chunk: Buffer) => {
          if (ended) return;
          bytes += chunk.byteLength;
          received += chunk.byteLength;
          if (bytes > MCP_HTTP_LIMITS.responseBytes || received > MCP_HTTP_LIMITS.totalBytes) { rejectResponse("MCP_HTTP_RESPONSE_LIMIT"); return; }
          stream?.enqueue(chunk);
        });
        response.once("end", () => { if (!ended) { ended = true; stream?.close(); } });
        response.once("error", () => fail(stopped ?? "MCP_HTTP_FAILED"));
        response.once("close", () => { if (!ended) fail(stopped ?? "MCP_HTTP_FAILED"); });
        // Non-success response bodies are never exposed to SDK error messages.
        if (status < 200 || status >= 300 || status === 204 || status === 205) {
          ended = true; stream?.close(); response.destroy(); request.destroy();
          resolve(new Response(null, { status, headers: responseHeaders }));
        } else resolve(new Response(readable, { status, headers: responseHeaders }));
      });
      if (init?.signal?.aborted) abort();
      else request.end(body);
    });
  };
  return Object.freeze({ endpoint, fetch, close(): Promise<void> {
    if (!closing) { stop("MCP_CLOSED"); closing = Promise.all([...active.values()]).then(() => {}); }
    return closing;
  } });
}
