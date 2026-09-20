import { expect, it } from "vitest";
import { boundedBody } from "./bounded-body.js";
it("bounds bytes without trusting the declared length", async () => {
  await expect(boundedBody(new Request("http://local", { method: "POST", headers: { "content-length": "1" }, body: "a".repeat(33) }), 32)).rejects.toMatchObject({ code: "TOO_LARGE" });
});
it("cancels stalled incoming body reads at the deadline", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const request = new Request("http://local", { method: "POST", body: stream, ...{ duplex: "half" } });
  await expect(boundedBody(request, 32, 30)).rejects.toMatchObject({ code: "INVALID_INPUT" }); expect(cancelled).toBe(true);
});
