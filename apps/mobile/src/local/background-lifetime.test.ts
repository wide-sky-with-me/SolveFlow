import { expect, it } from 'vitest';
import { MAX_LOCAL_MODEL_RUNS } from '@solveflow/contracts/local';
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
it('protects the maximum combined solver/verifier concurrency and rejects overflow without releasing other jobs', async () => {
  const ids = Array.from({ length: MAX_LOCAL_MODEL_RUNS }, (_, i) => String(i + 1));
  const lifetime = new BackgroundLifetime(); for (const id of ids) lifetime.begin(id);
  expect(() => lifetime.begin('overflow')).toThrow(); const finished: string[] = [];
  const waits = ids.map(id => lifetime.wait(id).then(() => { finished.push(id); }));
  lifetime.end('2'); await Promise.resolve(); expect(finished).toEqual(['2']); lifetime.begin('replacement');
  for (const id of [...ids.filter(id => id !== '2'), 'replacement']) lifetime.end(id); await Promise.all(waits);
  expect(finished).toHaveLength(MAX_LOCAL_MODEL_RUNS);
});
