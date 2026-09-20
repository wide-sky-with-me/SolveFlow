import { expect, it } from "vitest";
import { boundProviderResponse } from "./bounded-response.js";
import { createProviderRequest } from "./provider-request.js";
it("preserves exact-limit data/status while dropping stale length/encoding", async () => {
  const failures: string[] = [];
  const result = boundProviderResponse(new Response("éé", { status: 201, headers: { "content-length": "999", "content-encoding": "gzip", "content-type": "text/plain" } }), code => failures.push(code), 4);
  expect(await result.text()).toBe("éé"); expect(result.status).toBe(201);
  expect(result.headers.get("content-length")).toBeNull(); expect(result.headers.get("content-encoding")).toBeNull(); expect(failures).toEqual([]);
});
it("rejects cumulative overflow and cancels the underlying stream", async () => {
  let cancelled = false; const failures: string[] = [];
  const source = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(3)); controller.enqueue(new Uint8Array(3)); }, cancel() { cancelled = true; } });
  const result = boundProviderResponse(new Response(source), code => failures.push(code), 5);
  await expect(result.arrayBuffer()).rejects.toThrow("PROVIDER_RESPONSE_LIMIT");
  expect(cancelled).toBe(true); expect(failures).toEqual(["PROVIDER_RESPONSE_LIMIT"]);
});
it("sanitizes read errors and forwards consumer cancellation", async () => {
  const broken = new ReadableStream<Uint8Array>({ pull() { throw new Error("private-stream-error"); } });
  await expect(boundProviderResponse(new Response(broken), () => {}).text()).rejects.toThrow("PROVIDER_TRANSPORT_FAILED");
  let cancelled = false;
  const source = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  await boundProviderResponse(new Response(source), () => {}).body?.cancel(); expect(cancelled).toBe(true);
});
it("integrates the one-MiB limit with provider failure classification", async () => {
  const endpoint = "https://example.invalid/v1/chat/completions";
  const policy = createProviderRequest(endpoint, async () => new Response(new Uint8Array(1024 * 1024 + 1)));
  const result = await policy.fetch(endpoint, { method: "POST" });
  await expect(result.arrayBuffer()).rejects.toThrow("PROVIDER_RESPONSE_LIMIT"); expect(policy.failure()).toBe("PROVIDER_RESPONSE_LIMIT");
});
it("rejects invalid limit configuration", () => {
  for (const limit of [0, -1, 0.5, 1024 * 1024 + 1]) expect(() => boundProviderResponse(new Response("x"), () => {}, limit)).toThrow("INVALID_RESPONSE_LIMIT");
});
