import { RunViewSchema, terminal, type RunView } from "@solveflow/contracts/http";
import { type SolveClient } from "./client.js";
function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted(); const timer = setTimeout(done, ms);
    function done() { signal.removeEventListener("abort", abort); resolve(); }
    function abort() { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(signal.reason); }
    signal.addEventListener("abort", abort, { once: true });
  });
}
/** Foreground-only transport. Reconnect reads snapshots, never submits/cancels a run. */
export async function watchRun(client: SolveClient, initial: RunView, signal: AbortSignal, update: (run: RunView) => void, connection: (text: string) => void) {
  let current = initial;
  for (let attempt = 0; attempt < 8 && !signal.aborted; attempt++) {
    try {
      current = await client.request(`/runs/${initial.id}`, RunViewSchema, { signal });
      signal.throwIfAborted(); update(current);
      if (terminal(current.status)) { connection(""); return; }
      connection("");
      await client.events(current.id, current.seq, signal, event => {
        if (event.type === "run.status") { current = { ...current, seq: event.seq, status: event.status }; update(current); }
        else if (event.type === "answer.final") { current = { ...current, seq: event.seq, outcome: event.result, status: event.result.status }; update(current); }
        else if (event.type === "run.done") current = { ...current, seq: event.seq, status: event.status };
      });
      current = await client.request(`/runs/${initial.id}`, RunViewSchema, { signal }); signal.throwIfAborted(); update(current);
      if (terminal(current.status)) { connection(""); return; }
    } catch { if (signal.aborted) return; }
    connection("网络连接恢复中，解题仍在继续…"); await delay(Math.min(1000 * 2 ** attempt, 8000), signal);
  }
  if (!signal.aborted) connection("暂时无法连接，请点击刷新进度。已提交的任务不会重复执行。");
}
