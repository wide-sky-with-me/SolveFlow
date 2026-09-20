import { z } from "zod";
import { ReadOnlyMcpClient } from "./read-only-client.js";
import type { RunIdentity } from "../policy/capability-snapshot.js";

const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
const bindingSchema = z.strictObject({ ownerId: id, runId: id, server: z.string().regex(/^[a-z][a-z0-9-]{0,23}$/), credentialVersion: id });
export type McpConnectionBinding = z.infer<typeof bindingSchema>;

/** Single-run owned handle, not a pool. Trusted server composition supplies connect:
 * it MUST select credentials from the immutable binding and clean up failed init.
 * Labels cannot prove the factory used the right secret. Never construct bindings
 * from model/client owner fields. Noncooperative cleanup still needs isolation. */
export class RunMcpConnection {
  readonly #binding: Readonly<McpConnectionBinding>;
  readonly #client: ReadOnlyMcpClient;
  #closed = false;
  #closing: Promise<void> | undefined;
  private constructor(binding: McpConnectionBinding, client: ReadOnlyMcpClient) {
    this.#binding = Object.freeze(binding);
    this.#client = client;
    Object.freeze(this);
  }
  static async open(binding: McpConnectionBinding, connect: (binding: Readonly<McpConnectionBinding>, signal: AbortSignal) => Promise<ReadOnlyMcpClient>, signal: AbortSignal): Promise<RunMcpConnection> {
    const parsed = bindingSchema.safeParse(binding);
    if (!parsed.success) throw new Error("MCP_INVALID_BINDING");
    const immutable = Object.freeze(parsed.data);
    signal.throwIfAborted();
    const client = await connect(immutable, signal);
    // Never close another run's client on a duplicate claim.
    client.claimForRun();
    if (signal.aborted) { await client.close(); signal.throwIfAborted(); }
    return new RunMcpConnection(immutable, client);
  }
  assertBinding(identity: RunIdentity, server: string, credentialVersion: string): void {
    if (this.#closed) throw new Error("MCP_CONNECTION_CLOSED");
    const expected = this.#binding;
    if (expected.ownerId !== identity.ownerId || expected.runId !== identity.runId || expected.server !== server || expected.credentialVersion !== credentialVersion) throw new Error("MCP_CONNECTION_IDENTITY_MISMATCH");
  }
  names(): readonly string[] { return this.#client.names(); }
  async call(name: string, input: unknown, signal: AbortSignal, timeoutMs: number) {
    if (this.#closed) throw new Error("MCP_CONNECTION_CLOSED");
    return this.#client.call(name, input, signal, timeoutMs);
  }
  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    this.#closing = this.#client.close();
    return this.#closing;
  }
}
