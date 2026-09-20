import { loadEnvFile } from "node:process";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
loadEnvFile(".env");
if (!process.argv.includes("--production")) await import("./prepare-mobile-assets.mjs");
const env = { ...process.env, ...(process.argv.includes("--demo") ? { SOLVEFLOW_APP_MODE: "demo" } : {}) };
const webDirectory = fileURLToPath(new URL("../apps/mobile/", import.meta.url));
const expoCli = createRequire(new URL("../apps/mobile/package.json", import.meta.url)).resolve("expo/bin/cli");
const commands = [
  { args: ["apps/api/dist/server.js"], cwd: process.cwd() },
  { args: ["apps/api/dist/server.js", "--worker"], cwd: process.cwd() },
  process.argv.includes("--production") ? { args: ["scripts/web-server.mjs"], cwd: process.cwd() } : { args: [expoCli, "start", "--web", "--localhost", "--port", "3100"], cwd: webDirectory },
];
console.log(`SolveFlow supervisor PID ${process.pid}; Web http://127.0.0.1:3100 (${env.SOLVEFLOW_APP_MODE}).`);
const children = []; let stopping = false;
function stop(code = 0) {
  if (stopping) return; stopping = true; process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
  const timer = setTimeout(() => { for (const child of children) if (child.exitCode === null) child.kill("SIGKILL"); }, 5000); timer.unref();
}
process.once("SIGINT", () => stop()); process.once("SIGTERM", () => stop());
for (const { args, cwd } of commands) {
  const child = spawn(process.execPath, args, { env, cwd, stdio: "inherit" }); children.push(child);
  child.once("error", () => stop(1)); child.once("exit", code => { if (!stopping) stop(code ?? 1); });
}
