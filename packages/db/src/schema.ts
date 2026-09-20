import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, integer, jsonb, uniqueIndex, index, primaryKey } from "drizzle-orm/pg-core";
import type { SolveOutcome } from "@solveflow/contracts/agent";
import type { RunEvent, RunContext } from "@solveflow/contracts/http";
const date = (name: string) => timestamp(name, { withTimezone: true, mode: "date" }).notNull().defaultNow();
export const owners = pgTable("owners", { id: uuid("id").primaryKey(), createdAt: date("created_at") });
export const uploads = pgTable("uploads", {
  id: uuid("id").primaryKey(), ownerId: uuid("owner_id").notNull().references(() => owners.id), objectKey: text("object_key").notNull().unique(),
  mimeType: text("mime_type").notNull(), bytes: integer("bytes").notNull(), width: integer("width").notNull(), height: integer("height").notNull(), hash: text("hash").notNull(),
  state: text("state").notNull().default("ready"), createdAt: date("created_at"), expiresAt: date("expires_at"), deleteAttempts: integer("delete_attempts").notNull().default(0),
}, t => [index("uploads_owner_idx").on(t.ownerId), index("uploads_expiry_idx").on(t.expiresAt)]);
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey(), ownerId: uuid("owner_id").notNull().references(() => owners.id), uploadId: uuid("upload_id").notNull().references(() => uploads.id),
  subject: text("subject").notNull(), createdAt: date("created_at"), deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
}, t => [uniqueIndex("sessions_upload_unique").on(t.uploadId), index("sessions_owner_idx").on(t.ownerId)]);
export const runs = pgTable("runs", {
  id: uuid("id").primaryKey(), ownerId: uuid("owner_id").notNull().references(() => owners.id), sessionId: uuid("session_id").notNull().references(() => sessions.id),
  status: text("status").notNull().default("queued"), message: text("message").notNull(), idempotencyKey: text("idempotency_key").notNull(), inputHash: text("input_hash").notNull(),
  createdAt: date("created_at"), seq: integer("seq").notNull().default(0), leaseOwner: uuid("lease_owner"), leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true, mode: "date" }),
  context: jsonb("context").$type<RunContext>(),
  outcome: jsonb("outcome").$type<SolveOutcome>(), schemaVersion: integer("schema_version").notNull().default(1),
}, t => [uniqueIndex("runs_idempotency_unique").on(t.ownerId, t.sessionId, t.idempotencyKey),
  uniqueIndex("runs_active_session_unique").on(t.sessionId).where(sql`${t.status} not in ('completed','needs_clarification','failed','cancelled')`), index("runs_queue_idx").on(t.status, t.createdAt)]);
export const runEvents = pgTable("run_events", { runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }), seq: integer("seq").notNull(), payload: jsonb("payload").$type<RunEvent>().notNull(), createdAt: date("created_at") }, t => [primaryKey({ columns: [t.runId, t.seq] })]);
