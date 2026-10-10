import { PhaseDiagnosticSchema, type PhaseDiagnostic } from "./phase-diagnostic.js";
import { Worker, MessagePort } from "node:worker_threads";
import { assertBoundedJson } from "./bounded-json.js";
import { SpendRequestSchema } from "./worker-spend-protocol.js";
import { PublicAgentEventSchema, type PublicAgentEvent } from "@solveflow/contracts/agent";
export const MAX_ISOLATED_WORKER_DURATION_MS = 120_000;

export class WorkerBoundaryError extends Error {
  constructor(readonly code: "RUN_TIMEOUT" | "CANCELLED" | "WORKER_LOST" | "WORKER_OUTPUT_INVALID" | "WORKER_OUTPUT_LIMIT" | "MODEL_DISPATCH_DENIED" | "SPEND_LIMIT") { super(code); }
}

/** Trusted server-only entry URL, never supplied by a request/model. This boundary
 * terminates JS execution and waits for actual thread exit. It is NOT an OS sandbox
 * or a process-group reaper: workers must not own unsupervised stdio child processes.
 * V8 heap limits do not cap native/Buffer memory. Actual Pi integration is separate. */
export function runIsolatedWorker(entry: URL, input: unknown, options: { signal: AbortSignal; timeoutMs: number; graceMs?: number; onStarted?: () => void; onDiagnostic?: (diagnostic: PhaseDiagnostic) => void; image?: Uint8Array; maxJsonBytes?: number; toolPort?: MessagePort; authorizeModel?: (modelId: string, signal: AbortSignal) => void; onEvent?: (event: PublicAgentEvent) => Promise<void> }): Promise<unknown> {
  const { signal, timeoutMs, graceMs = 100, authorizeModel, onStarted } = options;
  if (entry.protocol !== "file:" || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_ISOLATED_WORKER_DURATION_MS || !Number.isInteger(graceMs) || graceMs < 0 || graceMs > 1000) throw new Error("INVALID_WORKER_CONFIG");
  assertBoundedJson(input, options.maxJsonBytes);
  signal.throwIfAborted();
  const toolPort = options.toolPort;
  if (toolPort !== undefined && !(toolPort instanceof MessagePort)) throw new Error("INVALID_WORKER_PORT");
  const source = options.image;
  if (source !== undefined && (!(source instanceof Uint8Array) || source.byteLength < 1 || source.byteLength > 4 * 1024 * 1024 || source.buffer instanceof SharedArrayBuffer)) throw new Error("INVALID_WORKER_IMAGE");
  // Copy only the view, never transfer/detach a caller-owned or pooled Buffer.
  const image = source === undefined ? undefined : Uint8Array.from(source);
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try { worker = new Worker(entry, { workerData: toolPort ? { input, ...(image ? { image } : {}), toolPort } : image ? { input, image } : input, transferList: [...(image ? [image.buffer] : []), ...(toolPort ? [toolPort] : [])], env: {}, execArgv: [], stdout: true, stderr: true, resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 } }); }
    catch { reject(new WorkerBoundaryError("WORKER_LOST")); return; }
    let failure: WorkerBoundaryError | undefined;
    let received = false;
    let notified = false;
    let reservations = 0;
    let value: unknown;
    let outputBytes = 0;
    let ending = false;
    let progress = Promise.resolve(); let progressCount = 0; let diagnosticCount = 0;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const terminate = () => {
      if (ending) return;
      ending = true;
      // Completion is settled by exit, never by Promise.race against ongoing work.
      void worker.terminate().catch(() => { failure ??= new WorkerBoundaryError("WORKER_LOST"); });
    };
    const stop = (code: WorkerBoundaryError["code"]) => {
      if (code === "CANCELLED" || !failure) failure = new WorkerBoundaryError(code);
      if (grace || ending) return;
      try { worker.postMessage({ type: "cancel" }); } catch { /* exit will settle */ }
      grace = setTimeout(terminate, graceMs);
    };
    const abort = () => stop("CANCELLED");
    const deadline = setTimeout(() => stop("RUN_TIMEOUT"), timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    const drain = (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > 32 * 1024) { failure ??= new WorkerBoundaryError("WORKER_OUTPUT_LIMIT"); terminate(); }
    };
    worker.stdout?.on("data", drain);
    worker.stderr?.on("data", drain);
    worker.on("message", (message: unknown) => {
      if (failure || ending) return;
      try { assertBoundedJson(message, options.maxJsonBytes); }
      catch { failure = new WorkerBoundaryError("WORKER_OUTPUT_INVALID"); terminate(); return; }
      if (typeof message === "object" && message !== null && "type" in message && message.type === "diagnostic") {
        const parsed = "diagnostic" in message ? PhaseDiagnosticSchema.safeParse(message.diagnostic) : undefined;
        if (!parsed?.success || Object.keys(message).length !== 2 || ++diagnosticCount > 4) { failure = new WorkerBoundaryError("WORKER_OUTPUT_INVALID"); terminate(); return; }
        try { options.onDiagnostic?.(parsed.data); } catch { failure = new WorkerBoundaryError("WORKER_OUTPUT_INVALID"); terminate(); }
        return;
      }
      if (typeof message === "object" && message !== null && "type" in message && message.type === "progress") {
        const event = "event" in message ? PublicAgentEventSchema.safeParse(message.event) : undefined;
        if (!options.onEvent || !event?.success || Object.keys(message).length !== 2 || ++progressCount > 96) { failure = new WorkerBoundaryError("WORKER_OUTPUT_INVALID"); terminate(); return; }
        progress = progress.then(async () => { if (!failure) await options.onEvent?.(event.data); }).catch(() => { failure ??= new WorkerBoundaryError("WORKER_LOST"); terminate(); });
        return;
      }
      if (typeof message === "object" && message !== null && "type" in message && message.type === "started" && Object.keys(message).length === 1) {
        if (notified) { failure = new WorkerBoundaryError("WORKER_OUTPUT_INVALID"); terminate(); return; }
        notified = true;
        try { onStarted?.(); } catch { failure = new WorkerBoundaryError("WORKER_LOST"); terminate(); }
        return;
      }
      if (typeof message === "object" && message !== null && "type" in message && message.type === "model.reserve") {
        const request = SpendRequestSchema.safeParse(message);
        try {
          if (!request.success || request.data.id !== reservations + 1 || !authorizeModel) throw new Error("DENIED");
          const reply: unknown = authorizeModel(request.data.modelId, signal);
          if (reply !== undefined) {
            // The caller receives denial, not a hidden async failure or permission.
            if (reply instanceof Promise) void reply.catch(() => {});
            throw new Error("SYNC_AUTHORITY_REQUIRED");
          }
          reservations += 1;
          if (signal.aborted || failure || ending) return;
          worker.postMessage({ type: "model.reserved", id: request.data.id, ok: true });
        } catch (error) { failure ??= new WorkerBoundaryError(error instanceof Error && error.message === "SPEND_LIMIT" ? "SPEND_LIMIT" : "MODEL_DISPATCH_DENIED"); terminate(); }
        return;
      }
      if (authorizeModel && reservations === 0) { failure = new WorkerBoundaryError("MODEL_DISPATCH_DENIED"); terminate(); return; }
      if (received) { failure = new WorkerBoundaryError("WORKER_OUTPUT_INVALID"); terminate(); return; }
      received = true;
      value = message;
      terminate();
    });
    worker.on("error", () => { failure ??= new WorkerBoundaryError("WORKER_LOST"); terminate(); });
    worker.once("exit", () => {
      clearTimeout(deadline);
      if (grace) clearTimeout(grace);
      signal.removeEventListener("abort", abort);
      worker.stdout?.removeListener("data", drain);
      worker.stderr?.removeListener("data", drain);
      worker.removeAllListeners();
      void progress.then(() => {
        if (signal.aborted) failure = new WorkerBoundaryError("CANCELLED");
        if (failure) reject(failure);
        else if (!received) reject(new WorkerBoundaryError("WORKER_LOST"));
        else resolve(value);
      });
    });
    if (signal.aborted) abort();
  });
}
