import { loadAppConfig } from "../packages/config/dist/index.js";
import { connectDatabase, migrate } from "../packages/db/dist/index.js";
const config = loadAppConfig(process.env);
const target = new URL(config.databaseUrl);
if (target.hostname !== "127.0.0.1" || target.port !== "54329" || target.pathname !== "/solveflow") throw new Error("MIGRATION_TARGET_NOT_LOCAL_SOLVEFLOW");
const database = connectDatabase(config.databaseUrl);
try { await migrate(database.pool); console.log("Migration applied: local SolveFlow PostgreSQL, versions 1–2."); }
finally { await database.close(); }
