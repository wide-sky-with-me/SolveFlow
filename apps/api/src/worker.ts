import { randomUUID, createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Repository } from "@solveflow/db";
import { SolverInputSchema, SolveOutcomeSchema, makeSafeAgentError, type SolverInput, type SolveOutcome, type PublicAgentEvent } from "@solveflow/contracts/agent";
import { runApplicationAgent, solve, calculate, RunBudget, createProbeImage } from "@solveflow/agent/application";
import { getModelConnections, getLiveCallGate, type SolveFlowConfig } from "@solveflow/config";
import type { ImageStore } from "./storage.js";
import { normalizeImage } from "./images.js";
import { projectQuestionRun, questionThreadHistory } from "@solveflow/contracts/http";
import { conversationHistory, resolveLearningContext } from "./history.js";
export type Executor = (input: SolverInput, signal: AbortSignal, onEvent: (event: PublicAgentEvent) => Promise<void>, timeoutMs: number) => Promise<SolveOutcome>;

export function liveExecutor(config: SolveFlowConfig): Executor {
  return (input, signal, onEvent, timeoutMs) => {
    if (!getLiveCallGate(config).allowed) throw new Error("LIVE_CALLS_NOT_AUTHORIZED");
    return runApplicationAgent(input, { connections: getModelConnections(config), signal, onEvent, timeoutMs, capRmb: config.liveBudgetRmb });
  };
}
/** Explicit local demo only. Recognizes our own fixture by normalized pixel-file
 * hash; arbitrary uploads require clarification rather than receive a fake answer. */
export async function demoExecutor(): Promise<Executor> {
  const fixture = await normalizeImage(createProbeImage(), new AbortController().signal);
  return async (input, signal, onEvent) => {
    let events = Promise.resolve();
    const matches = createHash("sha256").update(input.image.bytes).digest("hex") === fixture.hash;
    const result = await solve(input, async phase => {
      await events; await delay(350, undefined, { signal });
      if (phase.role === "verifier") return { role: "verifier", events: [], verification: { schemaVersion: 1, verdict: "pass", checked: ["transcription", "arithmetic"], issues: [] } };
      const common = { schemaVersion: 1, problem: { text: matches ? "2x + 3 = 7" : "需要真实模型识别上传图片", subject: "math", uncertainties: [] }, knowledgePoints: ["一元一次方程"], citationIds: [] };
      if (!matches) return { role: "solver", events: [], candidate: { ...common, kind: "clarification", answer: null, steps: [], clarificationQuestions: ["当前为本地演示模式，请使用页面上的示例题；其他图片需开启真实模型服务。"] } };
      const value = calculate({ schemaVersion: 1, expression: "(7-3)/2" }, signal).value;
      return { role: "solver", events: [], candidate: { ...common, kind: "answer", answer: `x = ${value}`, steps: [
        { id: "step1", title: "把常数项移到等号右侧", explanation: "等式两边同时减去3，等式依然成立。", latex: "2x+3-3=7-3\\quad\\Rightarrow\\quad 2x=4" },
        { id: "step2", title: "两边同时除以系数", explanation: "未知数的系数是2，两边同时除以2。", latex: "x=\\frac{7-3}{2}=2" },
        { id: "step3", title: "代回原式检查", explanation: "把x=2代入原式，左边等于右边，结果成立。", latex: "2\\times2+3=7" }], clarificationQuestions: [] } };
    }, new RunBudget(), signal, event => { events = events.then(() => onEvent(event)); });
    await events; return result;
  };
}

export async function processNext(repository: Repository, storage: ImageStore, execute: Executor, workerId: string, shutdown: AbortSignal) {
  const job = await repository.claim(workerId);
  if (!job) return false;
  const cancel = new AbortController(); const signal = AbortSignal.any([shutdown, cancel.signal]);
  let heartbeatBusy = false; let pendingHeartbeat = Promise.resolve();
  const heartbeat = setInterval(() => {
    if (heartbeatBusy) return; heartbeatBusy = true;
    pendingHeartbeat = repository.heartbeat(job.id, workerId).then(alive => { if (!alive) cancel.abort(); }).catch(() => cancel.abort()).finally(() => { heartbeatBusy = false; });
  }, 1000);
  try {
    const session = await repository.getSession(job.ownerId, job.sessionId);
    const upload = await repository.getUpload(job.ownerId, session.upload.id);
    const bytes = await storage.get(upload.objectKey, signal);
    const previous = session.runs.slice(0, session.runs.findIndex(run => run.id === job.id));
    const context = resolveLearningContext(previous, job.context);
    const history = conversationHistory(job.context ? questionThreadHistory(previous, job.context) : previous, context.focus ? 4 * 1024 : 12 * 1024);
    const source = job.context?.kind === "verification" ? previous.find(run => run.id === job.context?.sourceRunId) : undefined;
    const target = source ? projectQuestionRun(source, job.context?.kind === "verification" ? job.context.number : undefined).outcome : undefined;
    if (job.context?.kind === "verification" && target?.status !== "completed") throw new Error("INVALID_SAVED_CONTEXT");
    const input = SolverInputSchema.parse({ schemaVersion: 1, role: "solver", identity: { ownerId: job.ownerId, sessionId: job.sessionId, runId: job.id },
      message: job.message || "请解答图片中的一道题，读取可用Skill并给出可检查的教学步骤。", subject: session.subject, history, ...context, image: { bytes, mimeType: upload.mimeType }, evidence: [],
      ...(target?.status === "completed" ? { verificationTarget: target.candidate } : {}) });
    const remaining = 120_000 - (Date.now() - job.createdAt.getTime());
    if (remaining <= 0) throw new Error("RUN_TIMEOUT");
    const outcome = SolveOutcomeSchema.parse(await execute(input, signal, async event => {
      if (!await repository.appendEvent(job.id, workerId, event)) { cancel.abort(); throw new Error("CANCELLED"); }
    }, remaining));
    signal.throwIfAborted();
    await repository.finish(job.id, workerId, outcome);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = shutdown.aborted ? "WORKER_LOST" : signal.aborted ? "CANCELLED" : message === "RUN_TIMEOUT" ? "RUN_TIMEOUT" : message === "SPEND_LIMIT" ? "SPEND_LIMIT" : ["LIVE_CALLS_NOT_AUTHORIZED", "MODEL_DISPATCH_DENIED"].includes(message) ? "CAPABILITY_DENIED" : "INTERNAL_ERROR";
    await repository.finish(job.id, workerId, { schemaVersion: 1, status: code === "CANCELLED" ? "cancelled" : "failed", verified: false, error: makeSafeAgentError(code, job.id) });
  } finally { clearInterval(heartbeat); await pendingHeartbeat; }
  return true;
}

export async function workerLoop(repository: Repository, storage: ImageStore, execute: Executor, signal: AbortSignal) {
  const workerId = randomUUID(); let lastCleanup = 0;
  while (!signal.aborted) {
    try {
      await repository.recoverLost();
      if (Date.now() - lastCleanup > 30_000) { lastCleanup = Date.now(); await repository.cleanupBatch(key => storage.remove(key, signal)); }
      if (await processNext(repository, storage, execute, workerId, signal)) continue;
    } catch { if (!signal.aborted) console.error("WORKER_CYCLE_FAILED"); }
    try { await delay(300, undefined, { signal }); } catch { break; }
  }
}
