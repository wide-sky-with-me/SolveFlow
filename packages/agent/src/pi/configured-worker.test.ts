import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { z } from "zod";
import { loadConfig, getModelConnections } from "../../../config/src/index.js";
import { SolveOutcomeSchema, type PublicAgentEvent } from "@solveflow/contracts/agent";
import { createProbeImage } from "../policy/probe-image.js";
import { runIsolatedWorker } from "../policy/isolated-worker.js";
import { SpendLedger } from "../policy/spend-ledger.js";
import { createModelSpendGate, modelAuthorizationId, quoteModelRequest } from "../policy/model-spend.js";
import { configuredModel } from "./configured-model.js";

async function provider(role: "solver" | "verifier") {
  const requests: { authorization: string | undefined; path: string | undefined; body: unknown }[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of request) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > 1024 * 1024) { response.writeHead(413).end(); return; } chunks.push(bytes); }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8")); requests.push({ authorization: request.headers.authorization, path: request.url, body });
    const result = role === "solver" ? { schemaVersion: 1, kind: "answer", problem: { text: "2x+3=7", subject: "math", uncertainties: [] }, answer: "x = 2", steps: [{ id: "s1", title: "求解", explanation: "两边减去3再除以2。" }], knowledgePoints: ["方程"], knowledgeDetails: [{ name: "方程", explanation: "含未知数的等式", application: "求解未知数" }], citationIds: [], clarificationQuestions: [] } : { schemaVersion: 1, verdict: "pass", checked: ["transcription", "arithmetic"], issues: [] };
    response.writeHead(200, { "content-type": "text/event-stream" });
    const frame = { id: "fixture", object: "chat.completion.chunk", created: 1, model: role };
    response.write("data: " + JSON.stringify({ ...frame, choices: [{ index: 0, delta: { role: "assistant", content: JSON.stringify(result) }, finish_reason: null }] }) + "\n\n");
    response.write("data: " + JSON.stringify({ ...frame, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }) + "\n\n"); response.end("data: [DONE]\n\n");
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); if (!address || typeof address === "string") throw new Error("ADDRESS_REQUIRED");
  return { baseURL: `http://127.0.0.1:${address.port}/gateway/v1`, requests, async close() { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } };
}
it("passes environment routes through compiled worker, real Pi sessions, wire and role-bound ledger", async () => {
  const first = await provider("solver"); const second = await provider("verifier");
  const directory = await mkdtemp(join(tmpdir(), "solveflow-configured-")); const ledgerFile = join(directory, "ledger"); await writeFile(ledgerFile, "", { mode: 0o600 });
  const ledger = SpendLedger.open(ledgerFile); const signal = new AbortController().signal;
  try {
    const config = loadConfig({ SOLVEFLOW_LIVE_CALLS: "true", SOLVEFLOW_LLM_PROVIDER: "vendor-one", SOLVEFLOW_LLM_BASE_URL: first.baseURL, SOLVEFLOW_LLM_API_KEY: "synthetic-one", SOLVEFLOW_LLM_HARD_QUOTA_CONFIRMED: "true", SOLVEFLOW_LLM_HARD_QUOTA_RMB: "30",
      SOLVEFLOW_LLM_SUPPORTS_IMAGES: "true", SOLVEFLOW_LLM_SUPPORTS_TOOLS: "true", SOLVEFLOW_SOLVER_MODEL: "namespace/solver:latest", SOLVEFLOW_VERIFIER_MODEL: "namespace/verifier:other",
      SOLVEFLOW_VERIFIER_PROVIDER: "vendor-two", SOLVEFLOW_VERIFIER_BASE_URL: second.baseURL, SOLVEFLOW_VERIFIER_API_KEY: "synthetic-two", SOLVEFLOW_VERIFIER_COMPAT: '{"maxTokensField":"max_completion_tokens"}',
      SOLVEFLOW_SOLVER_REASONING: "true", SOLVEFLOW_SOLVER_COMPAT: '{"maxTokensField":"max_tokens","thinkingFormat":"deepseek"}',
      SOLVEFLOW_SOLVER_CONTEXT_WINDOW: "64000", SOLVEFLOW_VERIFIER_CONTEXT_WINDOW: "32000", SOLVEFLOW_SOLVER_MAX_OUTPUT_TOKENS: "8000", SOLVEFLOW_VERIFIER_MAX_OUTPUT_TOKENS: "6000",
      SOLVEFLOW_SOLVER_MAX_TOKENS: "2048", SOLVEFLOW_VERIFIER_MAX_TOKENS: "3072", SOLVEFLOW_SOLVER_INPUT_RMB_PER_MTOK: "1", SOLVEFLOW_SOLVER_OUTPUT_RMB_PER_MTOK: "2", SOLVEFLOW_VERIFIER_INPUT_RMB_PER_MTOK: "3", SOLVEFLOW_VERIFIER_OUTPUT_RMB_PER_MTOK: "4" });
    const connections = getModelConnections(config); const runId = randomUUID();
    expect(configuredModel(connections.solver, "solver").model.provider).toBe("vendor-one");
    expect(configuredModel(connections.verifier, "verifier").model.provider).toBe("vendor-two");
    const gate = createModelSpendGate(ledger, { solver: connections.solver.route, verifier: connections.verifier.route }, runId);
    expect(() => gate(modelAuthorizationId("solver", { ...connections.solver.route, baseURL: second.baseURL }), signal)).toThrow("MODEL_DISPATCH_DENIED");
    const progress: PublicAgentEvent[] = [];
    const result = SolveOutcomeSchema.parse(await runIsolatedWorker(new URL("../../dist/pi/application-worker.js", import.meta.url), {
      data: { schemaVersion: 1, role: "solver", identity: { ownerId: randomUUID(), sessionId: randomUUID(), runId }, message: "解答图片", subject: "math", evidence: [] },
      mimeType: "image/png", connections, runDirectory: directory,
    }, { image: createProbeImage(), signal, timeoutMs: 10000, authorizeModel: gate, onEvent: async event => { progress.push(event); } }));
    expect(result).toMatchObject({ status: "completed", verified: true }); expect(progress.map(event => event.type)).toEqual(["run.status", "run.status"]);
    expect(first.requests).toHaveLength(1); expect(second.requests).toHaveLength(1);
    expect(first.requests[0]).toMatchObject({ path: "/gateway/v1/chat/completions", authorization: "Bearer synthetic-one", body: { model: "namespace/solver:latest", max_tokens: 2048, thinking: { type: "disabled" } } });
    expect(second.requests[0]).toMatchObject({ path: "/gateway/v1/chat/completions", authorization: "Bearer synthetic-two", body: { model: "namespace/verifier:other", max_completion_tokens: 3072 } });
    const verifier = z.object({ tools: z.array(z.unknown()).optional(), messages: z.array(z.unknown()) }).parse(second.requests[0]?.body);
    expect(verifier.tools ?? []).toHaveLength(0); expect(JSON.stringify(verifier.messages)).toContain("data:image/png;base64,");
    expect(ledger.snapshot()).toMatchObject({ attempts: 2, reservedMicros: "200000" });
    expect(quoteModelRequest(connections.solver.route)).toBe(80000n);
    expect(JSON.stringify({ result, progress })).not.toContain("synthetic-one"); expect(JSON.stringify({ result, progress })).not.toContain("synthetic-two");
  } finally { ledger.close(); await Promise.all([first.close(), second.close()]); await rm(directory, { recursive: true, force: true }); }
});
