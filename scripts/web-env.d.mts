import type { WebEnvironment, LocalModelProfile } from '../packages/contracts/src/local.js';
export type WebEnvRole = { profile: LocalModelProfile; key: string; token: string };
export type WebEnv = { bootstrap: WebEnvironment; roles: { solver: WebEnvRole; verifier: WebEnvRole | null; backup: WebEnvRole | null } };
export function loadWebEnv(file: string | URL, overrides?: Record<string, string | undefined>): Promise<WebEnv | null>;
