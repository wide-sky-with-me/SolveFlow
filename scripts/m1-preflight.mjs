import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { loadConfig, getLiveCallGate, loadAppConfig } from "../packages/config/dist/index.js";
import { SpendLedger } from "../packages/agent/dist/policy/spend-ledger.js";
import { quoteModelRequest } from "../packages/agent/dist/policy/model-spend.js";

// Read/check only. Opens the existing single-writer journal, never initializes it.
try {
  loadEnvFile(".env");
  const config = loadConfig(process.env); const app = loadAppConfig(process.env);
  const gate = getLiveCallGate(config);
  if (!gate.allowed || !config.models.solver || !config.models.verifier) {
    console.log(JSON.stringify({ ready: false, reasons: gate.reasons })); process.exitCode = 1;
  } else if (config.liveBudgetRmb === null) {
    console.log(JSON.stringify({ ready: true, mode: app.mode, budgetMode: "unlimited", budgetRmb: null, solverModel: config.solverModel, verifierModel: config.verifierModel,
      note: "本地累计费用限制关闭；保留模型/工具次数和超时。历史账本未修改，不代表供应商账户余额。", reasons: [] }, null, 2));
  } else {
    const ledger = SpendLedger.open(fileURLToPath(new URL("../.runtime/m0-spend/ledger.jsonl", import.meta.url)), BigInt(Math.floor(config.liveBudgetRmb * 1_000_000)));
    try {
      const snapshot = ledger.snapshot();
      const solver = quoteModelRequest(config.models.solver); const verifier = quoteModelRequest(config.models.verifier);
      const funded = BigInt(snapshot.remainingMicros) >= solver + verifier;
      console.log(JSON.stringify({ ready: funded, mode: app.mode, solverModel: config.solverModel, verifierModel: config.verifierModel,
        ledger: snapshot, quoteMicros: { solver: solver.toString(), verifier: verifier.toString(), minimumRun: (solver + verifier).toString() },
        note: "预占不等于实际扣费；工具、修正和追问会增加请求，逐次预占，不自动重试。", reasons: funded ? [] : ["SPEND_LIMIT"] }, null, 2));
      if (!funded) process.exitCode = 1;
    } finally { ledger.close(); }
  }
} catch { console.error("M1_PREFLIGHT_FAILED: check configuration or existing ledger availability; no model was called."); process.exitCode = 1; }
