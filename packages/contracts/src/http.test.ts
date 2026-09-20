import { expect, it } from "vitest";
import { CreateRunSchema, CreateSessionSchema, parseRunEvent } from "./http.js";
const runId = "00000000-0000-4000-8000-000000000001";
it("rejects client-supplied owner, remote image and overlong follow-up", () => {
  expect(CreateSessionSchema.safeParse({ schemaVersion: 1, uploadId: runId, ownerId: runId }).success).toBe(false);
  expect(CreateRunSchema.safeParse({ schemaVersion: 1, imageUrl: "https://example.com/a.jpg" }).success).toBe(false);
  expect(CreateRunSchema.safeParse({ schemaVersion: 1, message: "a".repeat(2001) }).success).toBe(false);
});
it("requires versioned monotonic event metadata and excludes private fields", () => {
  const event = { schemaVersion: 1, type: "run.status", runId, seq: 1, status: "solving" };
  expect(parseRunEvent(event)).toEqual(event);
  expect(() => parseRunEvent({ ...event, seq: 0 })).toThrow();
  expect(() => parseRunEvent({ ...event, thinking: "private" })).toThrow();
  expect(() => parseRunEvent({ ...event, schemaVersion: 2 })).toThrow();
});
it("validates explicit step and correction references without trusting client answers", () => {
  const context = { kind: "step", sourceRunId: runId, stepId: "step2" };
  expect(CreateRunSchema.safeParse({ schemaVersion: 1, context }).success).toBe(true);
  expect(CreateRunSchema.safeParse({ schemaVersion: 1, context: { ...context, verified: true } }).success).toBe(false);
  expect(CreateRunSchema.safeParse({ schemaVersion: 1, context: { kind: "correction", sourceRunId: runId, text: " " } }).success).toBe(false);
});
