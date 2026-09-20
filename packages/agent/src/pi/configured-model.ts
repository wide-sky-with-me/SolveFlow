import type { Model } from "@earendil-works/pi-ai";
import { ModelConnectionSchema, type ModelRole } from "@solveflow/contracts/model";
import { modelAuthorizationId } from "../policy/model-spend.js";
export function configuredModel(value: unknown, role: ModelRole) {
  const connection = ModelConnectionSchema.parse(value); const route = connection.route;
  const { thinkingFormat, ...compat } = route.compat;
  if (!route.supportsImages || (role === "solver" && !route.supportsTools)) throw new Error("MODEL_CAPABILITY_UNAVAILABLE");
  const model: Model<"openai-completions"> = { id: route.model, name: route.model, provider: route.provider, api: route.api,
    baseUrl: route.baseURL, input: ["text", "image"], reasoning: route.reasoning, contextWindow: route.contextWindow, maxTokens: route.maxOutputTokens,
    // Pi's cost currency differs; the parent ledger owns RMB accounting.
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, compat: { ...compat, ...(thinkingFormat === undefined ? {} : { thinkingFormat }) } };
  return { model, apiKey: connection.apiKey, maxTokens: route.requestMaxTokens, authorizationId: modelAuthorizationId(role, route) };
}
