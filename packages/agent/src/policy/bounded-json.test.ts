import { expect, it } from "vitest";
import { assertBoundedJson } from "./bounded-json.js";

it("accepts bounded JSON including null-prototype records", () => {
  assertBoundedJson({ text: "中文", array: [1, null, false, { x: "y" }] });
  assertBoundedJson(Object.create(null));
});
it('allows an explicit application envelope for complete Unicode drafts without relaxing tool limits', () => {
  const input = { message: '文'.repeat(8000), focus: { answer: '答'.repeat(8000) } };
  expect(() => assertBoundedJson(input)).toThrow('JSON_INPUT_LIMIT');
  expect(() => assertBoundedJson(input, 256 * 1024)).not.toThrow();
  expect(() => assertBoundedJson(input, 256 * 1024 + 1)).toThrow();
  expect(() => assertBoundedJson({ answer: 'x'.repeat(8193) }, 256 * 1024)).toThrow();
});
it.each(["x".repeat(8193), [1, , 3], Array(2049).fill(0), { x: Infinity }, { x: undefined }, new Date(), { fn: () => {} }, { [Symbol("x")]: 1 }, Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i, "中".repeat(2000)]))])("rejects non-JSON or oversized input %#", value => {
  expect(() => assertBoundedJson(value)).toThrow("JSON_INPUT_LIMIT");
});
it("rejects cycles and excessive depth without invoking getters", () => {
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  expect(() => assertBoundedJson(cyclic)).toThrow("JSON_INPUT_LIMIT");
  let deep: unknown = 0; for (let i = 0; i < 18; i++) deep = { deep };
  expect(() => assertBoundedJson(deep)).toThrow("JSON_INPUT_LIMIT");
  let invoked = false;
  expect(() => assertBoundedJson({ get data() { invoked = true; return "hidden"; } })).toThrow("JSON_INPUT_LIMIT");
  expect(invoked).toBe(false);
});
