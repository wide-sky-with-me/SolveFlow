import { z } from "zod";
import { CompletionCompatSchema, ModelRouteSchema, ModelReferenceSchema, ProviderNameSchema, ProviderBaseUrlSchema, ModelConnectionsSchema, type ModelRoute, type ModelRole } from "@solveflow/contracts/model";
import { appEnvironmentKeys } from "./app.js";
export { loadAppConfig, type AppConfig } from "./app.js";
export const MAX_LIVE_BUDGET_RMB = Math.floor(Number.MAX_SAFE_INTEGER / 1_000_000);
const blank = (value: unknown): unknown => typeof value === "string" && !value.trim() ? undefined : value;
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(blank, schema.optional());
const bool = optional(z.enum(["true", "false"]).transform(value => value === "true"));
const decimal = z.string().trim().regex(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/).transform(Number).pipe(z.number().finite().nonnegative());
const tokens = optional(z.string().regex(/^[1-9][0-9]*$/).transform(Number).pipe(z.number().int().max(10_000_000)));
const keySchema = optional(z.string().trim().min(1).max(4096).regex(/^[\x21-\x7e]+$/));
export const legacyModelVariables = {
  SOLVEFLOW_DMX_BASE_URL: "SOLVEFLOW_LLM_BASE_URL", SOLVEFLOW_DMX_API_KEY: "SOLVEFLOW_LLM_API_KEY",
  SOLVEFLOW_DMX_HARD_QUOTA_CONFIRMED: "SOLVEFLOW_LLM_HARD_QUOTA_CONFIRMED", SOLVEFLOW_DMX_HARD_QUOTA_RMB: "SOLVEFLOW_LLM_HARD_QUOTA_RMB",
} as const;
const aliases = legacyModelVariables;
const connectionFields = ["PROVIDER", "API", "BASE_URL", "API_KEY", "COMPAT", "SUPPORTS_IMAGES", "SUPPORTS_TOOLS", "REASONING"];
const roleFields = [...connectionFields, "MODEL", "CONTEXT_WINDOW", "MAX_OUTPUT_TOKENS", "MAX_TOKENS", "OUTPUT_BUDGET_MODE", "INPUT_RMB_PER_MTOK", "OUTPUT_RMB_PER_MTOK", "REQUEST_FEE_RMB"];
const known = new Set(["SOLVEFLOW_LIVE_CALLS", "SOLVEFLOW_LIVE_BUDGET_RMB", "SOLVEFLOW_LLM_HARD_QUOTA_CONFIRMED", "SOLVEFLOW_LLM_HARD_QUOTA_RMB",
  ...connectionFields.map(field => `SOLVEFLOW_LLM_${field}`), ...["SOLVER", "VERIFIER"].flatMap(role => roleFields.map(field => `SOLVEFLOW_${role}_${field}`)), ...Object.keys(aliases)]);
export class ConfigError extends Error {
  readonly code = "CONFIG_INVALID";
  constructor(readonly fields: readonly string[]) { super("CONFIG_INVALID"); this.name = "ConfigError"; this.fields = Object.freeze([...new Set(fields)]); }
}
export interface SolveFlowConfig {
  readonly schemaVersion: 1; readonly liveCallsOptIn: boolean; readonly liveBudgetRmb: number | null;
  readonly hardQuotaConfirmed: boolean; readonly hardQuotaRmb: number | undefined;
  readonly baseURL: string | undefined; readonly solverModel: string | undefined; readonly verifierModel: string | undefined;
  readonly models: Readonly<{ solver: Readonly<ModelRoute> | undefined; verifier: Readonly<ModelRoute> | undefined }>;
  readonly rates: Readonly<{ solverInputRmbPerMillionTokens: number | undefined; solverOutputRmbPerMillionTokens: number | undefined; verifierInputRmbPerMillionTokens: number | undefined; verifierOutputRmbPerMillionTokens: number | undefined }>;
  readonly legacyVariables: readonly string[];
}
const credentials = new WeakMap<SolveFlowConfig, Readonly<Record<ModelRole, string | undefined>>>();
const loaded = new WeakSet<SolveFlowConfig>();
/** Server-only input. No implicit provider/model, environment lookup, network or logging. */
export function loadConfig(environment: unknown): SolveFlowConfig {
  if (typeof environment !== "object" || environment === null || Array.isArray(environment)) throw new ConfigError(["environment"]);
  const input: Record<string, unknown> = {};
  for (const field of Object.keys(environment)) {
    if (!field.startsWith("SOLVEFLOW_") || appEnvironmentKeys.includes(field)) continue;
    if (!known.has(field)) throw new ConfigError(["unknown_project_variable"]);
    const descriptor = Object.getOwnPropertyDescriptor(environment, field);
    if (!descriptor || !("value" in descriptor)) throw new ConfigError([field]);
    input[field] = blank(descriptor.value);
  }
  const legacyVariables: string[] = [];
  for (const [old, current] of Object.entries(aliases)) if (input[old] !== undefined) {
    legacyVariables.push(old);
    if (input[current] !== undefined && input[current] !== input[old]) throw new ConfigError([current, old]);
    input[current] = input[old];
  }
  const read = <T extends z.ZodType>(field: string, schema: T): z.output<T> => {
    const parsed = schema.safeParse(input[field]); if (!parsed.success) throw new ConfigError([field]); return parsed.data;
  };
  const readCompat = (field: string) => {
    const raw = read(field, optional(z.string().max(4096))); if (raw === undefined) return undefined;
    try { return CompletionCompatSchema.parse(JSON.parse(raw)); } catch { throw new ConfigError([field]); }
  };
  const readConnection = (prefix: string) => ({
    provider: read(`${prefix}_PROVIDER`, optional(ProviderNameSchema)), api: read(`${prefix}_API`, optional(z.literal("openai-completions"))),
    baseURL: read(`${prefix}_BASE_URL`, optional(ProviderBaseUrlSchema)), apiKey: read(`${prefix}_API_KEY`, keySchema), compat: readCompat(`${prefix}_COMPAT`),
    supportsImages: read(`${prefix}_SUPPORTS_IMAGES`, bool), supportsTools: read(`${prefix}_SUPPORTS_TOOLS`, bool), reasoning: read(`${prefix}_REASONING`, bool),
  });
  const common = readConnection("SOLVEFLOW_LLM");
  const role = (name: "SOLVER" | "VERIFIER") => {
    const prefix = `SOLVEFLOW_${name}`; const own = readConnection(prefix);
    const model = read(`${prefix}_MODEL`, optional(ModelReferenceSchema));
    const contextWindow = read(`${prefix}_CONTEXT_WINDOW`, tokens); const maxOutputTokens = read(`${prefix}_MAX_OUTPUT_TOKENS`, tokens);
    const requestMaxTokens = read(`${prefix}_MAX_TOKENS`, tokens) ?? 4096;
    const outputBudgetMode = read(`${prefix}_OUTPUT_BUDGET_MODE`, optional(z.enum(["capacity", "request-limit"]))) ?? "capacity";
    const inputRate = read(`${prefix}_INPUT_RMB_PER_MTOK`, optional(decimal)); const outputRate = read(`${prefix}_OUTPUT_RMB_PER_MTOK`, optional(decimal));
    const requestFeeRmb = read(`${prefix}_REQUEST_FEE_RMB`, optional(decimal)) ?? 0;
    const baseURL = own.baseURL ?? common.baseURL;
    const commonProvider = common.provider ?? (common.baseURL ? new URL(common.baseURL).hostname : undefined);
    const provider = own.provider ?? (own.baseURL && own.baseURL !== common.baseURL ? new URL(own.baseURL).hostname : commonProvider);
    // An override pointing elsewhere must bring its own credential. Never leak the shared key.
    const sameDestination = baseURL === common.baseURL && provider === commonProvider;
    const apiKey = own.apiKey ?? (sameDestination ? common.apiKey : undefined);
    let route: ModelRoute | undefined;
    if (model !== undefined && baseURL !== undefined && provider !== undefined && contextWindow !== undefined && maxOutputTokens !== undefined && inputRate !== undefined && outputRate !== undefined) {
      const parsed = ModelRouteSchema.safeParse({ schemaVersion: 1, model, baseURL, provider, api: own.api ?? common.api ?? "openai-completions",
        contextWindow, maxOutputTokens, requestMaxTokens, outputBudgetMode, inputRmbPerMillionTokens: inputRate, outputRmbPerMillionTokens: outputRate, requestFeeRmb,
        supportsImages: own.supportsImages ?? common.supportsImages ?? false, supportsTools: own.supportsTools ?? common.supportsTools ?? false,
        reasoning: own.reasoning ?? common.reasoning ?? false, compat: own.compat ?? common.compat ?? {} });
      if (!parsed.success) throw new ConfigError([`${prefix}_MODEL_LIMITS`]);
      route = parsed.data; Object.freeze(route.compat); Object.freeze(route);
    }
    return { model, route, apiKey, inputRate, outputRate };
  };
  const solver = role("SOLVER"); const verifier = role("VERIFIER");
  const config: SolveFlowConfig = Object.freeze({ schemaVersion: 1,
    liveCallsOptIn: read("SOLVEFLOW_LIVE_CALLS", bool) ?? false,
    liveBudgetRmb: read("SOLVEFLOW_LIVE_BUDGET_RMB", optional(z.union([z.literal("unlimited").transform(() => null), decimal.pipe(z.number().positive().max(MAX_LIVE_BUDGET_RMB))]))) ?? null,
    hardQuotaConfirmed: read("SOLVEFLOW_LLM_HARD_QUOTA_CONFIRMED", bool) ?? false,
    hardQuotaRmb: read("SOLVEFLOW_LLM_HARD_QUOTA_RMB", optional(decimal.pipe(z.number().positive().max(MAX_LIVE_BUDGET_RMB)))),
    baseURL: common.baseURL, solverModel: solver.model, verifierModel: verifier.model,
    models: Object.freeze({ solver: solver.route, verifier: verifier.route }),
    rates: Object.freeze({ solverInputRmbPerMillionTokens: solver.inputRate, solverOutputRmbPerMillionTokens: solver.outputRate, verifierInputRmbPerMillionTokens: verifier.inputRate, verifierOutputRmbPerMillionTokens: verifier.outputRate }),
    legacyVariables: Object.freeze(legacyVariables),
  });
  credentials.set(config, Object.freeze({ solver: solver.apiKey, verifier: verifier.apiKey })); loaded.add(config); return config;
}
export type LiveCallBlockReason = "UNVALIDATED_CONFIG" | "LIVE_CALLS_DISABLED" | "MISSING_LLM_API_KEY" | "HARD_QUOTA_NOT_CONFIRMED" | "HARD_QUOTA_MISSING" | "HARD_QUOTA_EXCEEDS_BUDGET" | "MODEL_RATES_MISSING" | "MODEL_CONFIG_MISSING" | "MODEL_CAPABILITY_UNAVAILABLE";
export function getLiveCallGate(config: SolveFlowConfig): Readonly<{ allowed: boolean; reasons: readonly LiveCallBlockReason[] }> {
  if (!loaded.has(config)) return Object.freeze({ allowed: false, reasons: Object.freeze(["UNVALIDATED_CONFIG"] as const) });
  const reasons: LiveCallBlockReason[] = []; const keys = credentials.get(config);
  if (!config.liveCallsOptIn) reasons.push("LIVE_CALLS_DISABLED");
  if (!keys?.solver || !keys.verifier) reasons.push("MISSING_LLM_API_KEY");
  // Legacy provider quota declarations are metadata, not application admission gates.
  if (Object.values(config.rates).some(value => value === undefined)) reasons.push("MODEL_RATES_MISSING");
  if (!config.models.solver || !config.models.verifier) reasons.push("MODEL_CONFIG_MISSING");
  else if (!config.models.solver.supportsImages || !config.models.solver.supportsTools || !config.models.verifier.supportsImages) reasons.push("MODEL_CAPABILITY_UNAVAILABLE");
  return Object.freeze({ allowed: !reasons.length, reasons: Object.freeze(reasons) });
}
export class LiveCallsDisabledError extends Error {
  readonly code = "LIVE_CALLS_NOT_AUTHORIZED";
  constructor(readonly reasons: readonly LiveCallBlockReason[]) { super("LIVE_CALLS_NOT_AUTHORIZED"); this.name = "LiveCallsDisabledError"; }
}
export function assertLiveCallsAllowed(config: SolveFlowConfig) { const gate = getLiveCallGate(config); if (!gate.allowed) throw new LiveCallsDisabledError(gate.reasons); }
export function getModelConnections(config: SolveFlowConfig) {
  assertLiveCallsAllowed(config); const keys = credentials.get(config);
  return ModelConnectionsSchema.parse({ solver: { route: config.models.solver, apiKey: keys?.solver }, verifier: { route: config.models.verifier, apiKey: keys?.verifier } });
}
export function safeSummary(config: SolveFlowConfig) {
  if (!loaded.has(config)) return Object.freeze({ schemaVersion: 1, configured: false, liveCallsAllowed: false });
  const keys = credentials.get(config);
  return Object.freeze({ ...config, configured: true, apiKeyConfigured: Boolean(keys?.solver && keys.verifier), liveCallsAllowed: getLiveCallGate(config).allowed });
}
