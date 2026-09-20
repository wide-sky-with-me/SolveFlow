import { readFile, writeFile, rename, chmod } from "node:fs/promises";
import { parseEnv } from "node:util";
import { legacyModelVariables } from "../packages/config/dist/index.js";
const file = new URL("../.env", import.meta.url);
let content = await readFile(file, "utf8"); const original = parseEnv(content);
for (const [old, current] of Object.entries(legacyModelVariables)) {
  if (original[old] && original[current] && original[old] !== original[current]) throw new Error("CONFIG_ALIAS_CONFLICT");
  const lines = content.split("\n");
  content = lines.map(line => {
    if (!new RegExp(`^(?:export\\s+)?${old}=`).test(line)) return line;
    if (original[current]) return "";
    return line.replace(old, current);
  }).join("\n");
}
content = content.replace("# SolveFlow M0 server-only configuration. Copy locally; never commit .env.", "# SolveFlow server-only configuration. Copy locally; never commit .env.")
  .replace("# Fixed DMXAPI endpoint and selected models. No automatic fallback.", "# Provider endpoint and model references are selected here. No automatic fallback.")
  .replace("# REQUIRED before live execution: actual DMXAPI RMB per MILLION tokens.", "# REQUIRED before live execution: reviewed provider RMB per MILLION tokens.")
  .replace("# Do not copy DeepSeek direct-API/USD prices or invent numbers.", "# Convert the actual provider price to RMB; never invent prices.");
if (!original.SOLVEFLOW_LLM_PROVIDER && original.SOLVEFLOW_DMX_BASE_URL) content += `\nSOLVEFLOW_LLM_PROVIDER=${new URL(original.SOLVEFLOW_DMX_BASE_URL).hostname}\n`;
const next = parseEnv(content);
for (const role of ["SOLVER", "VERIFIER"]) if (next[`SOLVEFLOW_${role}_MODEL`] !== original[`SOLVEFLOW_${role}_MODEL`]) throw new Error("MODEL_CHANGED_DURING_MIGRATION");
for (const [old, current] of Object.entries(legacyModelVariables)) if (original[old] && next[current] !== original[old]) throw new Error("CONFIG_VALUE_CHANGED_DURING_MIGRATION");
const temporary = new URL("../.env.model-migration.tmp", import.meta.url);
await writeFile(temporary, content, { mode: 0o600, flag: "wx" }); await rename(temporary, file); await chmod(file, 0o600);
console.log("Model configuration names migrated. Existing models, endpoint, credentials, budget and app values preserved.");
