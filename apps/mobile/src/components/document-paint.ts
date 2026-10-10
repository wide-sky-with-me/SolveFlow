import { NativeModules, Platform } from 'react-native';
import { z } from 'zod';

const moduleSchema = z.object({
  waitForPaint: z.custom<(tag: number, id: number) => Promise<unknown>>(value => typeof value === 'function'),
  cancel: z.custom<(id: number) => void>(value => typeof value === 'function'),
});
let nextRequest = 0;

/** Native compositor acknowledgement follows the measured WebView layout. */
// Decision: .agents/notes/implemented/rendering/2026-10-03-native-question-paint.md
export function waitForDocumentPaint(tag: number | null, ready: () => void, failed: () => void) {
  let alive = true; let cancelNative: (() => void) | undefined;
  let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => {
    if (!alive) return;
    if (Platform.OS !== 'android') { ready(); return; }
    if (tag === null) return; // onLoadEnd or the existing document deadline resolves this.
    try {
      const module = moduleSchema.parse(NativeModules.SolveDocument);
      nextRequest = nextRequest >= 2_000_000_000 ? 1 : nextRequest + 1;
      const id = nextRequest;
      cancelNative = () => module.cancel(id);
      void module.waitForPaint(tag, id).then(() => { if (alive) ready(); }, () => { if (alive) failed(); });
    } catch { if (alive) failed(); }
  }); });
  return () => { alive = false; cancelAnimationFrame(frame); cancelNative?.(); };
}
