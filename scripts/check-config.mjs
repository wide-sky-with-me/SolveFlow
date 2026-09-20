import { loadConfig, safeSummary, getLiveCallGate, ConfigError } from "../packages/config/dist/index.js";

// Configuration-only command: no provider construction, network request, or key output.
try {
  const config = loadConfig(process.env);
  console.log(JSON.stringify({ config: safeSummary(config), configurationGate: getLiveCallGate(config), liveExecutionImplemented: true, liveValidationRecord: "docs/PI_COMPATIBILITY.md" }, null, 2));
} catch (error) {
  console.error(JSON.stringify(error instanceof ConfigError ? { code: error.code, fields: error.fields } : { code: "CONFIG_CHECK_FAILED" }));
  process.exitCode = 1;
}
