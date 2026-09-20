import { Server } from "node:http";
import { serve } from "@hono/node-server";
import { loadAppConfig, loadConfig, getLiveCallGate } from "@solveflow/config";
import { connectDatabase, Repository } from "@solveflow/db";
import { createApp } from "./app.js";
import { S3ImageStore } from "./storage.js";
import { demoExecutor, liveExecutor, workerLoop } from "./worker.js";
import { applicationSpendStatus } from "@solveflow/agent/application";

const config = loadAppConfig(process.env);
const database = connectDatabase(config.databaseUrl);
const storage = new S3ImageStore(config.storage);
const controller = new AbortController();
const stop = () => controller.abort(); process.once("SIGINT", stop); process.once("SIGTERM", stop);
try {
  const migration = await database.pool.query("SELECT 1 FROM solveflow_migrations WHERE version=2");
  if (migration.rowCount !== 1) throw new Error("DATABASE_MIGRATION_REQUIRED");
  await storage.ensurePrivateBucket();
  const repository = new Repository(database.db);
  const model = loadConfig(config.mode === "live" ? process.env : {});
  if (process.argv.includes("--worker")) {
    console.log(`SolveFlow worker ready (${config.mode}).`);
    await workerLoop(repository, storage, config.mode === "demo" ? await demoExecutor() : liveExecutor(model), controller.signal);
  } else {
    const app = createApp({ repository, storage, config, canSolve: () => config.mode === "demo" || getLiveCallGate(model).allowed,
      spendStatus: () => model.models.solver && model.models.verifier ? applicationSpendStatus({ solver: model.models.solver, verifier: model.models.verifier }, model.liveBudgetRmb) : "SERVICE_UNAVAILABLE" });
    const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: config.apiPort }, () => console.log(`SolveFlow API: http://127.0.0.1:${config.apiPort} (${config.mode})`));
    if (!(server instanceof Server)) throw new Error("HTTP_SERVER_REQUIRED");
    server.requestTimeout = 15_000; server.headersTimeout = 10_000;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      const close = () => { server.closeAllConnections(); server.close(error => error ? reject(error) : resolve()); };
      controller.signal.addEventListener("abort", close, { once: true });
      if (controller.signal.aborted) close();
    });
  }
} catch { console.error("APP_START_OR_RUNTIME_FAILED: check local configuration, migration and infrastructure."); process.exitCode = 1; }
finally { storage.close(); await database.close(); process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
