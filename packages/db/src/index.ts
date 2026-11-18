import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";
export { Repository } from "./repository.js";
export { migrate } from "./migrate.js";
export function connectDatabase(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 8, connectionTimeoutMillis: 3000, idleTimeoutMillis: 10_000, statement_timeout: 5000, query_timeout: 6000 });
  pool.on("error", () => { /* Active queries reject; never log database credentials. */ });
  const listeners = new Set<() => Promise<void>>();
  const listen = (channels: readonly string[], onNotify: (channel: string, payload: string) => void, signal: AbortSignal) => {
    for (const ch of channels) if (!/^[a-z_][a-z0-9_]{0,62}$/.test(ch)) throw new Error("INVALID_NOTIFY_CHANNEL");
    let stopped = signal.aborted;
    let active: pg.Client | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let wakeRetry: (() => void) | undefined;
    const stop = async () => {
      stopped = true;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = undefined; }
      wakeRetry?.();
      const current = active;
      active = undefined;
      if (current) await current.end().catch(() => {});
    };
    listeners.add(stop);
    const onAbort = () => { void stop().finally(() => listeners.delete(stop)); };
    signal.addEventListener("abort", onAbort, { once: true });
    let retries = 0;
    const loop = async () => {
      while (!stopped) {
        const client = new pg.Client({ connectionString, connectionTimeoutMillis: 3000, keepAlive: true });
        let disconnected: (() => void) | undefined;
        const waitDisconnect = new Promise<void>(resolve => { disconnected = resolve; });
        client.on("error", () => { disconnected?.(); });
        client.on("end", () => { disconnected?.(); });
        client.on("notification", msg => { if (!stopped) onNotify(msg.channel, msg.payload ?? ""); });
        try {
          await client.connect();
          if (stopped) { await client.end().catch(() => {}); break; }
          active = client;
          for (const ch of channels) await client.query("LISTEN " + ch);
          retries = 0;
          await waitDisconnect;
        } catch {
          /* Reconnect with bounded backoff while fallback polling covers any gap. */
        } finally {
          if (active === client) active = undefined;
          await client.end().catch(() => {});
        }
        if (stopped) break;
        const waitMs = Math.min(5000, 200 * 2 ** Math.min(retries++, 5));
        await new Promise<void>(resolve => {
          wakeRetry = () => { wakeRetry = undefined; if (retryTimer) { clearTimeout(retryTimer); retryTimer = undefined; } resolve(); };
          retryTimer = setTimeout(() => { retryTimer = undefined; wakeRetry = undefined; resolve(); }, waitMs);
        });
      }
    };
    if (!stopped) void loop();
    return () => { signal.removeEventListener("abort", onAbort); listeners.delete(stop); return stop(); };
  };
  return {
    pool,
    db: drizzle(pool, { schema }),
    listen,
    close: async () => {
      await Promise.all([...listeners].map(stop => stop()));
      listeners.clear();
      await pool.end();
    },
  };
}
export type Database = ReturnType<typeof connectDatabase>["db"];

export * from './exam-store.js';
export * from './exam-catalog.js';
export * from './exam-attempts.js';
export * from './exam-jobs.js';

export * from './exam-reviews.js';
export * from './exam-navigation.js';
export * from './exam-attention.js';
export * from './exam-dashboard.js';

export * from './exam-lists.js';
export * from './exam-timing.js';
export * from './exam-allocations.js';
export * from './exam-model-services.js';
export * from './exam-messages.js';
export * from './exam-events.js';
