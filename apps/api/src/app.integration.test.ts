import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { S3Client, DeleteBucketCommand, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { connectDatabase, migrate, Repository } from "@solveflow/db";
import { loadAppConfig } from "@solveflow/config";
import { BootstrapSchema, NativeBootstrapSchema, UploadViewSchema, RunViewSchema, parseRunEvent } from "@solveflow/contracts/http";
import { makeSafeAgentError } from "@solveflow/contracts/agent";
import { createProbeImage } from "@solveflow/agent/application";
import { z } from "zod";
import { createApp } from "./app.js";
import { S3ImageStore } from "./storage.js";
import { demoExecutor, processNext } from "./worker.js";
import sharp from "sharp";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SolveOutcomeSchema } from "@solveflow/contracts/agent";
import { startOfflineProbeProvider, offlineModelConnections } from "../../../scripts/offline-probe-provider.mjs";
import { SpendLedger } from "../../../packages/agent/src/policy/spend-ledger.js";
import { createModelSpendGate } from "../../../packages/agent/src/policy/model-spend.js";
import { runIsolatedWorker } from "../../../packages/agent/src/policy/isolated-worker.js";

const suffix = randomUUID().replaceAll("-", "");
const databaseName = `solveflow_test_${suffix}`;
const bucket = `solveflow-test-${suffix}`;
const config = loadAppConfig(parseEnv(await readFile(new URL("../../../.env", import.meta.url), "utf8")));
const adminUrl = new URL(config.databaseUrl);
if (adminUrl.hostname !== "127.0.0.1" || adminUrl.port !== "54329") throw new Error("ISOLATED_LOCAL_DATABASE_REQUIRED");
const admin = connectDatabase(adminUrl.href); adminUrl.pathname = `/${databaseName}`;
const database = connectDatabase(adminUrl.href);
const repository = new Repository(database.db);
const storage = new S3ImageStore({ ...config.storage, bucket });
const s3 = new S3Client({ endpoint: config.storage.endpoint, region: config.storage.region, forcePathStyle: true, credentials: { accessKeyId: config.storage.accessKeyId, secretAccessKey: config.storage.secretAccessKey } });
const app = createApp({ repository, storage, config: { ...config, mode: "demo" } });
const request = (path: string, cookie = "", method = "GET", body?: object, key?: string) => app.request(`/api/v1${path}`, {
  method, headers: { origin: config.origin, cookie, ...(body ? { "content-type": "application/json" } : {}), ...(key ? { "idempotency-key": key } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
});
async function owner() {
  const response = await request("/bootstrap", "", "POST"); expect(response.status).toBe(200);
  const data = BootstrapSchema.parse(await response.json()); const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("COOKIE_MISSING"); return { id: data.ownerId, cookie };
}
async function fixture(subject?: "math") {
  const user = await owner(); const form = new FormData(); form.set("file", new File([Uint8Array.from(createProbeImage())], "sample.png", { type: "image/png" }));
  const response = await app.request("/api/v1/uploads", { method: "POST", headers: { cookie: user.cookie, origin: config.origin }, body: form });
  expect(response.status).toBe(201); const upload = UploadViewSchema.parse(await response.json());
  const created = await request("/sessions", user.cookie, "POST", { schemaVersion: 1, uploadId: upload.id, ...(subject ? { subject } : {}) }); expect(created.status).toBe(201);
  const session = z.object({ id: z.uuid() }).parse(await created.json());
  expect((await repository.getSession(user.id, session.id)).subject).toBe(subject ?? "general");
  return { ...user, upload, sessionId: session.id };
}
async function queue(user: Awaited<ReturnType<typeof fixture>>) {
  const response = await request(`/sessions/${user.sessionId}/runs`, user.cookie, "POST", { schemaVersion: 1 }, randomUUID());
  expect(response.status).toBe(202); return RunViewSchema.parse(await response.json());
}
beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(database.pool); await migrate(database.pool);
  await Promise.all([storage.ensurePrivateBucket(), storage.ensurePrivateBucket()]);
});
afterAll(async () => {
  storage.close();
  const objects = await s3.send(new ListObjectsV2Command({ Bucket: bucket }));
  for (const object of objects.Contents ?? []) if (object.Key) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: object.Key }));
  await s3.send(new DeleteBucketCommand({ Bucket: bucket })); s3.destroy();
  await database.close(); await admin.pool.query(`DROP DATABASE "${databaseName}"`); await admin.close();
});
describe("real PostgreSQL + private MinIO + Hono", () => {
  it.each([
    ["pass", "completed", true, 1], ["diagram", "completed", true, 1], ["fail-pass", "completed", true, 2],
    ["fail-fail", "completed", false, 2], ["missing-learning", "completed", false, 2], ["unknown", "completed", false, 1],
    ["clarification", "needs_clarification", false, 0], ["unavailable", "failed", false, 0],
    ["invalid-json", "failed", false, 0], ["policy", "needs_clarification", false, 1],
  ] as const)("persists real Pi HTTP-provider scenario %s through the application worker", async (scenario, status, verified, checks) => {
    const provider = await startOfflineProbeProvider({ scenario });
    const directory = await mkdtemp(join(tmpdir(), "solveflow-m1-provider-"));
    const ledgerPath = join(directory, "ledger"); await writeFile(ledgerPath, "", { mode: 0o600 });
    const ledger = SpendLedger.open(ledgerPath);
    try {
      const user = await fixture(); const run = await queue(user);
      const connections = offlineModelConnections(provider.baseURL);
      await processNext(repository, storage, async (input, signal, onEvent, timeoutMs) => {
        const { image, ...data } = input;
        return SolveOutcomeSchema.parse(await runIsolatedWorker(new URL("../../../packages/agent/dist/pi/application-worker.js", import.meta.url),
          { data, mimeType: image.mimeType, connections, runDirectory: directory },
          { image: image.bytes, signal, timeoutMs, onEvent, authorizeModel: createModelSpendGate(ledger, { solver: connections.solver.route, verifier: connections.verifier.route }, input.identity.runId) }));
      }, randomUUID(), new AbortController().signal);
      const result = await repository.getRun(user.id, run.id);
      expect(result.outcome).toMatchObject({ status, verified });
      if (scenario === "diagram") { expect(provider.observations.diagramReads).toBe(2); expect(result.outcome).toMatchObject({ candidate: { figures: [{ id: "line" }] }, verification: { checked: expect.arrayContaining(["diagram"]) } }); }
      if (scenario === "missing-learning") expect(result.outcome).toMatchObject({ verification: { verdict: "fail", issues: [{ code: "INVALID_CANDIDATE" }] } });
      if (scenario === "unavailable") expect(result.outcome).toMatchObject({ error: { code: "MODEL_UNAVAILABLE" } });
      expect(provider.observations.verifierWithoutTools).toBe(checks);
      if (scenario !== "unavailable") expect(provider.observations.images).toBe(provider.observations.requests);
      if (status === "completed") expect(provider.observations.calculations).toBe(checks === 2 ? 2 : 1);
      const events = await repository.events(user.id, run.id, 0);
      expect(events.events.at(-1)?.type).toBe("run.done");
      expect(JSON.stringify(events)).not.toContain("private-fixture-canary");
      if (scenario === "policy") {
        expect(result.outcome).toMatchObject({ candidate: { refusalReason: "policy", answer: null, steps: [] } });
        expect(JSON.stringify(result)).not.toContain("rejected-");
        expect(JSON.stringify(events)).not.toContain("rejected-");
        const response = await request(`/runs/${run.id}`, user.cookie);
        expect(await response.text()).not.toContain("rejected-");
        const streamed = await request(`/runs/${run.id}/events`, user.cookie);
        expect(await streamed.text()).not.toContain("rejected-");
      }
      expect(ledger.snapshot().attempts).toBe(provider.observations.requests);
    } finally { ledger.close(); await provider.close(); await rm(directory, { recursive: true, force: true }); }
  });
  it("requires identity and same origin; errors contain no internal exception", async () => {
    expect((await request("/sessions")).status).toBe(401);
    expect((await app.request("/api/v1/bootstrap", { method: "POST" })).status).toBe(403);
    const user = await owner(); const malformed = await request("/sessions/not-a-uuid", user.cookie);
    expect(malformed.status).toBe(400); expect(await malformed.text()).not.toContain("Zod");
  });
  it("enforces owner on image, binding, session, run, SSE, cancel and delete", async () => {
    const first = await fixture(); const other = await owner(); const run = await queue(first);
    for (const [path, method] of [[`/uploads/${first.upload.id}/image`, "GET"], [`/sessions/${first.sessionId}`, "GET"], [`/sessions/${first.sessionId}`, "DELETE"], [`/runs/${run.id}`, "GET"], [`/runs/${run.id}/events`, "GET"], [`/runs/${run.id}/cancel`, "POST"], [`/uploads/${first.upload.id}`, "DELETE"]]) {
      expect((await request(path!, other.cookie, method)).status).toBe(404);
    }
    expect((await request("/sessions", other.cookie, "POST", { schemaVersion: 1, uploadId: first.upload.id })).status).toBe(404);
    const image = await request(`/uploads/${first.upload.id}/image`, first.cookie); expect(image.status).toBe(200); expect(image.headers.get("cache-control")).toContain("no-store");
    const raw = await repository.getUpload(first.id, first.upload.id);
    expect((await fetch(`${config.storage.endpoint}/${bucket}/${raw.objectKey}`)).status).toBe(403);
    await repository.cancel(first.id, run.id);
  });
  it("serializes duplicate keys and different concurrent submissions", async () => {
    const user = await fixture(); const key = randomUUID(); const input = { schemaVersion: 1, message: "help" };
    const duplicates = await Promise.all(Array.from({ length: 5 }, () => repository.createRun(user.id, user.sessionId, key, input)));
    expect(new Set(duplicates.map(run => run.id)).size).toBe(1);
    await expect(repository.createRun(user.id, user.sessionId, key, { ...input, message: "changed" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(repository.createRun(user.id, user.sessionId, randomUUID(), input)).rejects.toMatchObject({ code: "CONFLICT" });
    await repository.cancel(user.id, duplicates[0]!.id);
    const results = await Promise.allSettled([repository.createRun(user.id, user.sessionId, randomUUID(), input), repository.createRun(user.id, user.sessionId, randomUUID(), input)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    for (const result of results) if (result.status === "fulfilled") await repository.cancel(user.id, result.value.id);
  });
  it("runs actual upload→queue→worker→verification→atomic SSE and follow-up", async () => {
    const user = await fixture(); const run = await queue(user); const execute = await demoExecutor();
    expect(await processNext(repository, storage, execute, randomUUID(), new AbortController().signal)).toBe(true);
    const completed = await repository.getRun(user.id, run.id); expect(completed.status).toBe("completed"); expect(completed.outcome?.verified).toBe(true);
    const snapshot = await repository.events(user.id, run.id, 0);
    expect(snapshot.events.map(event => event.seq)).toEqual(Array.from({ length: completed.seq }, (_, index) => index + 1));
    expect(snapshot.events.slice(-3).map(event => event.type)).toEqual(["run.status", "answer.final", "run.done"]);
    const sse = await request(`/runs/${run.id}/events?after=${completed.seq - 2}`, user.cookie); expect(sse.headers.get("content-type")).toContain("text/event-stream");
    const payload = await sse.text(); expect(payload).toContain("answer.final"); expect(payload).not.toContain("thinking");
    for (const line of payload.split("\n").filter(line => line.startsWith("data: "))) parseRunEvent(JSON.parse(line.slice(6)));
    const followup = await queue(user); let history = 0;
    await processNext(repository, storage, async (input, ...args) => { history = input.history?.length ?? 0; return execute(input, ...args); }, randomUUID(), new AbortController().signal);
    expect(history).toBe(1); expect((await repository.getRun(user.id, followup.id)).status).toBe("completed");
  });
  it("persists cancellation before a late worker result", async () => {
    const user = await fixture(); const run = await queue(user); const worker = randomUUID(); await repository.claim(worker);
    await repository.cancel(user.id, run.id);
    expect(await repository.finish(run.id, worker, { schemaVersion: 1, status: "failed", verified: false, error: makeSafeAgentError("INTERNAL_ERROR", run.id) })).toBe(false);
    expect(await repository.heartbeat(run.id, worker)).toBe(false); expect((await repository.getRun(user.id, run.id)).status).toBe("cancelled");
  });
  it("automatically corrects the stored subject with the atomic result, but ignores cancelled late corrections", async () => {
    const user = await fixture("math");
    expect((await repository.getSession(user.id, user.sessionId)).subject).toBe("math");
    const result = SolveOutcomeSchema.parse({ schemaVersion: 1, status: "completed", verified: true, warning: null,
      verification: { schemaVersion: 1, verdict: "pass", checked: ["transcription", "diagram"], issues: [] },
      candidate: { schemaVersion: 1, kind: "answer", problem: { text: "位置随时间变化", subject: "physics", uncertainties: [] }, answer: "匀速运动", steps: [], citationIds: [], knowledgePoints: [], clarificationQuestions: [],
        figures: [{ schemaVersion: 1, id: "motion", kind: "coordinate", title: "位置与时间", description: "位置随时间线性增加", xRange: [0, 5], yRange: [0, 10], elements: [{ kind: "polynomial", coefficients: [0, 2] }] }] } });
    if (result.status !== "completed") throw new Error("INVALID_FIXTURE");
    const run = await queue(user); const worker = randomUUID(); await repository.claim(worker);
    expect(await repository.finish(run.id, worker, result)).toBe(true);
    const saved = await repository.getSession(user.id, user.sessionId);
    expect(saved.subject).toBe("physics"); expect(saved.runs[0]?.outcome).toEqual(result);
    const late = await queue(user); await repository.claim(worker); await repository.cancel(user.id, late.id);
    expect(await repository.finish(late.id, worker, { ...result, candidate: { ...result.candidate, problem: { ...result.candidate.problem, subject: "math" } } })).toBe(false);
    expect((await repository.getSession(user.id, user.sessionId)).subject).toBe("physics");
  });
  it("refuses execution while disabled without enqueueing a paid job", async () => {
    const user = await fixture();
    const disabled = createApp({ repository, storage, config: { ...config, mode: "disabled" } });
    const result = await disabled.request(`/api/v1/sessions/${user.sessionId}/runs`, { method: "POST", headers: { cookie: user.cookie, origin: config.origin, "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ schemaVersion: 1 }) });
    expect(result.status).toBe(503); expect((await repository.getSession(user.id, user.sessionId)).runs).toHaveLength(0);
  });
  it("reports insufficient spending capacity distinctly and persists safe SSE failure", async () => {
    const user = await fixture(); const run = await queue(user);
    await processNext(repository, storage, async () => { throw new Error("SPEND_LIMIT"); }, randomUUID(), new AbortController().signal);
    const result = await repository.getRun(user.id, run.id);
    expect(result.outcome).toMatchObject({ status: "failed", verified: false, error: { code: "SPEND_LIMIT", retryable: false } });
    const snapshot = await repository.events(user.id, run.id, 0);
    expect(snapshot.events.slice(-2).map(event => event.type)).toEqual(["run.error", "run.done"]);
  });
  it("disables new paid submissions before queueing when admission reports insufficient funds", async () => {
    const user = await fixture();
    const limited = createApp({ repository, storage, config: { ...config, mode: "live" }, spendStatus: () => "SPEND_LIMIT" });
    const bootstrap = await limited.request("/api/v1/bootstrap", { method: "POST", headers: { origin: config.origin, cookie: user.cookie } });
    expect(BootstrapSchema.parse(await bootstrap.json())).toMatchObject({ solvingAvailable: false, unavailableReason: "SPEND_LIMIT" });
    const result = await limited.request(`/api/v1/sessions/${user.sessionId}/runs`, { method: "POST", headers: { cookie: user.cookie, origin: config.origin, "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ schemaVersion: 1 }) });
    expect(result.status).toBe(503); expect(await result.json()).toMatchObject({ error: { code: "SPEND_LIMIT", retryable: false } });
    expect((await repository.getSession(user.id, user.sessionId)).runs).toHaveLength(0);
    const key = randomUUID();
    const prior = await repository.createRun(user.id, user.sessionId, key, { schemaVersion: 1, message: "" });
    await repository.cancel(user.id, prior.id);
    const replay = await limited.request(`/api/v1/sessions/${user.sessionId}/runs`, { method: "POST", headers: { cookie: user.cookie, origin: config.origin, "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify({ schemaVersion: 1 }) });
    expect(replay.status).toBe(202); expect(RunViewSchema.parse(await replay.json()).id).toBe(prior.id);
  });
  it("does not give arbitrary photos the demo fixture answer", async () => {
    const user = await fixture(); const raw = await repository.getUpload(user.id, user.upload.id);
    await storage.put(raw.objectKey, await sharp({ create: { width: 20, height: 20, channels: 3, background: "blue" } }).jpeg().toBuffer(), AbortSignal.timeout(5000));
    const run = await queue(user); await processNext(repository, storage, await demoExecutor(), randomUUID(), new AbortController().signal);
    expect((await repository.getRun(user.id, run.id)).outcome).toMatchObject({ status: "needs_clarification", verified: false });
  });
  it("disconnecting SSE does not cancel work; explicit cancellation aborts the executor", async () => {
    const user = await fixture(); const run = await queue(user);
    const sse = await request(`/runs/${run.id}/events`, user.cookie); const reader = sse.body!.getReader(); await reader.read(); await reader.cancel();
    expect((await repository.getRun(user.id, run.id)).status).toBe("queued");
    const started = Promise.withResolvers<void>(); let aborted = false;
    const task = processNext(repository, storage, async (_input, signal) => {
      started.resolve(); await new Promise<void>(resolve => signal.addEventListener("abort", () => { aborted = true; resolve(); }, { once: true }));
      throw new Error("CANCELLED");
    }, randomUUID(), new AbortController().signal);
    await started.promise; await repository.cancel(user.id, run.id); await task;
    expect(aborted).toBe(true); expect((await repository.getRun(user.id, run.id)).status).toBe("cancelled");
  });
  it("bounds total owner runs under concurrent submissions across sessions", async () => {
    const user = await fixture();
    // Fill the owner's daily allowance across three sessions, without any model calls.
    const ids: string[] = [user.sessionId];
    for (let i = 0; i < 3; i++) {
      const id = randomUUID(); await repository.addUpload(user.id, { id, objectKey: `quota/${id}`, bytes: 1, width: 1, height: 1, hash: "fixture" });
      ids.push((await repository.createSession(user.id, { schemaVersion: 1, uploadId: id })).id);
    }
    for (let i = 0; i < 29; i++) {
      const run = await repository.createRun(user.id, ids[Math.floor(i / 10)]!, randomUUID(), { schemaVersion: 1 }); await repository.cancel(user.id, run.id);
    }
    const results = await Promise.allSettled([repository.createRun(user.id, ids[2]!, randomUUID(), { schemaVersion: 1 }), repository.createRun(user.id, ids[3]!, randomUUID(), { schemaVersion: 1 })]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "DAILY_LIMIT" } });
    for (const result of results) if (result.status === "fulfilled") await repository.cancel(user.id, result.value.id);
  });
  it("marks expired leases WORKER_LOST without requeue; expires event cursors", async () => {
    const user = await fixture(); const run = await queue(user); await repository.claim(randomUUID());
    await database.pool.query("UPDATE runs SET lease_expires_at=now()-interval '1 second' WHERE id=$1", [run.id]);
    await repository.recoverLost(); const result = await repository.getRun(user.id, run.id);
    expect(result.outcome).toMatchObject({ status: "failed", error: { code: "WORKER_LOST" } }); expect(await repository.claim(randomUUID())).toBeNull();
    await database.pool.query("UPDATE runs SET created_at=now()-interval '25 hours' WHERE id=$1", [run.id]);
    expect((await request(`/runs/${run.id}/events`, user.cookie)).status).toBe(410); expect((await request(`/runs/${run.id}`, user.cookie)).status).toBe(200);
  });
  it("revokes deleted image immediately and cleans private data and objects", async () => {
    const user = await fixture(); const run = await queue(user); const raw = await repository.getUpload(user.id, user.upload.id);
    expect((await request(`/sessions/${user.sessionId}`, user.cookie, "DELETE")).status).toBe(204);
    expect((await request(`/uploads/${user.upload.id}/image`, user.cookie)).status).toBe(404);
    expect((await request(`/runs/${run.id}`, user.cookie)).status).toBe(404);
    await repository.cleanupBatch(key => storage.remove(key, AbortSignal.timeout(5000)));
    await expect(storage.get(raw.objectKey, AbortSignal.timeout(5000))).rejects.toBeDefined();
    expect((await database.pool.query("SELECT id FROM runs WHERE id=$1", [run.id])).rowCount).toBe(0);
  });
  it("expires abandoned uploads and bounds storage deletion retries", async () => {
    const user = await owner(); const id = randomUUID(); const objectKey = `expiry/${id}`;
    await repository.addUpload(user.id, { id, objectKey, bytes: 1, width: 1, height: 1, hash: "fixture" });
    await storage.put(objectKey, new Uint8Array([1]), AbortSignal.timeout(5000));
    await database.pool.query("UPDATE uploads SET expires_at=now()-interval '1 second' WHERE id=$1", [id]);
    await expect(repository.getUpload(user.id, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    let attempts = 0;
    for (let i = 0; i < 5; i++) await expect(repository.cleanupBatch(async key => { if (key === objectKey) { attempts++; throw new Error("storage offline"); } await storage.remove(key, AbortSignal.timeout(5000)); })).rejects.toThrow("storage offline");
    await repository.cleanupBatch(async () => { attempts++; }); expect(attempts).toBe(5);
  });
});

it("persists owned step references, hashes the context and resolves it in the worker", async () => {
  const user = await fixture(); const source = await queue(user); const execute = await demoExecutor();
  await processNext(repository, storage, execute, randomUUID(), new AbortController().signal);
  const other = await fixture();
  const context = { kind: "step", sourceRunId: source.id, stepId: "step2" };
  const input = { schemaVersion: 1, message: "为什么？", context }; const key = randomUUID();
  await expect(repository.createRun(other.id, other.sessionId, key, input)).rejects.toMatchObject({ code: "NOT_FOUND" });
  const extraImage = randomUUID(); await repository.addUpload(user.id, { id: extraImage, objectKey: `context/${extraImage}`, bytes: 1, width: 1, height: 1, hash: "fixture" });
  const sameOwnerSession = await repository.createSession(user.id, { schemaVersion: 1, uploadId: extraImage });
  await expect(repository.createRun(user.id, sameOwnerSession.id, key, input)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(repository.createRun(user.id, user.sessionId, key, { ...input, context: { ...context, stepId: "unknown" } })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  const run = await repository.createRun(user.id, user.sessionId, key, input);
  expect((await repository.createRun(user.id, user.sessionId, key, input)).id).toBe(run.id);
  await expect(repository.createRun(user.id, user.sessionId, key, { ...input, context: { ...context, stepId: "step1" } })).rejects.toMatchObject({ code: "CONFLICT" });
  expect((await repository.getSession(user.id, user.sessionId)).runs.at(-1)?.context).toEqual(context);
  let resolved = false;
  await processNext(repository, storage, async (value, ...args) => {
    expect(value.focus).toMatchObject({ sourceRunId: source.id, kind: "step", verified: true });
    expect(value.focus?.content).toContain("两边同时除以系数");
    expect(value.history?.at(-1)?.answer).toContain("教学步骤"); resolved = true; return execute(value, ...args);
  }, randomUUID(), new AbortController().signal);
  expect(resolved).toBe(true);
});

it("retains the pending clarification for a short reply and carries corrections into later runs", async () => {
  const user = await fixture(); const first = await queue(user); const execute = await demoExecutor();
  const clarification = SolveOutcomeSchema.parse({ schemaVersion: 1, status: "needs_clarification", verified: false, candidate: { schemaVersion: 1, kind: "clarification", problem: { text: "ax=6", subject: "math", uncertainties: ["a不清楚"] }, answer: null, steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: ["系数a是多少？"] } });
  await processNext(repository, storage, async () => clarification, randomUUID(), new AbortController().signal);
  await repository.createRun(user.id, user.sessionId, randomUUID(), { schemaVersion: 1, message: "3" });
  let checked = false;
  await processNext(repository, storage, async (input, ...args) => {
    expect(input.message).toBe("3"); expect(input.history?.at(-1)?.answer).toContain("系数a是多少"); checked = true; return execute(input, ...args);
  }, randomUUID(), new AbortController().signal);
  expect(checked).toBe(true);
  const text = "左侧常数项应是5，不是3。";
  const corrected = await repository.createRun(user.id, user.sessionId, randomUUID(), { schemaVersion: 1, context: { kind: "correction", sourceRunId: first.id, text } });
  let corrections = 0;
  const inspect: typeof execute = async (input, ...args) => { expect(input.problemCorrection).toBe(text); corrections++; return execute(input, ...args); };
  await processNext(repository, storage, inspect, randomUUID(), new AbortController().signal);
  await queue(user); await processNext(repository, storage, inspect, randomUUID(), new AbortController().signal);
  expect(corrections).toBe(2);
  expect((await repository.getRun(user.id, first.id)).outcome).toEqual(clarification);
  expect((await repository.getRun(user.id, corrected.id)).context).toMatchObject({ kind: "correction", text });
});

it("distinguishes a permanent session capacity limit from a temporary rate limit", async () => {
  const user = await fixture();
  for (let i = 0; i < 10; i++) { const run = await repository.createRun(user.id, user.sessionId, randomUUID(), { schemaVersion: 1 }); await repository.cancel(user.id, run.id); }
  const response = await request(`/sessions/${user.sessionId}/runs`, user.cookie, "POST", { schemaVersion: 1 }, randomUUID());
  expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ error: { code: "SESSION_LIMIT", retryable: false, message: expect.stringContaining("新建题目") } });
});

it("keeps continued replies and corrections within the selected question across reloads", async () => {
  const user = await fixture(); const first = await queue(user);
  const result = SolveOutcomeSchema.parse({ schemaVersion: 1, status: "completed", verified: true, warning: null, verification: { schemaVersion: 1, verdict: "pass", checked: ["transcription"], issues: [] }, candidate: { schemaVersion: 1, kind: "answer", problem: { text: "两道自编题", subject: "math", uncertainties: [] }, answer: "两题已解答", steps: [{ id: "q1", title: "甲题", explanation: "甲条件" }, { id: "q2", title: "乙题", explanation: "乙条件" }], questions: [{ number: 1, answer: "甲结论", stepIds: ["q1"], figureIds: [] }, { number: 2, answer: "乙结论", stepIds: ["q2"], figureIds: [] }], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } });
  await processNext(repository, storage, async () => result, randomUUID(), new AbortController().signal);
  await expect(repository.createRun(user.id, user.sessionId, randomUUID(), { schemaVersion: 1, context: { kind: "reply", sourceRunId: first.id } })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  const execute = await demoExecutor();
  await repository.createRun(user.id, user.sessionId, randomUUID(), { schemaVersion: 1, context: { kind: "correction", sourceRunId: first.id, number: 1, text: "甲题私有更正标记" } });
  await processNext(repository, storage, execute, randomUUID(), new AbortController().signal);
  const q2 = await repository.createRun(user.id, user.sessionId, randomUUID(), { schemaVersion: 1, message: "解释乙题", context: { kind: "question", sourceRunId: first.id, number: 2 } });
  let inspections = 0;
  await processNext(repository, storage, async (input, ...args) => {
    expect(JSON.stringify(input.history)).toContain("乙结论"); expect(JSON.stringify(input.history)).not.toContain("甲结论"); expect(input.problemCorrection).toBeUndefined();
    inspections++; return execute(input, ...args);
  }, randomUUID(), new AbortController().signal);
  const reply = await repository.createRun(user.id, user.sessionId, randomUUID(), { schemaVersion: 1, message: "然后呢？", context: { kind: "reply", sourceRunId: q2.id } });
  await processNext(repository, storage, async (input, ...args) => { expect(input.focus?.content).toContain("第2题"); expect(input.history?.at(-1)?.message).toBe("解释乙题"); expect(input.problemCorrection).toBeUndefined(); inspections++; return execute(input, ...args); }, randomUUID(), new AbortController().signal);
  expect(inspections).toBe(2); expect((await repository.getSession(user.id, user.sessionId)).runs.at(-1)?.context).toEqual({ kind: "reply", sourceRunId: q2.id });
  const other = await fixture(); await expect(repository.createRun(other.id, other.sessionId, randomUUID(), { schemaVersion: 1, context: { kind: "reply", sourceRunId: reply.id } })).rejects.toMatchObject({ code: "NOT_FOUND" });
});
it("persists knowledge followups and rejects invented or foreign concept references", async () => {
  const user = await fixture(); const first = await queue(user);
  const result = SolveOutcomeSchema.parse({ schemaVersion: 1, status: "completed", verified: true, warning: null, verification: { schemaVersion: 1, verdict: "pass", checked: ["transcription", "diagram"], issues: [] }, candidate: { schemaVersion: 1, kind: "answer", problem: { text: "自编供需题", subject: "economics", uncertainties: [], illustrations: [{ id: "original", alt: "供需图", x: .1, y: .1, width: .8, height: .8 }] }, answer: "均衡数量4", steps: [{ id: "a", title: "联立", explanation: "10-Q=2+Q" }], knowledgePoints: ["市场均衡"], knowledgeDetails: [{ name: "市场均衡", explanation: "供给量等于需求量", application: "联立两条曲线" }], citationIds: [], clarificationQuestions: [] } });
  await processNext(repository, storage, async () => result, randomUUID(), new AbortController().signal);
  expect((await repository.getRun(user.id, first.id)).outcome).toEqual(result);
  const context = { kind: "knowledge", sourceRunId: first.id, name: "市场均衡" };
  const input = { schemaVersion: 1, message: "解释使用条件", context };
  const other = await fixture();
  await expect(repository.createRun(other.id, other.sessionId, randomUUID(), input)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(repository.createRun(user.id, user.sessionId, randomUUID(), { ...input, context: { ...context, name: "伪造概念" } })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  const response = await request(`/sessions/${user.sessionId}/runs`, user.cookie, "POST", input, randomUUID());
  expect(response.status).toBe(202); const run = RunViewSchema.parse(await response.json());
  let inspected = false;
  await processNext(repository, storage, async value => { expect(value.focus).toMatchObject({ kind: "knowledge", sourceRunId: first.id, content: expect.stringContaining("联立两条曲线") }); inspected = true; return result; }, randomUUID(), new AbortController().signal);
  expect(inspected).toBe(true); expect((await repository.getSession(user.id, user.sessionId)).runs.at(-1)?.context).toEqual(context);
  expect((await repository.getRun(user.id, run.id)).status).toBe("completed");
});

describe("native bearer API alongside unchanged browser CSRF protection", () => {
  const native = (path: string, token?: string, init: RequestInit = {}) => app.request(`/api/v1${path}`, { ...init, headers: { "x-solveflow-client": "native-v1", ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers } });
  it("runs upload → solve → events → follow-up → cancellation → deletion with native identity", async () => {
    const boot = await native("/native/bootstrap", undefined, { method: "POST" });
    expect(boot.status).toBe(200); expect(boot.headers.get("set-cookie")).toBeNull();
    const user = NativeBootstrapSchema.parse(await boot.json());
    const again = NativeBootstrapSchema.parse(await (await native("/native/bootstrap", user.accessToken, { method: "POST" })).json());
    expect(again.ownerId).toBe(user.ownerId);
    const form = new FormData(); form.set("file", new File([Uint8Array.from(createProbeImage())], "sample.png", { type: "image/png" }));
    const uploadResponse = await native("/uploads", user.accessToken, { method: "POST", body: form }); expect(uploadResponse.status).toBe(201);
    const upload = UploadViewSchema.parse(await uploadResponse.json());
    expect((await native(`/uploads/${upload.id}/image`, user.accessToken)).status).toBe(200);
    const post = (body: unknown, key?: string): RequestInit => ({ method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) } });
    const created = await native("/sessions", user.accessToken, post({ schemaVersion: 1, uploadId: upload.id }));
    const session = z.object({ id: z.uuid() }).parse(await created.json()); const key = randomUUID();
    const run = RunViewSchema.parse(await (await native(`/sessions/${session.id}/runs`, user.accessToken, post({ schemaVersion: 1 }, key))).json());
    const duplicate = RunViewSchema.parse(await (await native(`/sessions/${session.id}/runs`, user.accessToken, post({ schemaVersion: 1 }, key))).json()); expect(duplicate.id).toBe(run.id);
    const resolved = RunViewSchema.parse(await (await native(`/sessions/${session.id}/submissions/${key}`, user.accessToken)).json()); expect(resolved.id).toBe(run.id);
    expect(await (await native(`/sessions/${session.id}/submissions/${randomUUID()}`, user.accessToken)).json()).toBeNull();
    await processNext(repository, storage, await demoExecutor(), randomUUID(), new AbortController().signal);
    const result = RunViewSchema.parse(await (await native(`/runs/${run.id}`, user.accessToken)).json()); expect(result.status).toBe("completed");
    const events = await native(`/runs/${run.id}/events`, user.accessToken); expect(events.status).toBe(200); expect(await events.text()).toContain("answer.final");
    const other = NativeBootstrapSchema.parse(await (await native("/native/bootstrap", undefined, { method: "POST" })).json());
    for (const path of [`/sessions/${session.id}`, `/uploads/${upload.id}/image`, `/runs/${run.id}`, `/runs/${run.id}/events`, `/sessions/${session.id}/submissions/${key}`]) expect((await native(path, other.accessToken)).status).toBe(404);
    expect((await native(`/sessions/${session.id}`, other.accessToken, { method: "DELETE" })).status).toBe(404);
    const follow = RunViewSchema.parse(await (await native(`/sessions/${session.id}/runs`, user.accessToken, post({ schemaVersion: 1, message: "为什么？", context: { kind: "reply", sourceRunId: run.id } }, randomUUID()))).json());
    expect((await native(`/runs/${follow.id}/cancel`, other.accessToken, { method: "POST" })).status).toBe(404);
    expect((await native(`/runs/${follow.id}/cancel`, user.accessToken, { method: "POST" })).status).toBe(200);
    expect((await native(`/sessions/${session.id}`, user.accessToken, { method: "DELETE" })).status).toBe(204);
    expect((await native(`/uploads/${upload.id}/image`, user.accessToken)).status).toBe(404);
  });
  it("rejects browser access to native bootstrap and credential transport substitution", async () => {
    const user = await owner();
    const boot = NativeBootstrapSchema.parse(await (await native("/native/bootstrap", undefined, { method: "POST" })).json());
    for (const origin of [config.origin, "https://evil.test", "null"]) {
      expect((await native("/native/bootstrap", undefined, { method: "POST", headers: { origin } })).status).toBe(403);
      expect((await native("/sessions", boot.accessToken, { headers: { origin } })).status).toBe(403);
    }
    expect((await app.request("/api/v1/native/bootstrap", { method: "POST" })).status).toBe(403);
    expect((await native("/sessions", user.cookie.split("=")[1])).status).toBe(401);
    expect((await request("/sessions", `sf_owner=${boot.accessToken}`)).status).toBe(401);
    expect((await native("/sessions", boot.accessToken, { headers: { cookie: user.cookie } })).status).toBe(403);
    expect((await app.request(`/api/v1/sessions?token=${boot.accessToken}`)).status).toBe(401);
    expect((await native("/native/bootstrap", boot.accessToken + "x", { method: "POST" })).status).toBe(401);
  });
});
