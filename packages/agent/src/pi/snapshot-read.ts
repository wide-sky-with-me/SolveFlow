import { createReadToolDefinition, truncateHead, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import { ReadSnapshot } from "../policy/read-snapshot.js";
import { RunBudget } from "../policy/run-budget.js";

const input = z.strictObject({
  path: z.string().min(1).max(4096),
  offset: z.number().int().min(1).max(65536).optional(),
  limit: z.number().int().min(1).max(2000).optional(),
});

/** Keep SDK read schema/Skill semantics; replace execute entirely because SDK
 * resolveReadPathAsync probes host fs before its pluggable operations. */
export function createSnapshotRead(snapshot: ReadSnapshot, owner: string, budget: RunBudget) {
  const definition = createReadToolDefinition(snapshot.root);
  const tool: ToolDefinition = {
    name: definition.name,
    label: definition.label,
    parameters: definition.parameters,
    description: "Read approved Skill/reference text. Supports relative or absolute paths and 1-indexed offset/limit. No host files or images. Output is bounded; continue with offset when truncated.",
    async execute(_id, raw, signal) {
      const activeSignal = signal ?? new AbortController().signal;
      budget.reserveTool("file", activeSignal);
      const { path, offset = 1, limit } = input.parse(raw);
      const lines = snapshot.read(path, owner, activeSignal).split("\n");
      if (offset > lines.length) throw new Error("OFFSET_OUT_OF_RANGE");
      const selected = lines.slice(offset - 1, limit === undefined ? undefined : offset - 1 + limit).join("\n");
      const truncated = truncateHead(selected, { maxBytes: 30 * 1024, maxLines: 2000 });
      if (truncated.firstLineExceedsLimit) throw new Error("RESOURCE_LINE_TOO_LARGE");
      const next = offset + truncated.outputLines;
      const more = next <= lines.length;
      const text = truncated.content + (more ? `\n\n[Showing lines ${offset}-${next - 1} of ${lines.length}. Use offset=${next} to continue.]` : "");
      activeSignal.throwIfAborted();
      budget.assertActive(activeSignal);
      const result = { content: [{ type: "text" as const, text }], details: truncated.truncated ? { truncation: truncated } : undefined };
      if (Buffer.byteLength(JSON.stringify(result), "utf8") > 32 * 1024) throw new Error("RESOURCE_OUTPUT_TOO_LARGE");
      return result;
    },
  };
  return tool;
}
