import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PhaseDiagnosticSchema, type PhaseDiagnostic } from "../policy/phase-diagnostic.js";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { AgentInputSchema, PublicAgentEventSchema, parseCandidateWithEvidence, parseVerificationForCandidate, type NormalizedImage, type PhaseResult, type PublicAgentEvent } from "@solveflow/contracts/agent";
import { RunBudget, BudgetExceeded } from "../policy/run-budget.js";
import { CapabilitySnapshot } from "../policy/capability-snapshot.js";
import { budgetedPrompt, ModelDispatchDenied } from "./budgeted-prompt.js";

export class PhaseError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "MODEL_OUTPUT_INVALID" | "MODEL_DISPATCH_DENIED" | "CLEANUP_FAILED" | "CANCELLED" | "CAPABILITY_DENIED" | "RUN_TIMEOUT" | "MODEL_TIMEOUT" | "MODEL_LIMIT" | "TOOL_LIMIT" | "VERIFIER_LIMIT") { super(code); }
}
export type { PhaseResult } from "@solveflow/contracts/agent";
const consumed = new WeakSet<AgentSession>();

/** Internal Pi boundary: consumes one freshly constructed, exclusive SDK session.
 * Returns project data, never SDK transcripts. External MCP handles remain owned by
 * the caller and must close in its finally. Run this inside the supervised worker
 * for noncooperative termination; this helper alone is only cooperatively bounded. */
export async function runSessionPhase(session: AgentSession, options: { visualEvidence?: { images: NormalizedImage[]; description: string } | undefined; input: unknown; capabilities: CapabilitySnapshot; budget: RunBudget; signal: AbortSignal; onDiagnostic?: (diagnostic: PhaseDiagnostic) => void; beforeModelDispatch?: (modelId: string, signal: AbortSignal) => void | Promise<void> }): Promise<PhaseResult> {
  if (consumed.has(session) || session.isStreaming || session.messages.length !== 0) throw new PhaseError("CAPABILITY_DENIED");
  consumed.add(session);
  let unsubscribe: (() => void) | undefined;
  try {
    const parsed = AgentInputSchema.safeParse(options.input);
    if (!parsed.success) throw new PhaseError("INVALID_INPUT");
    const input = parsed.data;
    options.capabilities.assertIdentity(input.identity);
    const events: PublicAgentEvent[] = [];
    const emit = (event: unknown) => {
      if (events.length >= 40) throw new PhaseError("TOOL_LIMIT");
      events.push(PublicAgentEventSchema.parse(event));
    };
    emit({ schemaVersion: 1, runId: input.identity.runId, type: "run.status", status: input.role === "verifier" ? "verifying" : input.revision ? "revising" : "solving" });
    const calls = new Map<string, string>();
    let eventFailure = false;
    unsubscribe = session.subscribe(event => {
      if (event.type !== "tool_execution_start" && event.type !== "tool_execution_end") return;
      if (!options.capabilities.names().includes(event.toolName)) return;
      try {
        if (!calls.has(event.toolCallId)) calls.set(event.toolCallId, randomUUID());
        const status = event.type === "tool_execution_start" ? "started" : event.isError ? "failed" : "completed";
        emit({ schemaVersion: 1, runId: input.identity.runId, type: "tool.status", toolCallId: calls.get(event.toolCallId), toolName: event.toolName, status,
          summary: status === "completed" ? "tool_completed" : status === "failed" ? "tool_failed" : event.toolName === "read" ? "reading_resources" : "calling_approved_tool" });
      } catch { eventFailure = true; session.agent.abort(); }
    });
    // The original image is independently supplied on EVERY phase, including Verifier.
    const { image, identity: _identity, ...data } = input;
    await budgetedPrompt({ session, capabilities: options.capabilities, budget: options.budget, role: input.role, signal: options.signal,
      ...(options.beforeModelDispatch ? { beforeModelDispatch: options.beforeModelDispatch } : {}),
      message: JSON.stringify(data) + (options.visualEvidence ? `\n服务端图片顺序说明：${options.visualEvidence.description}` : ""), images: [image, ...(options.visualEvidence?.images ?? [])].map(item => ({ type: "image" as const, data: Buffer.from(item.bytes).toString("base64"), mimeType: item.mimeType })) });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (eventFailure) throw new PhaseError("TOOL_LIMIT");
      const final = session.messages.at(-1);
      const diagnose = (reason: PhaseDiagnostic["reason"], details: object = {}) => {
        const diagnostic = PhaseDiagnosticSchema.parse({ schemaVersion: 1, event: "MODEL_OUTPUT_REJECTED", runId: input.identity.runId, role: input.role, reason, ...details });
        if (options.onDiagnostic) options.onDiagnostic(diagnostic); else console.warn(JSON.stringify(diagnostic));
      };
      if (!final || final.role !== "assistant" || final.stopReason !== "stop") {
        diagnose("INCOMPLETE_RESPONSE", { stopReason: final?.role === "assistant" ? final.stopReason : "missing" });
        throw new PhaseError("MODEL_OUTPUT_INVALID");
      }
      let text = "";
      for (const part of final.content) {
        if (part.type !== "text") continue;
        if (Buffer.byteLength(text, "utf8") + Buffer.byteLength(part.text, "utf8") > 32 * 1024) { diagnose("OUTPUT_SIZE_LIMIT"); throw new PhaseError("MODEL_OUTPUT_INVALID"); }
        text += part.text;
      }
      let value: unknown;
      try { value = JSON.parse(text); }
      catch {
        diagnose("JSON_INVALID", { bytes: Buffer.byteLength(text), fenced: text.trimStart().startsWith("```"), empty: text.trim().length === 0 });
        if (input.role !== "solver" || !options.budget.tryReserveFormatRepair(options.signal)) throw new PhaseError("MODEL_OUTPUT_INVALID");
        await budgetedPrompt({ session, capabilities: options.capabilities, budget: options.budget, role: input.role, signal: options.signal,
          ...(options.beforeModelDispatch ? { beforeModelDispatch: options.beforeModelDispatch } : {}),
          message: "你上一条最终输出未通过JSON语法解析。本次仅有一次格式修复机会：依据原题与已有上下文，重新输出一个符合系统JSON Schema的完整JSON对象。不要前后说明或代码围栏；字符串中的反斜线、双引号和换行必须正确进行JSON转义，尤其是LaTeX公式。不要添加verified或虚构引用。无法确定原题条件时按Schema输出clarification。" });
        continue;
      }
      try {
        if (input.role === "solver") return { role: "solver", candidate: parseCandidateWithEvidence(value, input.evidence), events };
        return { role: "verifier", verification: parseVerificationForCandidate(value, input.candidate), events };
      } catch (error) {
        const fields = new Set(["schemaVersion", "kind", "problem", "text", "subject", "uncertainties", "answer", "steps", "id", "title", "explanation", "latex", "knowledgePoints", "citationIds", "clarificationQuestions", "refusalReason", "questions", "number", "stepIds", "figureIds", "figures", "xRange", "yRange", "elements", "coefficients", "checked", "verdict", "issues"]);
        diagnose("SCHEMA_INVALID", { issues: error instanceof z.ZodError ? error.issues.slice(0, 8).map(issue => ({ code: issue.code, path: issue.path.map(segment => typeof segment === "number" ? "item" : fields.has(String(segment)) ? String(segment) : "field").join(".") })) : [], semanticCheckFailed: !(error instanceof z.ZodError) });
        throw new PhaseError("MODEL_OUTPUT_INVALID");
      }
    }
    throw new PhaseError("MODEL_OUTPUT_INVALID");
  } catch (error) {
    if (options.signal.aborted) throw new PhaseError("CANCELLED");
    if (error instanceof PhaseError) throw error;
    if (error instanceof ModelDispatchDenied) throw new PhaseError("MODEL_DISPATCH_DENIED");
    if (error instanceof BudgetExceeded) throw new PhaseError(error.code === "RUN_TIMEOUT" && options.budget.remainingMs() > 0 ? "MODEL_TIMEOUT" : error.code);
    if (error instanceof Error && (error.message === "CAPABILITY_MISMATCH" || error.message === "CAPABILITY_DENIED" || error.message === "VERIFIER_TOOLS_FORBIDDEN")) throw new PhaseError("CAPABILITY_DENIED");
    throw new PhaseError("MODEL_OUTPUT_INVALID");
  } finally {
    let cleanupFailed = false;
    try { unsubscribe?.(); } catch { cleanupFailed = true; }
    try { await session.abort(); } catch { cleanupFailed = true; }
    try { session.dispose(); } catch { cleanupFailed = true; }
    if (options.signal.aborted) throw new PhaseError("CANCELLED");
    if (cleanupFailed) throw new PhaseError("CLEANUP_FAILED");
  }
}
