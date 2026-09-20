import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { loadConfig, getLiveCallGate } from "../packages/config/dist/index.js";
import { SpendLedger } from "../packages/agent/dist/policy/spend-ledger.js";

// Administrator action only. A unique authorization ID makes accidental reruns
// fail closed. Never invoke automatically because admission reports SPEND_LIMIT.
try {
  const [flag, authorizationId, ...extra] = process.argv.slice(2);
  if (flag !== "--confirm-new-budget" || !authorizationId || extra.length) throw new Error("EXPLICIT_AUTHORIZATION_REQUIRED");
  loadEnvFile(".env");
  const config = loadConfig(process.env);
  if (!getLiveCallGate(config).allowed) throw new Error("LIVE_CONFIGURATION_REQUIRED");
  if (config.liveBudgetRmb === null) throw new Error("UNLIMITED_BUDGET_DOES_NOT_NEED_RENEWAL");
  const cap = BigInt(Math.floor(config.liveBudgetRmb * 1_000_000));
  const ledger = SpendLedger.open(fileURLToPath(new URL("../.runtime/m0-spend/ledger.jsonl", import.meta.url)), cap);
  try {
    const previous = ledger.snapshot(); ledger.renew(authorizationId);
    console.log(JSON.stringify({ authorizationId, previous, current: ledger.snapshot(), note: "追加新预算窗口；历史预占保留，未核实实际扣费。" }, null, 2));
  } finally { ledger.close(); }
} catch { console.error("BUDGET_RENEWAL_FAILED: explicit unique authorization, valid config and exclusive existing ledger required."); process.exitCode = 1; }
