import { expect, it } from "vitest";
import { createProviderRequest } from "./provider-request.js";
const endpoint = "https://example.invalid/v1/chat/completions";
it("permits one exact POST and forces manual redirects", async () => {
  let calls = 0;
  const policy = createProviderRequest(endpoint, async (input, init) => {
    calls += 1; expect(new Request(input).url).toBe(endpoint); expect(init?.redirect).toBe("manual");
    return new Response("fixture", { status: 200 });
  });
  expect((await policy.fetch(endpoint, { method: "POST", redirect: "follow" })).status).toBe(200);
  expect(policy.failure()).toBeUndefined();
  await expect(policy.fetch(endpoint, { method: "POST" })).rejects.toThrow("PROVIDER_REQUEST_DENIED");
  expect(calls).toBe(1);
});
it.each(["https://other.invalid/v1/chat/completions", endpoint + "?secret=fixture"])("refuses a changed destination before transport", async url => {
  let calls = 0;
  const policy = createProviderRequest(endpoint, async () => { calls += 1; return new Response(); });
  await expect(policy.fetch(url, { method: "POST" })).rejects.toThrow("PROVIDER_REQUEST_DENIED");
  expect(calls).toBe(0);
});
it("records redirect refusal and sanitizes transport errors", async () => {
  const redirect = createProviderRequest(endpoint, async () => new Response(null, { status: 307, headers: { location: "https://other.invalid" } }));
  expect((await redirect.fetch(endpoint, { method: "POST" })).status).toBe(307);
  expect(redirect.failure()).toBe("PROVIDER_REDIRECT_DENIED");
  const failing = createProviderRequest(endpoint, async () => { throw new Error("private-network-detail"); });
  await expect(failing.fetch(endpoint, { method: "POST" })).rejects.toThrow("PROVIDER_TRANSPORT_FAILED");
  expect(failing.failure()).toBe("PROVIDER_TRANSPORT_FAILED");
});
it("cannot revive an instance after destination rejection", async () => {
  let calls = 0;
  const policy = createProviderRequest(endpoint, async () => { calls += 1; return new Response(); });
  await expect(policy.fetch(endpoint + "?unexpected=true", { method: "POST" })).rejects.toThrow("PROVIDER_REQUEST_DENIED");
  await expect(policy.fetch(endpoint, { method: "POST" })).rejects.toThrow("PROVIDER_REQUEST_DENIED");
  expect(calls).toBe(0);
});
it("never dispatches an already cancelled request even to a noncooperative transport", async () => {
  let calls = 0; const controller = new AbortController(); controller.abort(new Error("private-cancel-reason"));
  const policy = createProviderRequest(endpoint, async () => { calls += 1; return new Response(); });
  await expect(policy.fetch(endpoint, { method: "POST", signal: controller.signal })).rejects.toThrow("PROVIDER_REQUEST_DENIED");
  expect(calls).toBe(0);
});
