import type { WebEnvironment, WebModelUpdate, LocalModelProfile } from '@solveflow/contracts/local';
import type { LocalFetch } from '@solveflow/agent/mobile';
import type { ModelPresetAction } from './model-preset-action';
export async function loadWebEnvironment(_transport: LocalFetch): Promise<WebEnvironment | null> { return null; }
export function webModelFetch(_environment: WebEnvironment | null, transport: LocalFetch): LocalFetch { return transport; }
export async function saveWebModelSettings(_environment: WebEnvironment, _value: WebModelUpdate, _transport: LocalFetch): Promise<WebEnvironment> { throw new Error('当前平台不使用 Web 环境配置。'); }
export async function mutateWebModelPresets(_environment: WebEnvironment, _action: ModelPresetAction, _transport: LocalFetch): Promise<WebEnvironment> { throw new Error('当前平台不使用 Web 配置预设。'); }
export function webModelTestFetch(_environment: WebEnvironment | null, _role: 'solver' | 'verifier' | 'backup', _profile: LocalModelProfile, _key: string, transport: LocalFetch, _presetId?: string): LocalFetch { return transport; }
