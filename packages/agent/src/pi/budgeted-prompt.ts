import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { ImageContent } from "@earendil-works/pi-ai";
import { CapabilitySnapshot } from "../policy/capability-snapshot.js";
import { BudgetExceeded, RunBudget } from "../policy/run-budget.js";
import { assertSessionCapabilities } from "./assert-capabilities.js";

export class ModelDispatchDenied extends Error {
  constructor() { super("MODEL_DISPATCH_DENIED"); }
}
const active = new WeakSet<AgentSession>();

/** Decorate the public SDK streamFunction; Pi still owns every model/tool loop.
 * No hidden retries/compaction may be enabled by the session constructor. */
export async function budgetedPrompt(options: {
  session: AgentSession;
  capabilities: CapabilitySnapshot;
  budget: RunBudget;
  role: "solver" | "verifier";
  message: string;
  images?: ImageContent[];
  signal: AbortSignal;
  /** Required by live composition; omitted only for offline probes. Never receives prompt/image data. */
  beforeModelDispatch?: (modelId: string, signal: AbortSignal) => void | Promise<void>;
}): Promise<void> {
  const { session, capabilities, budget, role, signal } = options;
  const assertSafe = () => {
    assertSessionCapabilities(session, capabilities);
    if (session.settingsManager.getCompactionEnabled() || session.settingsManager.getRetryEnabled()
      || session.settingsManager.getProviderRetrySettings().maxRetries !== 0) throw new Error("UNBUDGETED_SDK_FEATURE");
  };
  if (active.has(session) || session.isStreaming) throw new Error("SESSION_BUSY");
  signal.throwIfAborted();
  budget.assertActive(signal);
  assertSafe();
  if (role === "verifier" && capabilities.names().length !== 0) throw new Error("VERIFIER_TOOLS_FORBIDDEN");
  active.add(session);
  const original = session.agent.streamFunction;
  const timeout = new AbortController();
  const combined = AbortSignal.any([signal, timeout.signal]);
  const timer = setTimeout(() => timeout.abort(new BudgetExceeded("RUN_TIMEOUT")), Math.min(budget.remainingMs(), role === "verifier" ? 20_000 : 120_000));
  let guardFailure: unknown;
  const abort = () => session.agent.abort();
  combined.addEventListener("abort", abort, { once: true });
  const originalBeforeToolCall = session.agent.beforeToolCall;
  session.agent.beforeToolCall = async (context, toolSignal) => {
    try {
      combined.throwIfAborted();
      assertSafe();
      const result = await originalBeforeToolCall?.(context, toolSignal);
      combined.throwIfAborted();
      assertSafe();
      return result;
    } catch (error) { guardFailure = error; throw error; }
  };
  session.agent.streamFunction = async (model, context, streamOptions) => {
    try {
      combined.throwIfAborted();
      assertSafe();
      const modelSignal = AbortSignal.any([combined, ...(streamOptions?.signal ? [streamOptions.signal] : [])]);
      if (role === "solver") budget.reserveModel(modelSignal);
      else budget.reserveVerifier(modelSignal);
      try { await options.beforeModelDispatch?.(model.id, modelSignal); }
      catch { throw new ModelDispatchDenied(); }
      budget.assertActive(modelSignal);
      assertSafe();
      return await original(model, context, { ...streamOptions, signal: modelSignal });
    } catch (error) { guardFailure = error; throw error; }
  };
  try {
    if (combined.aborted) combined.throwIfAborted();
    await session.prompt(options.message, { expandPromptTemplates: false, ...(options.images ? { images: options.images } : {}) });
    combined.throwIfAborted();
    if (guardFailure !== undefined) throw guardFailure;
    budget.assertActive(combined);
  } finally {
    clearTimeout(timer);
    combined.removeEventListener("abort", abort);
    try { await session.abort(); } finally {
      session.agent.streamFunction = original;
      if (originalBeforeToolCall) session.agent.beforeToolCall = originalBeforeToolCall;
      else delete session.agent.beforeToolCall;
      active.delete(session);
    }
  }
}
