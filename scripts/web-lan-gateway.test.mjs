import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { privateIPv4, lanGateway } from './web-lan-gateway.mjs';
const host = '192.168.100.84:3130'; const origin = `http://${host}`;
async function fixture(t, handleRequest = null) {
  let calls = 0;
  const upstream = createServer(async (req, res) => { calls++; let body = ''; for await (const chunk of req) body += chunk; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ headers: req.headers, body, method: req.method })); });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const proxy = lanGateway({ address: '192.168.100.84', port: 3130, upstreamPort: upstream.address().port, handleRequest });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  t.after(async () => { for (const server of [proxy, upstream]) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } });
  const send = (headers, body = '', method = 'GET', path = '/__solveflow/web-env') => new Promise((accept, reject) => {
    const req = request({ host: '127.0.0.1', port: proxy.address().port, path, method, headers }, response => { let data = ''; response.on('data', chunk => data += chunk); response.on('end', () => accept({ status: response.statusCode, data })); });
    req.on('error', reject); req.end(body);
  });
  return { send, calls: () => calls, upstreamPort: upstream.address().port };
}
test('LAN addresses are restricted to canonical private IPv4', () => {
  for (const value of ['10.1.2.3', '172.16.0.1', '172.31.255.2', '192.168.100.84']) assert.equal(privateIPv4(value), true);
  for (const value of ['100.88.228.28', '8.8.8.8', '0.0.0.0', '127.0.0.1', '172.32.0.1', '192.168.1.999', '192.168.001.1']) assert.equal(privateIPv4(value), false);
  assert.throws(() => lanGateway({ address: '0.0.0.0', port: 3130 }));
});
test('fixed LAN same-origin forwarding preserves body and role authorization', async t => {
  const app = await fixture(t);
  const result = await app.send({ host, origin, 'sec-fetch-site': 'same-origin', authorization: 'Bearer fixture-token', 'x-forwarded-host': 'external.invalid' }, '{"fixture":true}', 'POST');
  assert.equal(result.status, 200); const body = JSON.parse(result.data);
  assert.equal(body.headers.host, `127.0.0.1:${app.upstreamPort}`); assert.equal(body.headers.origin, `http://127.0.0.1:${app.upstreamPort}`);
  assert.equal(body.headers.authorization, 'Bearer fixture-token'); assert.equal(body.headers['x-forwarded-host'], undefined); assert.equal(body.body, '{"fixture":true}'); assert.equal(body.method, 'POST');
});
test('external Host, Origin, and cross-site requests stop before forwarding', async t => {
  const app = await fixture(t);
  for (const headers of [{ host: 'external.invalid' }, { host, origin: 'http://external.invalid' }, { host, origin, 'sec-fetch-site': 'cross-site' }]) assert.equal((await app.send(headers)).status, 403);
  assert.equal(app.calls(), 0);
});
test('missing Origin is accepted only with the exact LAN host', async t => {
  const app = await fixture(t); assert.equal((await app.send({ host })).status, 200); assert.equal(app.calls(), 1);
});
test('cross-site links may open the home document but are normalized before the loopback bridge', async t => {
  const app = await fixture(t);
  for (const site of ['cross-site', 'same-site']) {
    const result = await app.send({ host, 'sec-fetch-site': site, 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' }, '', 'GET', '/?from=link');
    assert.equal(result.status, 200);
    assert.equal(JSON.parse(result.data).headers['sec-fetch-site'], 'none');
  }
});
test('home navigation exemption does not cover model routes, writes, iframes or foreign Origin', async t => {
  const app = await fixture(t);
  const navigation = { host, 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' };
  for (const [headers, method, path] of [
    [navigation, 'GET', '/__solveflow/web-env'],
    [navigation, 'POST', '/'],
    [{ ...navigation, 'sec-fetch-dest': 'iframe' }, 'GET', '/'],
    [{ ...navigation, 'sec-fetch-mode': 'cors' }, 'GET', '/'],
    [{ ...navigation, origin: 'https://external.invalid' }, 'GET', '/'],
    [{ ...navigation, host: 'external.invalid' }, 'GET', '/'],
  ]) assert.equal((await app.send(headers, '', method, path)).status, 403);
  assert.equal(app.calls(), 0);
});
test('deployment handlers run only after the fixed host and origin gate', async t => {
  let handled = 0;
  const app = await fixture(t, (_req, res) => { handled++; res.writeHead(200); res.end('fixture'); return true; });
  for (const headers of [{ host: 'external.invalid' }, { host, origin: 'http://external.invalid' }, { host, 'sec-fetch-site': 'cross-site' }]) assert.equal((await app.send(headers)).status, 403);
  assert.equal(handled, 0);
  assert.equal((await app.send({ host, 'sec-fetch-site': 'same-origin' })).status, 200);
  assert.equal(handled, 1);
  assert.equal(app.calls(), 0);
});
