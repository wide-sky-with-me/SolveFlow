import { BackgroundLifetime } from './background-lifetime';
import { AppRegistry, NativeEventEmitter, NativeModules, PermissionsAndroid, Platform } from 'react-native';
import { z } from 'zod';
import { LocalDiagnosticSchema, type LocalDiagnostic } from '@solveflow/contracts/local';
const lifetime = new BackgroundLifetime();
if (Platform.OS === 'android') AppRegistry.registerHeadlessTask('SolveFlowActive', () => async (value: unknown) => {
  const { runId } = z.strictObject({ runId: z.uuid() }).parse(value);
  await lifetime.wait(runId);
});
let nextTimer = 0;
const moduleSchema = z.object({ armTimer: z.custom<(id: number, ms: number) => void>(v => typeof v === 'function'), cancelTimer: z.custom<(id: number) => void>(v => typeof v === 'function'), start: z.custom<(id: string) => Promise<void>>(v => typeof v === 'function'), stop: z.custom<(id: string) => Promise<void>>(v => typeof v === 'function'), diagnostic: z.custom<(value: string) => void>(v => typeof v === 'function'), addListener: z.custom<(name: string) => void>(v => typeof v === 'function'), removeListeners: z.custom<(count: number) => void>(v => typeof v === 'function') });
function native() { return moduleSchema.parse(NativeModules.SolveBackground); }
let notificationPermission: Promise<unknown> | null = null;
export const background = {
  scheduleTimeout(callback: () => void, ms: number) {
    if (Platform.OS !== 'android') { const id = setTimeout(callback, ms); return () => clearTimeout(id); }
    const id = ++nextTimer; const module = native();
    const listener = new NativeEventEmitter(module).addListener('solvePhaseTimeout', (value: unknown) => { const parsed = z.object({ timerId: z.number() }).safeParse(value); if (parsed.success && parsed.data.timerId === id) callback(); });
    module.armTimer(id, ms);
    return () => { listener.remove(); module.cancelTimer(id); };
  },
  async start(id: string) {
    if (Platform.OS !== 'android') return;
    if (Number(Platform.Version) >= 33) { notificationPermission ??= PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).then(async granted => { if (!granted) await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS); }); await notificationPermission; }
    lifetime.begin(id);
    try { await native().start(id); } catch (error) { lifetime.end(id); throw error; }
  },
  async stop(id: string) { if (Platform.OS === 'android') { try { await native().stop(id); } finally { lifetime.end(id); } } },
  diagnostic(entry: LocalDiagnostic) { if (Platform.OS === 'android') native().diagnostic(JSON.stringify(LocalDiagnosticSchema.parse(entry))); },
};
export function onBackgroundExpired(callback: (runId: string) => void) {
  if (Platform.OS !== 'android') return;
  new NativeEventEmitter(native()).addListener('solveBackgroundExpired', (value: unknown) => { const parsed = z.object({ runId: z.uuid() }).safeParse(value); if (parsed.success) callback(parsed.data.runId); });
}
