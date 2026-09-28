import { expect, it } from 'vitest';
import { BackgroundLifetime } from './background-lifetime';
it('keeps the registered headless task pending until the same solve is stopped', async () => {
  const lifetime = new BackgroundLifetime(); lifetime.begin('first'); let finished = false;
  const running = lifetime.wait('first').then(() => { finished = true; });
  await Promise.resolve(); expect(finished).toBe(false);
  lifetime.end('other'); await Promise.resolve(); expect(finished).toBe(false);
  lifetime.begin('parallel'); lifetime.end('parallel'); expect(() => lifetime.begin('first')).toThrow();
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
it('bounds four live native tasks and ending one preserves the other three', async () => {
  const lifetime = new BackgroundLifetime(); for (const id of ['1', '2', '3', '4']) lifetime.begin(id);
  expect(() => lifetime.begin('5')).toThrow(); const finished: string[] = [];
  const waits = ['1', '2', '3', '4'].map(id => lifetime.wait(id).then(() => { finished.push(id); }));
  lifetime.end('2'); await Promise.resolve(); expect(finished).toEqual(['2']); lifetime.begin('5');
  for (const id of ['1', '3', '4', '5']) lifetime.end(id); await Promise.all(waits);
});
