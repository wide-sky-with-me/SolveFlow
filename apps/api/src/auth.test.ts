import { afterEach, expect, it, vi } from "vitest";
import { createIdentity } from "./auth.js";
afterEach(() => vi.useRealTimers());
it("separates native bearer credentials from browser cookies", () => {
  const secret = "x".repeat(32); const browser = createIdentity(secret); const native = createIdentity(secret, "native-v1");
  const a = browser.issue(); const b = native.issue();
  expect(browser.verify(a.cookie)).toBe(a.id); expect(native.verify(b.cookie)).toBe(b.id);
  expect(() => browser.verify(b.cookie)).toThrow(); expect(() => native.verify(a.cookie)).toThrow();
  expect(() => native.verify(b.cookie + "x")).toThrow();
});
it("native credentials expire and cannot be replaced with a public owner ID", () => {
  vi.useFakeTimers(); const native = createIdentity("x".repeat(32), "native-v1"); const issued = native.issue();
  expect(() => native.verify(issued.id)).toThrow();
  vi.advanceTimersByTime(30 * 86400_000 + 1);
  expect(() => native.verify(issued.cookie)).toThrow();
});
