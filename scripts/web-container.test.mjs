import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { startWebContainer, containerEnvironment, containerConcurrency } from './web-container.mjs';
const profile = { provider: 'fixture', baseURL: 'https://fixture.invalid/v1', model: 'fixture-model', api: 'openai-completions', contextWindow: 32768, maxTokens: 1024, maxTokensField: 'max_tokens' };
const configuration = { schemaVersion: 1, models: { solver: profile, verifier: null, backup: null }, keys: { solver: 'fixture-private-model-key', verifier: null, backup: null } };
async function running(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'solveflow-container-')); const directory = join(root, 'web'); const stateDirectory = join(root, 'state');
  await mkdir(directory); await mkdir(stateDirectory, { mode: 0o700 }); await writeFile(join(directory, 'index.html'), '<!doctype html><title>fixture</title>');
  await writeFile(join(stateDirectory, 'web-model-settings.json'), JSON.stringify(configuration), { mode: 0o600 });
  let calls = 0;
  const { server, environment } = await startWebContainer({ directory, stateDirectory, port: 0, host: '127.0.0.1', ...options, transport: async () => { calls++; return new Response('{}', { headers: { 'content-type': 'application/json' } }); } });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true }); });
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, server, environment, stateDirectory, calls: () => calls };
}
test('bootstrap carries role tokens but never the model key', () => {
  const environment = containerEnvironment(configuration);
  assert.equal(environment.roles.solver.key, configuration.keys.solver);
  assert.equal(JSON.stringify(environment.bootstrap).includes(configuration.keys.solver), false);
  assert.equal(environment.bootstrap.accessTokens.solver.length, 64);
});
test('deployment concurrency is optional and follows shared integer bounds', () => {
  assert.equal(containerConcurrency({}), null);
  assert.deepEqual(containerConcurrency({ SOLVEFLOW_WEB_SOLVER_CONCURRENCY: '16', SOLVEFLOW_WEB_VERIFIER_CONCURRENCY: '16' }), { solver: 16, verifier: 16 });
  assert.deepEqual(containerConcurrency({ SOLVEFLOW_WEB_SOLVER_CONCURRENCY: '64', SOLVEFLOW_WEB_VERIFIER_CONCURRENCY: '64' }), { solver: 64, verifier: 64 });
  assert.deepEqual(containerConcurrency({ SOLVEFLOW_WEB_SOLVER_CONCURRENCY: '12' }), { solver: 12, verifier: 8 });
  for (const value of ['', '0', '65', '1.5', 'invalid']) {
    for (const role of ['SOLVER', 'VERIFIER']) assert.throws(() => containerConcurrency({ [`SOLVEFLOW_WEB_${role}_CONCURRENCY`]: value }));
  }
});
test('deployment concurrency survives loading and editing private model settings without persisting it as a model', async t => {
  const concurrency = { solver: 16, verifier: 16 }; const app = await running(t, { concurrency });
  const read = async () => (await (await fetch(`${app.url}/__solveflow/web-env`)).json()).settings.concurrency;
  assert.deepEqual(await read(), concurrency);
  const response = await fetch(`${app.url}/__solveflow/web-env/settings`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${app.environment.roles.solver.token}` }, body: JSON.stringify({ ...configuration, keys: { solver: null, verifier: null, backup: null } }) });
  assert.equal(response.status, 200); assert.deepEqual((await response.json()).settings.concurrency, concurrency);
  assert.deepEqual(await read(), concurrency);
  assert.deepEqual(JSON.parse(await readFile(join(app.stateDirectory, 'web-model-settings.json'), 'utf8')), configuration);
  assert.equal(app.calls(), 0);
});
test('missing or invalid persistent model settings fail startup', async t => {
  const root = await mkdtemp(join(tmpdir(), 'solveflow-container-invalid-')); t.after(() => rm(root, { recursive: true }));
  await assert.rejects(startWebContainer({ directory: root, stateDirectory: root, port: 0 }));
  await writeFile(join(root, 'web-model-settings.json'), '{"schemaVersion":1}');
  await assert.rejects(startWebContainer({ directory: root, stateDirectory: root, port: 0 }));
});
test('static and environment requests make no model calls; unknown API stays closed', async t => {
  const app = await running(t);
  assert.equal(app.server.requestTimeout, 130000); assert.equal(app.server.headersTimeout, 10000);
  assert.equal((await fetch(app.url)).status, 200);
  const environment = await (await fetch(`${app.url}/__solveflow/web-env`)).json();
  assert.equal(environment.canEditModels, true); assert.equal(JSON.stringify(environment).includes(configuration.keys.solver), false);
  assert.equal((await fetch(`${app.url}/api/v1/sessions`)).status, 404); assert.equal(app.calls(), 0);
});
test('external Host and cross-origin requests never reach models', async t => {
  const app = await running(t);
  const status = await new Promise((accept, reject) => {
    const request = httpRequest(`${app.url}/__solveflow/web-env`, { headers: { host: `100.88.228.28:${app.server.address().port}` } }, response => { response.resume(); accept(response.statusCode); });
    request.on('error', reject); request.end();
  });
  assert.equal(status, 403);
  assert.equal((await fetch(`${app.url}/__solveflow/web-env`, { headers: { origin: 'https://external.invalid' } })).status, 403);
  assert.equal(app.calls(), 0);
});
test('model settings persist atomically without returning keys', async t => {
  const app = await running(t); const models = { ...configuration.models, solver: { ...profile, model: 'updated-fixture' } };
  const response = await fetch(`${app.url}/__solveflow/web-env/settings`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${app.environment.roles.solver.token}` }, body: JSON.stringify({ schemaVersion: 1, models, keys: { solver: null, verifier: null, backup: null } }) });
  assert.equal(response.status, 200); assert.equal((await response.text()).includes(configuration.keys.solver), false);
  const saved = JSON.parse(await readFile(join(app.stateDirectory, 'web-model-settings.json'), 'utf8'));
  assert.equal(saved.models.solver.model, 'updated-fixture'); assert.equal(saved.keys.solver, configuration.keys.solver); assert.equal(app.calls(), 0);
});
test('private HTTPS origin works while cross-site and spoofed forwarded headers stay blocked', async t => {
  const origin = 'https://fixture.tailnet.ts.net'; const app = await running(t, { publicOrigin: origin });
  const check = headers => new Promise((accept, reject) => {
    const request = httpRequest(`${app.url}/__solveflow/web-env`, { headers }, response => { response.resume(); accept(response.statusCode); });
    request.on('error', reject); request.end();
  });
  assert.equal(await check({ host: 'fixture.tailnet.ts.net', origin, 'sec-fetch-site': 'same-origin' }), 200);
  assert.equal(await check({ host: 'fixture.tailnet.ts.net', origin: 'https://external.invalid' }), 403);
  assert.equal(await check({ host: 'fixture.tailnet.ts.net', origin, 'sec-fetch-site': 'cross-site' }), 403);
  assert.equal(await check({ host: 'external.invalid', 'x-forwarded-host': 'fixture.tailnet.ts.net', 'x-forwarded-proto': 'https' }), 403);
  assert.equal(app.calls(), 0);
});
