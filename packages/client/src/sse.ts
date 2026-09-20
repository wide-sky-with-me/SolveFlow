import { parseRunEvent, type RunEvent } from "@solveflow/contracts/http";
/** Incremental UTF-8 SSE framing with bounded memory; accepts CRLF and multi-line data. */
export class RunEventDecoder {
  private decoder = new TextDecoder(); private buffer = ""; private total = 0;
  constructor(private readonly runId: string, private cursor = 0) {}
  push(chunk: Uint8Array): RunEvent[] {
    this.total += chunk.byteLength;
    if (this.total > 2 * 1024 * 1024) throw new Error("进度数据超出限制，请重新连接。");
    this.buffer += this.decoder.decode(chunk, { stream: true });
    const events: RunEvent[] = [];
    let boundary: RegExpExecArray | null;
    while ((boundary = /\r?\n\r?\n/.exec(this.buffer))) {
      const block = this.buffer.slice(0, boundary.index); this.buffer = this.buffer.slice(boundary.index + boundary[0].length);
      if (block.length > 128 * 1024) throw new Error("进度事件过大。");
      const data = block.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).replace(/^ /, "")).join("\n");
      if (!data) continue;
      const event = parseRunEvent(JSON.parse(data));
      if (event.runId !== this.runId) throw new Error("进度与当前题目不匹配。");
      if (event.seq <= this.cursor) continue;
      this.cursor = event.seq; events.push(event);
    }
    if (this.buffer.length > 128 * 1024) throw new Error("进度事件过大。");
    return events;
  }
}
