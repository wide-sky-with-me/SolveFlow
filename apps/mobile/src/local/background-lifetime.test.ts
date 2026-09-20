import { expect, it } from 'vitest';
import { BackgroundLifetime } from './background-lifetime';
it('keeps the registered headless task pending until the same solve is stopped', async () => {
  const lifetime = new BackgroundLifetime(); lifetime.begin('first'); let finished = false;
  const running = lifetime.wait('first').then(() => { finished = true; });
  await Promise.resolve(); expect(finished).toBe(false);
  lifetime.end('other'); await Promise.resolve(); expect(finished).toBe(false);
  expect(() => lifetime.begin('second')).toThrow();
  lifetime.end('first'); await running; expect(finished).toBe(true);
  lifetime.begin('second'); lifetime.end('first'); let secondDone = false;
  const second = lifetime.wait('second').then(() => { secondDone = true; });
  await Promise.resolve(); expect(secondDone).toBe(false); lifetime.end('second'); await second;
});
it('does not restart an unknown or already finished native task', async () => {
  const lifetime = new BackgroundLifetime(); await lifetime.wait('unknown');
  lifetime.begin('run'); lifetime.end('run'); lifetime.end('run'); await lifetime.wait('run');
  lifetime.begin('next'); lifetime.end('next');
});
