import { MAX_MODEL_DISPATCHES } from "@solveflow/contracts/agent";
import type { MessagePort } from "node:worker_threads";
import { SpendReplySchema, SpendRequestSchema } from "./worker-spend-protocol.js";

/** One in-flight reservation per trusted worker; no fee, owner or ledger path is sent. */
export function createWorkerSpendClient(port: MessagePort): (modelId: string, signal: AbortSignal) => Promise<void> {
  let sequence = 0;
  let busy = false;
  return async (modelId, signal) => {
    signal.throwIfAborted();
    if (busy || sequence >= MAX_MODEL_DISPATCHES) throw new Error("MODEL_DISPATCH_DENIED");
    const parsed = SpendRequestSchema.safeParse({ type: "model.reserve", id: ++sequence, modelId });
    if (!parsed.success) throw new Error("MODEL_DISPATCH_DENIED");
    busy = true;
    try {
      await new Promise<void>((resolve, reject) => {
        const finish = (ok: boolean) => {
          clearTimeout(timer); signal.removeEventListener("abort", abort);
          port.removeListener("message", message); port.removeListener("close", close);
          if (ok) resolve(); else reject(new Error("MODEL_DISPATCH_DENIED"));
        };
        const abort = () => finish(false);
        const close = () => finish(false);
        const message = (value: unknown) => {
          const reply = SpendReplySchema.safeParse(value);
          if (!reply.success || reply.data.id !== sequence) { finish(false); return; }
          finish(!signal.aborted);
        };
        const timer = setTimeout(() => finish(false), 2000);
        signal.addEventListener("abort", abort, { once: true });
        port.on("message", message); port.once("close", close);
        try { if (signal.aborted) finish(false); else port.postMessage(parsed.data); }
        catch { finish(false); }
      });
    } finally { busy = false; }
  };
}
