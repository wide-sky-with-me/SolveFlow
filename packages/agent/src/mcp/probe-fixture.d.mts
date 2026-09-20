import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
export const emptySchema: Tool["inputSchema"];
export const echoSchema: Tool["inputSchema"];
export function createProbeServer(): {
  server: Server;
  state: { calls: number; started: number; cancelled: number; active: number };
  stop(): void;
};
