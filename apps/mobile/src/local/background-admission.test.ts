import { expect, it, vi } from 'vitest';
import { BackgroundAdmission } from './background-admission';
it('finishes expiration cleanup before a foreground event may resume the waiting queue', async () => {
  const pause = vi.fn(); let release = () => {}; const done = new Promise<void>(resolve => { release = resolve; });
  const cancel = vi.fn(async () => { await done; }); const control = new BackgroundAdmission(pause, cancel);
  control.setForeground(false); expect(pause).toHaveBeenLastCalledWith(true);
  const expired = control.expire(['a','b']); control.setForeground(true); expect(pause).toHaveBeenLastCalledWith(true); expect(cancel).toHaveBeenCalledTimes(2);
  release(); await expired; expect(pause).toHaveBeenLastCalledWith(false);
});
