import type { Server } from 'node:http';
import type { WebEnv } from './web-env.mjs';
import type { WebModelSettings } from './web-model-settings.mjs';
export type WebModelDiagnostic = { type: 'web.model'; timestamp: string; role: 'solver' | 'verifier' | 'backup'; status: 'completed' | 'failed' | 'cancelled'; reason: 'completed' | 'upstream_http' | 'upstream_empty' | 'upstream_network' | 'client_disconnect' | 'timeout' | 'response_limit'; upstreamStatus?: number; upstreamHeadersMs?: number; firstByteMs?: number; receivedBytes: number; elapsedMs: number; transportCode?: string };
export function webServer(directory: string, apiPort?: number | null, environment?: WebEnv | null, modelFetch?: typeof fetch, onModelDiagnostic?: (entry: WebModelDiagnostic) => void, modelSettings?: WebModelSettings | null): Server;
