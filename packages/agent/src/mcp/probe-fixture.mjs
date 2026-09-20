// Local protocol fixture only; never expose these diagnostic tools in production.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

export const emptySchema = { type: "object", properties: {}, additionalProperties: false };
export const echoSchema = { type: "object", properties: { text: { type: "string", maxLength: 128 } }, required: ["text"], additionalProperties: false };

export function createProbeServer() {
  const server = new Server({ name: "solveflow-local-probe", version: "0.0.1" }, { capabilities: { tools: {} } });
  const state = { calls: 0, started: 0, cancelled: 0, active: 0 };
  const controllers = new Set();
  const text = value => ({ content: [{ type: "text", text: value }] });
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [
    { name: "echo", inputSchema: echoSchema, annotations: { readOnlyHint: true } },
    ...["fail", "rpc_error", "wait", "stats", "oversize", "resource", "dangerous"].map(name => ({ name, inputSchema: emptySchema, annotations: { readOnlyHint: true } })),
  ] }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: input } = request.params;
    state.calls += 1;
    if (name === "echo") return text(z.object({ text: z.string().max(128) }).strict().parse(input).text);
    z.object({}).strict().parse(input ?? {});
    if (name === "stats") return text(JSON.stringify({ ...state, inheritedSentinel: process.env.SOLVEFLOW_PROBE_SENTINEL !== undefined, home: process.env.HOME ?? "", shell: process.env.SHELL ?? "", nodeOptionsPresent: process.env.NODE_OPTIONS !== undefined }));
    if (name === "fail") return { ...text("FIXTURE_TOOL_ERROR"), isError: true };
    if (name === "rpc_error") throw new Error("FIXTURE_INTERNAL_DIAGNOSTIC");
    if (name === "oversize") return text("界".repeat(12_000));
    if (name === "resource") return { content: [{ type: "resource_link", uri: "https://invalid.example/not-fetched", name: "untrusted" }] };
    if (name === "dangerous") throw new Error("UNAPPROVED_TOOL_REACHED");
    if (name === "wait") {
      state.started += 1;
      state.active += 1;
      const cleanup = new AbortController();
      controllers.add(cleanup);
      const signal = AbortSignal.any([extra.signal, cleanup.signal]);
      try {
        await new Promise(resolve => {
          const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", onAbort); resolve(); };
          const onAbort = () => { state.cancelled += 1; finish(); };
          const timer = setTimeout(finish, 5_000);
          signal.addEventListener("abort", onAbort, { once: true });
          if (signal.aborted) onAbort();
        });
        return text("WAIT_FINISHED");
      } finally { state.active -= 1; controllers.delete(cleanup); }
    }
    throw new Error("UNKNOWN_FIXTURE_TOOL");
  });
  return { server, state, stop() { for (const controller of controllers) controller.abort(); } };
}

if (process.argv[2] === "--stdio") {
  const fixture = createProbeServer();
  const transport = new StdioServerTransport();
  await fixture.server.connect(transport);
  process.stdin.once("end", () => { fixture.stop(); void fixture.server.close(); });
}
