import type { WebModelUpdate, WebEnvironment, LocalModelProfile } from '../packages/contracts/src/local.js';
import type { WebEnv, WebEnvRole } from './web-env.mjs';
export type WebModelSettings = { save(value: WebModelUpdate): Promise<WebEnvironment>; resolveRole(role: 'solver' | 'verifier' | 'backup', profile: LocalModelProfile, key: string | null, presetId?: string): WebEnvRole; createPreset(value: { name: string; configuration: WebModelUpdate }): Promise<WebEnvironment>; removePreset(id: string): Promise<WebEnvironment>; activatePreset(id: string): Promise<WebEnvironment> };
export function openWebModelSettings(environment: WebEnv | null, file: string, presetFile?: string): Promise<WebModelSettings | null>;
