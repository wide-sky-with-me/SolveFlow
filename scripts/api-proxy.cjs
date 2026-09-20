const http = require('node:http');
/** Fixed localhost API upstream; request data never selects a proxy target. */
module.exports = function proxyApi(req, res, port) {
  const upstream = http.request({ host: '127.0.0.1', port, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${port}` } }, response => {
    res.writeHead(response.statusCode ?? 502, response.headers); response.pipe(res);
    response.on('error', () => res.destroy());
  });
  upstream.on('error', () => { if (!res.headersSent) { res.writeHead(502, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ error: { message: '服务暂不可用。' } })); } else res.destroy(); });
  req.on('aborted', () => upstream.destroy()); res.on('close', () => upstream.destroy());
  upstream.setTimeout(135000, () => upstream.destroy()); req.pipe(upstream);
};
