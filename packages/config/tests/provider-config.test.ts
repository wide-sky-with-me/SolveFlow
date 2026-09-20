import { expect, it } from "vitest";
import { loadConfig, getLiveCallGate, safeSummary, getModelConnections } from "../src/index.js";
import { genericEnvironment } from "./config.test-support.js";
it("takes arbitrary model references, endpoint and provider from environment", () => {
  const config = loadConfig(genericEnvironment());
  expect(getLiveCallGate(config).allowed).toBe(true);
  expect(safeSummary(config)).toMatchObject({ models: { solver: { model: "vendor/solver:release", provider: "custom-gateway", baseURL: "https://gateway.example/custom/v1" }, verifier: { model: "another/verifier-v2" } } });
});
it("refuses conflicting legacy and neutral endpoint configuration", () => {
  expect(() => loadConfig({ ...genericEnvironment(), SOLVEFLOW_DMX_BASE_URL: "https://other.example/v1" })).toThrow("CONFIG_INVALID");
});
it("does not forward a shared key to a role overriding the provider endpoint", () => {
  const config = loadConfig({ ...genericEnvironment(), SOLVEFLOW_VERIFIER_BASE_URL: "https://second.example/v1" });
  expect(getLiveCallGate(config)).toMatchObject({ allowed: false, reasons: expect.arrayContaining(["MISSING_LLM_API_KEY"]) });
});
it("supports independent providers, keys and request token fields", () => {
  const config = loadConfig({ ...genericEnvironment(), SOLVEFLOW_VERIFIER_PROVIDER: "second-provider", SOLVEFLOW_VERIFIER_BASE_URL: "https://second.example/v1/", SOLVEFLOW_VERIFIER_API_KEY: "verifier-private", SOLVEFLOW_VERIFIER_MAX_TOKENS: "2048", SOLVEFLOW_VERIFIER_COMPAT: '{"maxTokensField":"max_completion_tokens"}' });
  const connections = getModelConnections(config);
  expect(connections.solver.apiKey).toBe("synthetic-key"); expect(connections.verifier.apiKey).toBe("verifier-private");
  expect(connections.verifier.route).toMatchObject({ provider: "second-provider", baseURL: "https://second.example/v1", requestMaxTokens: 2048, compat: { maxTokensField: "max_completion_tokens" } });
  expect(JSON.stringify(safeSummary(config))).not.toContain("verifier-private");
});
it("accepts legacy variable aliases without forcing a provider or model", () => {
  const { SOLVEFLOW_LLM_BASE_URL, SOLVEFLOW_LLM_API_KEY, SOLVEFLOW_LLM_HARD_QUOTA_CONFIRMED, SOLVEFLOW_LLM_HARD_QUOTA_RMB, ...rest } = genericEnvironment();
  const config = loadConfig({ ...rest, SOLVEFLOW_DMX_BASE_URL: SOLVEFLOW_LLM_BASE_URL, SOLVEFLOW_DMX_API_KEY: SOLVEFLOW_LLM_API_KEY, SOLVEFLOW_DMX_HARD_QUOTA_CONFIRMED: SOLVEFLOW_LLM_HARD_QUOTA_CONFIRMED, SOLVEFLOW_DMX_HARD_QUOTA_RMB: SOLVEFLOW_LLM_HARD_QUOTA_RMB });
  expect(getLiveCallGate(config).allowed).toBe(true); expect(config.legacyVariables).toHaveLength(4);
  expect(getModelConnections(config).solver.route.model).toBe("vendor/solver:release");
});
it.each([
  { SOLVEFLOW_LLM_API: "anthropic-messages" }, { SOLVEFLOW_LLM_BASE_URL: "file:///tmp/model" },
  { SOLVEFLOW_LLM_BASE_URL: "https://gateway.example/v1?key=private" }, { SOLVEFLOW_LLM_BASE_URL: "https://gateway.example/#private" },
  { SOLVEFLOW_SOLVER_MAX_TOKENS: "9000" }, { SOLVEFLOW_SOLVER_CONTEXT_WINDOW: "0" },
  { SOLVEFLOW_LLM_COMPAT: '{"apiKey":"injected"}' }, { SOLVEFLOW_LLM_COMPAT: "not-json" },
])("rejects unsupported protocol or invalid capability metadata before dispatch: %j", invalid => {
  expect(() => loadConfig({ ...genericEnvironment(), ...invalid })).toThrow("CONFIG_INVALID");
});
it("does not inherit the solver model and does not claim absent capabilities", () => {
  expect(getLiveCallGate(loadConfig({ ...genericEnvironment(), SOLVEFLOW_VERIFIER_MODEL: "" })).reasons).toContain("MODEL_CONFIG_MISSING");
  expect(getLiveCallGate(loadConfig({ ...genericEnvironment(), SOLVEFLOW_LLM_SUPPORTS_IMAGES: "false" })).reasons).toContain("MODEL_CAPABILITY_UNAVAILABLE");
});
it("defaults to capacity reservation and accepts reviewed per-role request ceilings", () => {
  expect(loadConfig(genericEnvironment()).models.solver?.outputBudgetMode).toBe("capacity");
  const config = loadConfig({ ...genericEnvironment(), SOLVEFLOW_SOLVER_OUTPUT_BUDGET_MODE: "request-limit" });
  expect(config.models.solver?.outputBudgetMode).toBe("request-limit");
  expect(config.models.verifier?.outputBudgetMode).toBe("capacity");
  expect(() => loadConfig({ ...genericEnvironment(), SOLVEFLOW_SOLVER_OUTPUT_BUDGET_MODE: "unlimited" })).toThrow("CONFIG_INVALID");
});
