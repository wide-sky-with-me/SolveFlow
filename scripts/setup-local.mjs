import { readFile, writeFile, chmod, rename } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { parseEnv } from "node:util";
const file = new URL("../.env", import.meta.url);
let content;
try { content = await readFile(file, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; content = await readFile(new URL("../.env.example", import.meta.url), "utf8"); }
const existing = parseEnv(content);
const secret = () => randomBytes(32).toString("hex");
const password = existing.SOLVEFLOW_APP_DB_PASSWORD || secret();
const values = { SOLVEFLOW_APP_DB_PASSWORD: password,
  SOLVEFLOW_APP_DATABASE_URL: `postgresql://solveflow:${encodeURIComponent(password)}@127.0.0.1:54329/solveflow`,
  SOLVEFLOW_APP_S3_ENDPOINT: "http://127.0.0.1:19000", SOLVEFLOW_APP_S3_REGION: "us-east-1", SOLVEFLOW_APP_S3_BUCKET: "solveflow-private",
  SOLVEFLOW_APP_S3_ACCESS_KEY: "solveflow-local", SOLVEFLOW_APP_S3_SECRET_KEY: secret(), SOLVEFLOW_APP_COOKIE_SECRET: secret(),
  SOLVEFLOW_APP_ORIGIN: "http://127.0.0.1:3100", SOLVEFLOW_APP_API_PORT: "3101", SOLVEFLOW_APP_MODE: "disabled" };
for (const [key, value] of Object.entries(values)) {
  if (existing[key]) continue;
  const line = `${key}=${value}`;
  if (new RegExp(`^${key}=.*$`, "m").test(content)) content = content.replace(new RegExp(`^${key}=.*$`, "m"), line);
  else content += `\n${line}\n`;
}
const temporary = new URL("../.env.setup.tmp", import.meta.url);
await writeFile(temporary, content, { mode: 0o600, flag: "wx" });
await rename(temporary, file); await chmod(file, 0o600);
console.log("Local app configuration prepared. Existing values and model/spend settings preserved; secrets not printed.");
