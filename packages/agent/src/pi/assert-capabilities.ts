import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { CapabilitySnapshot, schemaHash } from "../policy/capability-snapshot.js";

type EffectiveTool = AgentSession["agent"]["state"]["tools"][number];
const sealed = new WeakMap<AgentSession, {
  snapshot: CapabilitySnapshot;
  tools: Map<string, { tool: EffectiveTool; execute: EffectiveTool["execute"]; hash: string }>;
}>();

/** First invocation seals the trusted constructor output, before exposing the session.
 * Later calls compare BOTH SDK registry metadata and actual loop execution bindings. */
export function assertSessionCapabilities(session: AgentSession, snapshot: CapabilitySnapshot): void {
  const effective = session.agent.state.tools;
  const active = new Set(effective.map(tool => tool.name));
  if (active.size !== effective.length) throw new Error("CAPABILITY_MISMATCH");
  const registered = session.getAllTools().filter(tool => active.has(tool.name));
  if (registered.length !== active.size) throw new Error("CAPABILITY_MISMATCH");
  snapshot.assertRegistered(registered.map(tool => ({ name: tool.name, source: tool.sourceInfo.path, schema: tool.parameters })));
  const prior = sealed.get(session);
  if (prior && prior.snapshot !== snapshot) throw new Error("CAPABILITY_MISMATCH");
  const bindings = new Map<string, { tool: EffectiveTool; execute: EffectiveTool["execute"]; hash: string }>();
  for (const tool of effective) {
    const metadata = registered.find(entry => entry.name === tool.name);
    const hash = schemaHash(tool.parameters);
    if (!metadata || hash !== schemaHash(metadata.parameters)) throw new Error("CAPABILITY_MISMATCH");
    const binding = prior?.tools.get(tool.name);
    if (prior && (!binding || binding.tool !== tool || binding.execute !== tool.execute || binding.hash !== hash)) throw new Error("CAPABILITY_MISMATCH");
    bindings.set(tool.name, { tool, execute: tool.execute, hash });
  }
  if (!prior) sealed.set(session, { snapshot, tools: bindings });
}
