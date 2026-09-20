import { createServer } from "node:http";
import { once } from "node:events";
import { expect, it } from "vitest";
import { z } from "zod";
import type { Model } from "@earendil-works/pi-ai";
import { stream } from "@earendil-works/pi-ai/api/openai-completions";
const SOLVER_MODEL = "fixture/solver:v1";
const VERIFIER_MODEL = "another/verifier:v2";
import { createProviderRequest } from "../policy/provider-request.js";
import { createAuthorizedOpenAiStream } from "./authorized-openai-stream.js";

async function fixture(status: number, payloadBytes?: number) {
  const requests: { path: string | undefined; auth: string | undefined; body: unknown }[] = [];
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of request) {
        const bytes = Buffer.from(chunk); size += bytes.length;
        if (size > 1024 * 1024) { response.writeHead(413).end(); return; }
        chunks.push(bytes);
      }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      requests.push({ path: request.url, auth: request.headers.authorization, body });
      if (status !== 200) { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify({ error: { message: "synthetic provider error", type: "test_error" } })); return; }
      response.writeHead(200, { "content-type": "text/event-stream" });
      const frame = { id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta: { role: "assistant", content: payloadBytes === undefined ? "offline-response" : "x".repeat(payloadBytes) }, finish_reason: null }] };
      response.write("data: " + JSON.stringify(frame) + "\n\n");
      response.write("data: " + JSON.stringify({ ...frame, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }) + "\n\n");
      response.end("data: [DONE]\n\n");
    } catch { if (!response.headersSent) response.writeHead(400); response.end(); }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); if (!address || typeof address === "string") throw new Error("FIXTURE_ADDRESS");
  return { requests, baseUrl: "http://127.0.0.1:" + address.port + "/v1", async close() { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } };
}
function model(id: string, baseUrl: string): Model<"openai-completions"> {
  // Explicit fixture-only capacities/prices, NOT claims about the real models.
  return { id, name: id, provider: "custom-offline-wire", api: "openai-completions", baseUrl, input: ["text", "image"], reasoning: false, contextWindow: 4096, maxTokens: 32,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens" } };
}
it.each([SOLVER_MODEL, VERIFIER_MODEL])("serializes configured model %s, original image and explicit output limit", async id => {
  const wire = await fixture(200);
  try {
    const result = await stream(model(id, wire.baseUrl), { systemPrompt: "offline fixture", messages: [{ role: "user", content: [{ type: "text", text: "offline" }, { type: "image", data: "AQID", mimeType: "image/png" }], timestamp: 1 }] }, { apiKey: "synthetic-local-only", maxRetries: 0, timeoutMs: 1000, maxTokens: 32 }).result();
    expect(result.stopReason).toBe("stop"); expect(result.content).toContainEqual({ type: "text", text: "offline-response" });
    expect(wire.requests).toHaveLength(1);
    const request = wire.requests[0]; expect(request?.path).toBe("/v1/chat/completions"); expect(request?.auth).toBe("Bearer synthetic-local-only");
    const body = z.object({ model: z.literal(id), max_tokens: z.literal(32), stream: z.literal(true), messages: z.array(z.unknown()) }).parse(request?.body);
    expect(JSON.stringify(body.messages)).toContain("data:image/png;base64,AQID");
    expect(JSON.stringify(request?.body)).not.toContain('"store"');
  } finally { await wire.close(); }
});
it.each([401, 404, 429, 500])("does not retry or replace model on HTTP %i", async status => {
  const wire = await fixture(status);
  try {
    const request = createProviderRequest(wire.baseUrl + "/chat/completions");
    const result = await stream(model(SOLVER_MODEL, wire.baseUrl), { messages: [{ role: "user", content: "offline", timestamp: 1 }] }, { apiKey: "synthetic-local-only", maxRetries: 0, timeoutMs: 1000, maxTokens: 32, fetch: request.fetch }).result();
    expect(request.failure()).toBe(new Map([[401, "PROVIDER_AUTH_FAILED"], [404, "MODEL_UNAVAILABLE"], [429, "PROVIDER_RATE_LIMIT"], [500, "PROVIDER_UNAVAILABLE"]]).get(status));
    expect(result.stopReason).toBe("error"); expect(wire.requests).toHaveLength(1);
    expect(z.object({ model: z.string() }).parse(wire.requests[0]?.body).model).toBe(SOLVER_MODEL);
  } finally { await wire.close(); }
});
it.each([32, 1024 * 1024 + 1])("enforces bounded native SSE parsing for %i content bytes", async size => {
  const wire = await fixture(200, size);
  try {
    const request = createProviderRequest(wire.baseUrl + "/chat/completions");
    const result = await stream(model(SOLVER_MODEL, wire.baseUrl), { messages: [{ role: "user", content: "offline", timestamp: 1 }] }, { apiKey: "synthetic-local-only", maxRetries: 0, timeoutMs: 1000, maxTokens: 32, fetch: request.fetch }).result();
    if (size < 1024) {
      expect(result.stopReason).toBe("stop"); expect(request.failure()).toBeUndefined();
      expect(result.content).toContainEqual({ type: "text", text: "x".repeat(size) });
    } else {
      expect(result.stopReason).toBe("error"); expect(request.failure()).toBe("PROVIDER_RESPONSE_LIMIT");
      expect(JSON.stringify(result.content).length).toBeLessThan(4096);
    }
    expect(wire.requests).toHaveLength(1);
  } finally { await wire.close(); }
});
it("authorizes every native request and ignores mutable caller overrides", async () => {
  const wire = await fixture(200); let reservations = 0;
  const selected = model(SOLVER_MODEL, wire.baseUrl);
  const settings = { model: selected, apiKey: "synthetic-local-only", maxTokens: 32, timeoutMs: 1000, authorize: () => { reservations += 1; } };
  const adapter = createAuthorizedOpenAiStream(settings);
  settings.apiKey = "mutated"; settings.maxTokens = 1;
  try {
    for (let i = 0; i < 2; i += 1) {
      const result = await (await adapter.streamFunction(selected, { messages: [{ role: "user", content: "offline", timestamp: 1 }] }, { apiKey: "caller-override", maxTokens: 1, maxRetries: 9 })).result();
      expect(result.stopReason).toBe("stop");
    }
    expect(reservations).toBe(2); expect(wire.requests).toHaveLength(2);
    for (const request of wire.requests) { expect(request.auth).toBe("Bearer synthetic-local-only"); expect(z.object({ max_tokens: z.number() }).parse(request.body).max_tokens).toBe(32); }
  } finally { await wire.close(); }
});
it("denies rejected authorization and model substitution before HTTP dispatch", async () => {
  const wire = await fixture(200); const selected = model(SOLVER_MODEL, wire.baseUrl); let reservations = 0;
  const adapter = createAuthorizedOpenAiStream({ model: selected, apiKey: "synthetic-local-only", maxTokens: 32, timeoutMs: 1000, authorize: () => { reservations += 1; throw new Error("private-ledger-detail"); } });
  try {
    await expect(adapter.streamFunction({ ...selected, id: "other" }, { messages: [] })).rejects.toThrow("MODEL_DISPATCH_DENIED");
    expect(reservations).toBe(0);
    await expect(adapter.streamFunction(selected, { messages: [] })).rejects.toThrow("MODEL_DISPATCH_DENIED");
    expect(reservations).toBe(1); expect(wire.requests).toHaveLength(0);
  } finally { await wire.close(); }
});
it("retains fixed native HTTP error classification without retries", async () => {
  const wire = await fixture(404); const selected = model(SOLVER_MODEL, wire.baseUrl);
  const adapter = createAuthorizedOpenAiStream({ model: selected, apiKey: "synthetic-local-only", maxTokens: 32, timeoutMs: 1000, authorize: () => {} });
  try {
    const result = await (await adapter.streamFunction(selected, { messages: [{ role: "user", content: "offline", timestamp: 1 }] })).result();
    expect(result.stopReason).toBe("error"); expect(adapter.failure()).toBe("MODEL_UNAVAILABLE"); expect(wire.requests).toHaveLength(1);
  } finally { await wire.close(); }
});
