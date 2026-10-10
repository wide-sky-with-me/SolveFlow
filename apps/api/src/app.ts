import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { Repository } from "@solveflow/db";
import type { AppConfig } from "@solveflow/config";
import { ApiError, ResourceIdSchema, IdempotencyKeySchema, CreateSessionSchema, CreateRunSchema, BootstrapSchema, NativeBootstrapSchema, NATIVE_CLIENT_HEADER, SessionListSchema, apiErrorBody, terminal } from "@solveflow/contracts/http";
import { createIdentity } from "./auth.js";
import { readUpload } from "./images.js";
import type { ImageStore } from "./storage.js";
import { createProbeImage } from "@solveflow/agent/application";
import { boundedBody } from "./bounded-body.js";
import { MAX_RUN_BODY_BYTES } from '@solveflow/contracts/http';

async function jsonBody(request: Request, maxBytes = 16 * 1024): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json") || !request.body) throw new ApiError("INVALID_INPUT");
  try { return JSON.parse((await boundedBody(request, maxBytes)).toString("utf8")); }
  catch (error) { if (error instanceof ApiError) throw error; throw new ApiError("INVALID_INPUT"); }
}
export function createApp(options: { repository: Repository; storage: ImageStore; config: Pick<AppConfig, "origin" | "cookieSecret" | "mode">; canSolve?: () => boolean; spendStatus?: () => "SPEND_LIMIT" | "SERVICE_UNAVAILABLE" | undefined }) {
  const { repository, storage, config } = options;
  const identities = createIdentity(config.cookieSecret);
  const nativeIdentities = createIdentity(config.cookieSecret, "native-v1");
  const app = new Hono<{ Variables: { ownerId: string } }>();
  let uploadsInFlight = 0; let imagesInFlight = 0; let streams = 0;
  const ownerStreams = new Map<string, number>();
  const rates = new Map<string, { count: number; expires: number }>();
  const permit = (key: string, limit: number) => {
    const now = Date.now();
    for (const [id, row] of rates) if (row.expires <= now) rates.delete(id);
    let row = rates.get(key);
    if (!row) { if (rates.size >= 1024) throw new ApiError("RATE_LIMIT"); row = { count: 0, expires: now + 60_000 }; rates.set(key, row); }
    if (++row.count > limit) throw new ApiError("RATE_LIMIT");
  };
  const serviceInfo = () => {
    const allowed = config.mode !== "disabled" && (options.canSolve?.() ?? true);
    const unavailableReason = allowed && config.mode === "live" ? options.spendStatus?.() : undefined;
    return { schemaVersion: 1, mode: config.mode, solvingAvailable: allowed && !unavailableReason, ...(unavailableReason ? { unavailableReason } : {}) };
  };
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store, max-age=0"); c.header("X-Content-Type-Options", "nosniff"); c.header("Referrer-Policy", "no-referrer");
    const origin = c.req.header("origin"); const authorization = c.req.header("authorization");
    const nativeBootstrap = c.req.path === "/api/v1/native/bootstrap" && c.req.method === "POST" && c.req.header("x-solveflow-client") === NATIVE_CLIENT_HEADER;
    if (authorization !== undefined) {
      if (origin !== undefined || getCookie(c, "sf_owner")) throw new ApiError("FORBIDDEN");
      const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(authorization);
      if (!match) throw new ApiError("UNAUTHORIZED");
      c.set("ownerId", nativeIdentities.verify(match[1]));
    } else if (!["GET", "HEAD"].includes(c.req.method) && !(nativeBootstrap && origin === undefined) && origin !== config.origin) throw new ApiError("FORBIDDEN");
    await next();
  });
  app.get("/api/v1/health", c => c.json(serviceInfo()));
  app.post("/api/v1/bootstrap", async c => {
    if (c.req.header("authorization")) throw new ApiError("FORBIDDEN");
    permit("bootstrap", 60);
    const existing = getCookie(c, "sf_owner");
    let id: string;
    if (existing) id = identities.verify(existing);
    else {
      const issued = identities.issue(); id = issued.id;
      setCookie(c, "sf_owner", issued.cookie, { httpOnly: true, secure: config.origin.startsWith("https:"), sameSite: "Strict", path: "/", maxAge: 30 * 86400 });
    }
    await repository.ensureOwner(id);
    return c.json(BootstrapSchema.parse({ ...serviceInfo(), ownerId: id }));
  });
  app.post("/api/v1/native/bootstrap", async c => {
    if (c.req.header("origin") !== undefined || getCookie(c, "sf_owner") || c.req.header("x-solveflow-client") !== NATIVE_CLIENT_HEADER) throw new ApiError("FORBIDDEN");
    permit("bootstrap", 60);
    const authorization = c.req.header("authorization");
    const issued = authorization ? { id: c.get("ownerId"), cookie: authorization.slice(7) } : nativeIdentities.issue();
    await repository.ensureOwner(issued.id);
    return c.json(NativeBootstrapSchema.parse({ ...serviceInfo(), ownerId: issued.id, accessToken: issued.cookie }));
  });
  app.use("/api/v1/*", async (c, next) => {
    const owner = c.req.header("authorization") ? c.get("ownerId") : identities.verify(getCookie(c, "sf_owner")); c.set("ownerId", owner);
    if (c.req.method !== "GET") permit(`write:${owner}`, 40);
    await next();
  });
  app.get("/api/v1/demo-image", c => { if (config.mode !== "demo") throw new ApiError("NOT_FOUND"); return new Response(Uint8Array.from(createProbeImage()), { headers: { "content-type": "image/png", "cache-control": "no-store" } }); });
  app.post("/api/v1/uploads", async c => {
    const owner = c.get("ownerId"); permit(`upload:${owner}`, 10);
    if (uploadsInFlight >= 2) throw new ApiError("RATE_LIMIT");
    uploadsInFlight++;
    try {
      const normalized = await readUpload(c.req.raw); const id = randomUUID(); const objectKey = `${owner}/${id}.jpg`;
      await storage.put(objectKey, normalized.data, c.req.raw.signal);
      try { return c.json(await repository.addUpload(owner, { id, objectKey, bytes: normalized.bytes, width: normalized.width, height: normalized.height, hash: normalized.hash }), 201); }
      catch (error) { await storage.remove(objectKey, AbortSignal.timeout(5000)); throw error; }
    } finally { uploadsInFlight--; }
  });
  app.get("/api/v1/uploads/:id/image", async c => {
    permit(`image:${c.get("ownerId")}`, 60);
    if (imagesInFlight >= 4) throw new ApiError("RATE_LIMIT");
    imagesInFlight++;
    try {
    const upload = await repository.getUpload(c.get("ownerId"), ResourceIdSchema.parse(c.req.param("id")));
    const bytes = await storage.get(upload.objectKey, c.req.raw.signal);
    // Recheck after I/O: concurrent deletion must not reveal a newly stale object.
    await repository.getUpload(c.get("ownerId"), upload.id);
    return new Response(Uint8Array.from(bytes), { headers: { "content-type": "image/jpeg", "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-disposition": 'inline; filename="problem.jpg"' } });
    } finally { imagesInFlight--; }
  });
  app.delete("/api/v1/uploads/:id", async c => { await repository.deleteUpload(c.get("ownerId"), ResourceIdSchema.parse(c.req.param("id"))); return c.body(null, 204); });
  app.post("/api/v1/sessions", async c => c.json(await repository.createSession(c.get("ownerId"), CreateSessionSchema.parse(await jsonBody(c.req.raw))), 201));
  app.get("/api/v1/sessions", async c => c.json(SessionListSchema.parse(await repository.listSessions(c.get("ownerId")))));
  app.get("/api/v1/sessions/:id", async c => c.json(await repository.getSession(c.get("ownerId"), ResourceIdSchema.parse(c.req.param("id")))));
  app.delete("/api/v1/sessions/:id", async c => { await repository.deleteSession(c.get("ownerId"), ResourceIdSchema.parse(c.req.param("id"))); return c.body(null, 204); });
  app.post("/api/v1/sessions/:id/runs", async c => {
    const input = CreateRunSchema.parse(await jsonBody(c.req.raw, MAX_RUN_BODY_BYTES));
    const run = await repository.createRun(c.get("ownerId"), ResourceIdSchema.parse(c.req.param("id")), IdempotencyKeySchema.parse(c.req.header("idempotency-key")), input, () => {
      const info = serviceInfo(); if (info.unavailableReason) throw new ApiError(info.unavailableReason);
      return info.solvingAvailable;
    });
    return c.json(run, 202);
  });
  app.get("/api/v1/sessions/:id/submissions/:key", async c => c.json(await repository.findSubmission(c.get("ownerId"), ResourceIdSchema.parse(c.req.param("id")), IdempotencyKeySchema.parse(c.req.param("key")))));
  app.get("/api/v1/runs/:id", async c => c.json(await repository.getRun(c.get("ownerId"), ResourceIdSchema.parse(c.req.param("id")))));
  app.post("/api/v1/runs/:id/cancel", async c => c.json(await repository.cancel(c.get("ownerId"), ResourceIdSchema.parse(c.req.param("id")))));
  app.get("/api/v1/runs/:id/events", async c => {
    const owner = c.get("ownerId"); const id = ResourceIdSchema.parse(c.req.param("id"));
    let cursor = z.coerce.number().int().min(0).max(128).parse(c.req.header("last-event-id") ?? c.req.query("after") ?? "0");
    let batch = await repository.events(owner, id, cursor);
    if (streams >= 32 || (ownerStreams.get(owner) ?? 0) >= 3) throw new ApiError("RATE_LIMIT");
    streams++; ownerStreams.set(owner, (ownerStreams.get(owner) ?? 0) + 1);
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async stream => {
      const started = Date.now(); let alive = true; let heartbeat = Date.now();
      stream.onAbort(() => { alive = false; });
      try {
        while (alive && Date.now() - started < 125_000) {
          for (const event of batch.events) { if (!alive) break; await stream.writeSSE({ id: String(event.seq), event: event.type, data: JSON.stringify(event) }); cursor = event.seq; }
          if (terminal(batch.run.status)) break;
          if (Date.now() - heartbeat >= 15_000) { await stream.write(": heartbeat\n\n"); heartbeat = Date.now(); }
          await stream.sleep(300);
          if (!alive) break;
          batch = await repository.events(owner, id, cursor);
        }
      } catch { /* End transport; client recovers via authorized snapshot. Never invent a terminal event. */ }
      finally { streams--; const count = (ownerStreams.get(owner) ?? 1) - 1; if (count) ownerStreams.set(owner, count); else ownerStreams.delete(owner); }
    });
  });
  app.notFound(c => c.json(apiErrorBody("NOT_FOUND", randomUUID()), 404));
  app.onError((error, c) => {
    const safe = error instanceof ApiError ? error : error instanceof z.ZodError ? new ApiError("INVALID_INPUT") : new ApiError("INTERNAL_ERROR");
    return c.json(apiErrorBody(safe.code, randomUUID()), safe.status);
  });
  return app;
}
