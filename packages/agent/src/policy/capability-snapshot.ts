import { createHash } from "node:crypto";
import type { ToolCategory } from "./run-budget.js";

export interface RunIdentity { readonly ownerId: string; readonly runId: string }
export interface Capability {
  readonly name: string;
  readonly source: string;
  readonly schema: unknown;
  readonly category: ToolCategory;
}
export interface RegisteredCapability { readonly name: string; readonly source: string; readonly schema: unknown }

/** Hash the JSON-visible schema (TypeBox symbol annotations are not wire schema). */
export function schemaHash(schema: unknown): string {
  let nodes = 0;
  const seen = new Set<object>();
  const encode = (value: unknown, depth: number): string => {
    if (++nodes > 2048 || depth > 16) throw new Error("SCHEMA_LIMIT");
    if (value === null || typeof value === "boolean") return JSON.stringify(value);
    if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
    if (typeof value === "string" && value.length <= 8192) return JSON.stringify(value);
    if (typeof value !== "object" || value === null || seen.has(value)) throw new Error("INVALID_SCHEMA");
    seen.add(value);
    try {
      if (Array.isArray(value)) return `[${value.map(item => encode(item, depth + 1)).join(",")}]`;
      if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error("INVALID_SCHEMA");
      return `{${Object.keys(value).sort().map(key => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !("value" in descriptor)) throw new Error("INVALID_SCHEMA");
        return `${JSON.stringify(key)}:${encode(descriptor.value, depth + 1)}`;
      }).join(",")}}`;
    } finally { seen.delete(value); }
  };
  const canonical = encode(schema, 0);
  if (Buffer.byteLength(canonical) > 32 * 1024) throw new Error("SCHEMA_LIMIT");
  return createHash("sha256").update(canonical).digest("hex");
}

/** Fixed per-run approval; changes require a new snapshot. Revocation is immediate. */
export class CapabilitySnapshot {
  private readonly entries = new Map<string, { source: string; hash: string; category: ToolCategory; cancellation: AbortController }>();
  private readonly identity: RunIdentity;

  constructor(identity: RunIdentity, approved: readonly Capability[]) {
    if (!identity.ownerId || !identity.runId || approved.length > 32) throw new Error("INVALID_CAPABILITIES");
    this.identity = Object.freeze({ ...identity });
    for (const entry of approved) {
      if (!/^[a-z][a-z0-9_]{0,63}$/.test(entry.name) || !entry.source || this.entries.has(entry.name)
        || !["file", "business", "search"].includes(entry.category)) throw new Error("INVALID_CAPABILITIES");
      this.entries.set(entry.name, { source: entry.source, hash: schemaHash(entry.schema), category: entry.category, cancellation: new AbortController() });
    }
  }

  assertIdentity(identity: RunIdentity): void {
    if (identity.ownerId !== this.identity.ownerId || identity.runId !== this.identity.runId) throw new Error("CAPABILITY_DENIED");
  }

  names(): string[] { return [...this.entries.keys()]; }

  assertRegistered(actual: readonly RegisteredCapability[]): void {
    if (actual.length !== this.entries.size || new Set(actual.map(tool => tool.name)).size !== actual.length) throw new Error("CAPABILITY_MISMATCH");
    for (const tool of actual) {
      const approved = this.entries.get(tool.name);
      if (!approved || approved.source !== tool.source || approved.hash !== schemaHash(tool.schema)) throw new Error("CAPABILITY_MISMATCH");
    }
  }

  authorize(name: string, identity: RunIdentity, signal: AbortSignal): { category: ToolCategory; signal: AbortSignal } {
    signal.throwIfAborted();
    if (identity.ownerId !== this.identity.ownerId || identity.runId !== this.identity.runId) throw new Error("CAPABILITY_DENIED");
    const entry = this.entries.get(name);
    if (!entry || entry.cancellation.signal.aborted) throw new Error("CAPABILITY_DENIED");
    return { category: entry.category, signal: AbortSignal.any([signal, entry.cancellation.signal]) };
  }

  revoke(name: string): void {
    const entry = this.entries.get(name);
    if (!entry) throw new Error("CAPABILITY_DENIED");
    entry.cancellation.abort(new Error("CAPABILITY_REVOKED"));
  }
}
