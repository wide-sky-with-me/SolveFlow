import { z } from "zod";
import { CreateRunSchema, RunViewSchema, type RunContext } from "@solveflow/contracts/http";
import { ClientError, jsonRequest, type ClientStore, type SolveClient } from "./client.js";
const PendingSchema = z.strictObject({ sessionId: z.uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), key: z.uuid() });
/** Only IDs and a hash are persisted, never question text, images or credentials. */
export class RunSubmission {
  private busy = false;
  constructor(private readonly client: SolveClient, private readonly store: ClientStore, private readonly hash: (text: string) => Promise<string>, private readonly uuid: () => string) {}
  async forget(sessionId: string) { await this.store.remove(`pending-run.${z.uuid().parse(sessionId)}`); }
  async recover(sessionId: string) {
    const storageKey = `pending-run.${z.uuid().parse(sessionId)}`;
    const raw = await this.store.get(storageKey); if (!raw) return null;
    const pending = PendingSchema.parse(JSON.parse(raw));
    const result = await this.client.request(`/sessions/${pending.sessionId}/submissions/${pending.key}`, RunViewSchema.nullable());
    if (result) await this.store.remove(storageKey);
    return result;
  }
  async submit(sessionId: string, message: string, context?: RunContext) {
    const storageKey = `pending-run.${z.uuid().parse(sessionId)}`;
    if (this.busy) throw new Error("正在提交，请稍候。"); this.busy = true;
    try {
      const payload = CreateRunSchema.parse({ schemaVersion: 1, message, ...(context ? { context } : {}) });
      const fingerprint = await this.hash(JSON.stringify(payload)); const raw = await this.store.get(storageKey);
      let previous: z.infer<typeof PendingSchema> | null = null;
      if (raw) { try { previous = PendingSchema.parse(JSON.parse(raw)); } catch { throw new Error("待确认的提交记录损坏，请先查看历史题目。"); } }
      if (previous && (previous.sessionId !== sessionId || previous.fingerprint !== fingerprint)) throw new Error("上次提交结果尚未确认，请先刷新这道题，或使用原内容重试。");
      const pending = previous?.sessionId === sessionId && previous.fingerprint === fingerprint ? previous : PendingSchema.parse({ sessionId, fingerprint, key: this.uuid() });
      await this.store.set(storageKey, JSON.stringify(pending));
      const run = await this.client.request(`/sessions/${sessionId}/runs`, RunViewSchema, { ...jsonRequest(payload), headers: { "Content-Type": "application/json", "Idempotency-Key": pending.key } });
      await this.store.remove(storageKey); return run;
    } catch (error) {
      // A structured non-500 rejection confirms that no new run was accepted.
      if (error instanceof ClientError && !["INTERNAL_ERROR", "NETWORK_ERROR"].includes(error.code)) await this.store.remove(storageKey);
      throw error;
    } finally { this.busy = false; }
  }
}
