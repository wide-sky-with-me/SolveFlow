import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';

const require = createRequire(new URL('../../apps/mobile/package.json', import.meta.url));
const load = (entry: string): Promise<Record<string, unknown>> => import(pathToFileURL(require.resolve(entry)).href);

it('loads the built public entries and preserves exports of the compatibility entry', async () => {
  const legacy = await load('@solveflow/client');
  for (const name of ['local', 'remote', 'learning', 'presentation']) {
    const entry = await load(`@solveflow/client/${name}`);
    expect(Object.keys(entry).length).toBeGreaterThan(0);
    for (const [name, value] of Object.entries(entry)) expect(legacy[name], name).toBe(value);
  }
});
