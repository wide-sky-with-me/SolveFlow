import { describe, expect, it } from "vitest";
import { CapabilitySnapshot, schemaHash, type Capability } from "./capability-snapshot.js";

const identity = { ownerId: "a", runId: "run-a" };
const schema = { type: "object", properties: { text: { type: "string" } }, required: ["text"] };
const entry: Capability = { name: "read", source: "<sdk:read>", schema, category: "file" };
const signal = () => new AbortController().signal;

describe("per-run capability snapshot", () => {
  it("hashes object key order canonically while retaining constraints", () => {
    expect(schemaHash(schema)).toBe(schemaHash({ required: ["text"], properties: { text: { type: "string" } }, type: "object" }));
    expect(schemaHash(schema)).not.toBe(schemaHash({ ...schema, additionalProperties: false }));
  });
  it("rejects unsafe and unbounded schema values", () => {
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    expect(() => schemaHash(cycle)).toThrow("INVALID_SCHEMA");
    expect(() => schemaHash({ test: () => {} })).toThrow("INVALID_SCHEMA");
    expect(() => schemaHash({ description: "x".repeat(9000) })).toThrow();
  });
  it.each([
    { actual: [] },
    { actual: [entry, entry] },
    { actual: [{ ...entry, name: "bash" }] },
    { actual: [{ ...entry, source: "<builtin:read>" }] },
    { actual: [{ ...entry, schema: { type: "object" } }] },
  ])("rejects missing, unknown, duplicate or changed tools", ({ actual }) => {
    const snapshot = new CapabilitySnapshot(identity, [entry]);
    expect(() => snapshot.assertRegistered(actual)).toThrow("CAPABILITY_MISMATCH");
  });
  it("never expands after admission metadata is mutated", () => {
    const admitted = { ...entry, schema: structuredClone(schema) };
    const list = [admitted];
    const snapshot = new CapabilitySnapshot(identity, list);
    admitted.schema.required.push("ownerId");
    list.push({ ...entry, name: "bash", schema });
    snapshot.assertRegistered([entry]);
    expect(snapshot.names()).toEqual(["read"]);
    expect(() => snapshot.authorize("bash", identity, signal())).toThrow("CAPABILITY_DENIED");
  });
  it("checks owner and run and cancels revoked capabilities immediately", () => {
    const snapshot = new CapabilitySnapshot(identity, [entry]);
    expect(() => snapshot.authorize("read", { ...identity, ownerId: "b" }, signal())).toThrow("CAPABILITY_DENIED");
    expect(() => snapshot.authorize("read", { ...identity, runId: "run-b" }, signal())).toThrow("CAPABILITY_DENIED");
    const active = snapshot.authorize("read", identity, signal());
    expect(active.category).toBe("file");
    snapshot.revoke("read");
    expect(active.signal.aborted).toBe(true);
    expect(() => snapshot.authorize("read", identity, signal())).toThrow("CAPABILITY_DENIED");
  });
});
