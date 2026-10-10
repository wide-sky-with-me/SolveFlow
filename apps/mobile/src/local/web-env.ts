import type { WebEnvironment } from '@solveflow/contracts/local';
import type { LocalFetch } from '@solveflow/agent/mobile';
export async function loadWebEnvironment(_transport: LocalFetch): Promise<WebEnvironment | null> { return null; }
export function webModelFetch(_environment: WebEnvironment | null, transport: LocalFetch): LocalFetch { return transport; }
