import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { stream } from "@earendil-works/pi-ai/api/openai-completions";
import { createProviderRequest, type ProviderFailure } from "../policy/provider-request.js";

/** Trusted phase construction supplies reviewed metadata/credential and a parent gate.
 * The gate owns spending authorization here; do not also reserve it in beforeModelDispatch.
 * Pi still owns its loop. This is not the live configuration/session factory.
 */
export function createAuthorizedOpenAiStream(settings: {
  model: Model<"openai-completions">;
  apiKey: string;
  maxTokens: number;
  timeoutMs: number;
  authorize: (modelId: string, signal: AbortSignal) => void | Promise<void>;
}) {
  const model = structuredClone(settings.model);
  const { apiKey, maxTokens, timeoutMs, authorize } = settings;
  if (!apiKey.trim() || typeof authorize !== "function" || !Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > model.maxTokens || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error("INVALID_PROVIDER_SETUP");
  const endpoint = (model.baseUrl.endsWith("/") ? model.baseUrl.slice(0, -1) : model.baseUrl) + "/chat/completions";
  createProviderRequest(endpoint); // Validate before reserving any cost; no request.
  let active = false;
  let dispatchDenied = false;
  let failure: () => ProviderFailure | undefined = () => undefined;
  const streamFunction: AgentSession["agent"]["streamFunction"] = async (actual, context, options) => {
    if (active || actual.id !== model.id || actual.provider !== model.provider || actual.api !== model.api || actual.baseUrl !== model.baseUrl) {
      dispatchDenied = true; throw new Error("MODEL_DISPATCH_DENIED");
    }
    active = true;
    const signal = options?.signal ?? new AbortController().signal;
    try {
      signal.throwIfAborted();
      try { await authorize(model.id, signal); } catch { dispatchDenied = true; throw new Error("MODEL_DISPATCH_DENIED"); }
      signal.throwIfAborted();
      const request = createProviderRequest(endpoint); failure = request.failure;
      // Caller headers, key, payload hooks, retry and token overrides are not forwarded.
      const output = stream(model, context, { apiKey, maxTokens, timeoutMs, maxRetries: 0, signal, fetch: request.fetch });
      void output.result().then(() => { active = false; }, () => { active = false; });
      return output;
    } catch { active = false; throw new Error(signal.aborted ? "CANCELLED" : "MODEL_DISPATCH_DENIED"); }
  };
  return Object.freeze({ streamFunction, failure: () => failure(), dispatchDenied: () => dispatchDenied });
}
