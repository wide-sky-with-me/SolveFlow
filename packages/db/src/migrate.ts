import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type pg from "pg";
/** Explicit startup/admin command, never reset/drop. Hash changes fail closed. */
export async function migrate(pool: pg.Pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(5839201001)");
    await client.query("CREATE TABLE IF NOT EXISTS solveflow_migrations (version integer PRIMARY KEY, hash text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    for (const [version, file] of [[1, "0001_initial.sql"], [2, "0002_run_context.sql"], [3, "0003_managed_exams.sql"], [4, "0004_exam_reviews.sql"], [5, "0005_exam_navigation.sql"], [6, "0006_exam_resolutions.sql"], [7, "0007_exam_timing.sql"], [8, "0008_exam_model_services.sql"], [9, "0009_exam_answer_drafts.sql"], [10, "0010_exam_teacher_messages.sql"], [11, "0011_exam_events.sql"]] as const) {
      const content = await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8");
      const hash = createHash("sha256").update(content).digest("hex");
      const result = await client.query<{ hash: string }>("SELECT hash FROM solveflow_migrations WHERE version=$1", [version]);
      if (result.rows[0] && result.rows[0].hash !== hash) throw new Error("MIGRATION_HASH_MISMATCH");
      if (!result.rows[0]) { await client.query(content); await client.query("INSERT INTO solveflow_migrations(version,hash) VALUES($1,$2)", [version, hash]); }
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
