import type { WebModelUpdate } from '@solveflow/contracts/local';
export type ModelPresetAction = { kind: 'create'; name: string; configuration: WebModelUpdate } | { kind: 'activate' | 'remove'; id: string };
