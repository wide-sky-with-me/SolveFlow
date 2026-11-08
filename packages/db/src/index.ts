import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";
export { Repository } from "./repository.js";
export { migrate } from "./migrate.js";
export function connectDatabase(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 8, connectionTimeoutMillis: 3000, idleTimeoutMillis: 10_000, statement_timeout: 5000, query_timeout: 6000 });
  pool.on("error", () => { /* Active queries reject; never log database credentials. */ });
  return { pool, db: drizzle(pool, { schema }), close: () => pool.end() };
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
