import type { ModelConnections } from "@solveflow/contracts/model";
export function startOfflineProbeProvider(options?: { scenario?: "pass" | "diagram" | "missing-learning" | "fail-pass" | "fail-fail" | "unknown" | "policy" | "clarification" | "unavailable" | "invalid-json" }): Promise<{
  baseURL: string;
  observations: { requests: number; images: number; verifierWithoutTools: number; calculations: number; diagramReads: number };
  close(): Promise<void>;
}>;
export function offlineModelConnections(baseURL: string): ModelConnections;
