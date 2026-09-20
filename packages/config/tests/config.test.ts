import { describe, expect, it } from "vitest";
import { inspect } from "node:util";
import { assertLiveCallsAllowed, ConfigError, getModelConnections, getLiveCallGate, loadConfig, safeSummary } from "../src/index.js";

import { genericEnvironment } from "./config.test-support.js";
const getKey = (config: ReturnType<typeof loadConfig>) => getModelConnections(config).solver.apiKey;
const fixtureKey = "synthetic-config-fixture-not-a-real-key";
const authorized = () => ({ ...genericEnvironment(), SOLVEFLOW_LLM_API_KEY: fixtureKey });

describe("server configuration and live-call gates", () => {
  it("accepts environment model choices without granting live permission", () => {
    const id = "custom/model:tag";
    const config = loadConfig({ SOLVEFLOW_SOLVER_MODEL: id, SOLVEFLOW_VERIFIER_MODEL: id, SOLVEFLOW_LLM_API_KEY: fixtureKey });
    expect(config.solverModel).toBe(id); expect(config.verifierModel).toBe(id);
    expect(getLiveCallGate(config).allowed).toBe(false);
    expect(() => loadConfig({ SOLVEFLOW_VERIFIER_MODEL: "model with spaces" })).toThrow("CONFIG_INVALID");
  });
  it("supports keyless offline defaults and ignores unrelated environment", () => {
    const config = loadConfig({ PATH: "/synthetic/bin" });
    expect(config).toMatchObject({ liveCallsOptIn: false, liveBudgetRmb: null, baseURL: undefined, solverModel: undefined, verifierModel: undefined });
    expect(safeSummary(config)).toMatchObject({ apiKeyConfigured: false, liveCallsAllowed: false });
    expect(() => assertLiveCallsAllowed(config)).toThrow("LIVE_CALLS_NOT_AUTHORIZED");
    expect(() => getKey(config)).toThrow("LIVE_CALLS_NOT_AUTHORIZED");
  });

  it("requires every independent gate, not merely a configured key", () => {
    const config = loadConfig({ SOLVEFLOW_LLM_API_KEY: fixtureKey });
    expect(getLiveCallGate(config).reasons).toEqual(expect.arrayContaining(["LIVE_CALLS_DISABLED", "MODEL_RATES_MISSING"]));
    expect(() => getKey(config)).toThrow();
  });

  it.each([
    { field: "SOLVEFLOW_LLM_API_KEY", reason: "MISSING_LLM_API_KEY" },
    { field: "SOLVEFLOW_LIVE_CALLS", reason: "LIVE_CALLS_DISABLED" },
    { field: "SOLVEFLOW_SOLVER_INPUT_RMB_PER_MTOK", reason: "MODEL_RATES_MISSING" },
    { field: "SOLVEFLOW_SOLVER_OUTPUT_RMB_PER_MTOK", reason: "MODEL_RATES_MISSING" },
    { field: "SOLVEFLOW_VERIFIER_INPUT_RMB_PER_MTOK", reason: "MODEL_RATES_MISSING" },
    { field: "SOLVEFLOW_VERIFIER_OUTPUT_RMB_PER_MTOK", reason: "MODEL_RATES_MISSING" },
  ])("blocks when $field is missing", ({ field, reason }) => {
    const env: Record<string, string> = authorized();
    delete env[field];
    const config = loadConfig(env);
    expect(getLiveCallGate(config)).toMatchObject({ allowed: false });
    expect(getLiveCallGate(config).reasons).toContain(reason);
    expect(() => assertLiveCallsAllowed(config)).toThrow();
  });

  it("permits configured live access only with all gates and freezes public state", () => {
    const config = loadConfig(authorized());
    expect(getLiveCallGate(config)).toEqual({ allowed: true, reasons: [] });
    expect(getKey(config)).toBe(fixtureKey);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.rates)).toBe(true);
    expect(getLiveCallGate({ ...config })).toEqual({ allowed: false, reasons: ["UNVALIDATED_CONFIG"] });
  });

  it("does not expose credentials through summaries, config JSON or inspection", () => {
    const config = loadConfig(authorized());
    for (const output of [JSON.stringify(safeSummary(config)), JSON.stringify(config), inspect(config)]) {
      expect(output).not.toContain(fixtureKey);
    }
    expect(safeSummary(config)).toMatchObject({ apiKeyConfigured: true, rates: { solverInputRmbPerMillionTokens: 1 } });
  });

  it.each([
    ["SOLVEFLOW_LLM_BASE_URL", "http://other.example/v1"],
    ["SOLVEFLOW_LLM_BASE_URL", "https://user:private@other.example/v1"],
    ["SOLVEFLOW_SOLVER_MODEL", "invalid model"],
    ["SOLVEFLOW_VERIFIER_MODEL", "bad\nmodel"],
    ["SOLVEFLOW_LIVE_BUDGET_RMB", "1e100"],
    ["SOLVEFLOW_LIVE_BUDGET_RMB", "0"],
    ["SOLVEFLOW_LLM_HARD_QUOTA_RMB", "1e100"],
    ["SOLVEFLOW_LLM_HARD_QUOTA_RMB", "-1"],
    ["SOLVEFLOW_SOLVER_INPUT_RMB_PER_MTOK", "-1"],
    ["SOLVEFLOW_SOLVER_OUTPUT_RMB_PER_MTOK", "Infinity"],
    ["SOLVEFLOW_VERIFIER_INPUT_RMB_PER_MTOK", "NaN"],
    ["SOLVEFLOW_VERIFIER_OUTPUT_RMB_PER_MTOK", "1e999"],
    ["SOLVEFLOW_VERIFIER_OUTPUT_RMB_PER_MTOK", "0x10"],
    ["SOLVEFLOW_LIVE_CALLS", "1"],
  ])("rejects invalid %s without exposing value", (field, value) => {
    expect(() => loadConfig({ [field]: value })).toThrow(ConfigError);
    try { loadConfig({ [field]: value, SOLVEFLOW_LLM_API_KEY: fixtureKey }); } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect(JSON.stringify(error)).not.toContain(fixtureKey);
      expect(String(error)).toBe("ConfigError: CONFIG_INVALID");
    }
  });

  it("never serializes an invalid credential input in errors", () => {
    let caught: unknown;
    try { loadConfig({ SOLVEFLOW_LLM_API_KEY: { nested: fixtureKey } }); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(ConfigError);
    expect(inspect(caught)).not.toContain(fixtureKey);
    expect(JSON.stringify(caught)).not.toContain(fixtureKey);
  });

  it("keeps finite local budgets independent from legacy provider quota declarations", () => {
    const config = loadConfig({ ...authorized(), SOLVEFLOW_LIVE_BUDGET_RMB: "10" });
    expect(config.liveBudgetRmb).toBe(10);
    expect(getLiveCallGate(config).allowed).toBe(true);
    expect(getLiveCallGate(loadConfig({ ...authorized(), SOLVEFLOW_LIVE_BUDGET_RMB: "10", SOLVEFLOW_LLM_HARD_QUOTA_RMB: "10" })).allowed).toBe(true);
  });

  it("treats blanks as missing and accepts explicitly verified zero rates", () => {
    expect(getLiveCallGate(loadConfig({ ...authorized(), SOLVEFLOW_LLM_API_KEY: "   " })).reasons).toContain("MISSING_LLM_API_KEY");
    expect(getLiveCallGate(loadConfig({ ...authorized(), SOLVEFLOW_SOLVER_INPUT_RMB_PER_MTOK: "" })).reasons).toContain("MODEL_RATES_MISSING");
    expect(getLiveCallGate(loadConfig({ ...authorized(), SOLVEFLOW_SOLVER_INPUT_RMB_PER_MTOK: "0" })).allowed).toBe(true);
  });

  it("rejects unknown project switches without copying their potentially sensitive names", () => {
    try { loadConfig({ [`SOLVEFLOW_${fixtureKey}`]: "true" }); } catch (error) {
      expect(error).toMatchObject({ code: "CONFIG_INVALID", fields: ["unknown_project_variable"] });
      expect(JSON.stringify(error)).not.toContain(fixtureKey);
      return;
    }
    throw new Error("EXPECTED_REJECTION");
  });
  it("does not invoke environment accessors or serialize their exceptions", () => {
    const env = Object.defineProperty({}, "SOLVEFLOW_LLM_API_KEY", { enumerable: true, get() { throw new Error(fixtureKey); } });
    expect(() => loadConfig(env)).toThrow("CONFIG_INVALID");
    try { loadConfig(env); } catch (error) { expect(inspect(error)).not.toContain(fixtureKey); }
  });
});
it("defaults to unlimited spending and ignores legacy quota requirements without bypassing live opt-in", () => {
  const env = { ...authorized(), SOLVEFLOW_LIVE_BUDGET_RMB: "unlimited", SOLVEFLOW_LLM_HARD_QUOTA_CONFIRMED: "false", SOLVEFLOW_LLM_HARD_QUOTA_RMB: "" };
  expect(loadConfig({}).liveBudgetRmb).toBeNull();
  expect(loadConfig(env).liveBudgetRmb).toBeNull();
  expect(getLiveCallGate(loadConfig(env)).allowed).toBe(true);
  expect(getLiveCallGate(loadConfig({ ...env, SOLVEFLOW_LIVE_CALLS: "false" })).allowed).toBe(false);
  expect(loadConfig({ ...env, SOLVEFLOW_LIVE_BUDGET_RMB: "100" }).liveBudgetRmb).toBe(100);
});
