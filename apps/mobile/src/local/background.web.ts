export const background = { canContinue: false, keepAliveWhileWaiting: false, scheduleTimeout(callback: () => void, ms: number) { const id = setTimeout(callback, ms); return () => clearTimeout(id); }, async start(_id: string) {}, async stop(_id: string) {} };
export function onBackgroundExpired(_callback: (runIds: readonly string[]) => void) {}
