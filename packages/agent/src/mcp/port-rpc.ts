import type { MessagePort } from "node:worker_threads";
import { z } from "zod";
import { assertBoundedJson } from "../policy/bounded-json.js";
import type { RunMcpConnection, McpConnectionBinding } from "./run-connection.js";
import type { McpRunAuthority } from "./run-authority.js";
const claimedPorts = new WeakSet<MessagePort>();
const claimedConnections = new WeakSet<RunMcpConnection>();
const sequence = z.number().int().min(1).max(8);
const requestSchema = z.strictObject({ v: z.literal(1), type: z.literal("call"), id: sequence, name: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/), args: z.unknown() });
const resultSchema = z.strictObject({ content: z.array(z.strictObject({ type: z.literal("text"), text: z.string() })).max(64), isError: z.boolean() });
const replySchema = z.discriminatedUnion("ok", [
  z.strictObject({ v: z.literal(1), type: z.literal("result"), id: sequence, ok: z.literal(true), result: resultSchema }),
  z.strictObject({ v: z.literal(1), type: z.literal("result"), id: sequence, ok: z.literal(false), error: z.literal("MCP_RPC_FAILED") }),
]);
const denied = () => new Error("MCP_RPC_FAILED");

/** Owns this port, not the connection. Await close before closing the owned connection.
 * Single-flight, eight attempts, fixed parent-side 10s MCP limit. Not a pre-clone cap.
 */
export function serveMcpPort(port: MessagePort, connection: RunMcpConnection, binding: McpConnectionBinding, signal: AbortSignal, authority?: McpRunAuthority): { close(): Promise<void> } {
  const scope = Object.freeze({ ...binding });
  connection.assertBinding(scope, scope.server, scope.credentialVersion);
  if (claimedPorts.has(port) || claimedConnections.has(connection)) throw new Error("MCP_RPC_ALREADY_OWNED");
  claimedPorts.add(port); claimedConnections.add(connection);
  const shutdown = new AbortController();
  const combined = AbortSignal.any([signal, shutdown.signal]);
  let stopped = false; let count = 0; let pending: Promise<void> | undefined;
  const stop = () => {
    if (stopped) return; stopped = true;
    shutdown.abort(); signal.removeEventListener("abort", stop);
    port.removeListener("message", message); port.removeListener("close", stop); port.close();
  };
  const message = (raw: unknown) => {
    if (stopped) return;
    try { assertBoundedJson(raw); } catch { stop(); return; }
    const request = requestSchema.safeParse(raw);
    if (!request.success || request.data.id !== count + 1 || pending) { stop(); return; }
    count += 1;
    const call = request.data;
    pending = (async () => {
      let reply: z.infer<typeof replySchema>;
      try {
        connection.assertBinding(scope, scope.server, scope.credentialVersion);
        const grant = authority?.reserve(scope, call.name, combined);
        const result = await connection.call(call.name, call.args, grant?.signal ?? combined, grant?.timeoutMs ?? 10_000);
        grant?.assertActive();
        reply = { v: 1, type: "result", id: call.id, ok: true, result };
        assertBoundedJson(reply);
      } catch { reply = { v: 1, type: "result", id: call.id, ok: false, error: "MCP_RPC_FAILED" }; }
      if (!stopped && !combined.aborted) { try { port.postMessage(reply); } catch { stop(); } }
    })().finally(() => { pending = undefined; });
  };
  port.on("message", message); port.once("close", stop); signal.addEventListener("abort", stop, { once: true });
  if (signal.aborted) stop();
  return { async close() { const task = pending; stop(); await task; } };
}

export function createMcpPortCaller(port: MessagePort) {
  let count = 0; let busy = false; let closed = false;
  const close = () => { closed = true; port.close(); };
  port.once("close", () => { closed = true; });
  return {
    close,
    async call(name: string, args: unknown, signal: AbortSignal, timeoutMs = 10_000): Promise<z.infer<typeof resultSchema>> {
      if (closed || busy || signal.aborted || count >= 8 || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) throw denied();
      const request = { v: 1, type: "call", id: count + 1, name, args };
      try { assertBoundedJson(request); requestSchema.parse(request); } catch { throw denied(); }
      count += 1; busy = true;
      try {
        return await new Promise((resolve, reject) => {
          const finish = (result?: z.infer<typeof resultSchema>) => {
            clearTimeout(timer); signal.removeEventListener("abort", abort);
            port.removeListener("message", message); port.removeListener("close", abort);
            if (result && !signal.aborted) resolve(result); else { close(); reject(denied()); }
          };
          const abort = () => finish();
          const message = (raw: unknown) => {
            try {
              assertBoundedJson(raw); const reply = replySchema.parse(raw);
              if (reply.id !== count || !reply.ok) { finish(); return; }
              finish(reply.result);
            } catch { finish(); }
          };
          const timer = setTimeout(abort, timeoutMs);
          signal.addEventListener("abort", abort, { once: true }); port.on("message", message); port.once("close", abort);
          try { if (signal.aborted) abort(); else port.postMessage(request); } catch { abort(); }
        });
      } finally { busy = false; }
    },
  };
}
