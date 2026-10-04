/* node test/channels.proxy-fetch.test.js -- Bot API proxy routing without a new runtime dependency. */
'use strict';
const http = require('http');
const A = require('./_assert.js');
const { makeEnvironmentProxyFetch, proxyUrlFor, parseProxy, shouldBypassProxy } = require('../sidecar/channels/proxy-fetch.js');

function listen(server) { return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port))); }
function close(server) { return new Promise(resolve => server.close(resolve)); }

(async () => {
  A.eq(proxyUrlFor('https:', { HTTPS_PROXY: 'http://secure-proxy:8080', HTTP_PROXY: 'http://plain-proxy:8080' }), 'http://secure-proxy:8080', 'HTTPS prefers HTTPS_PROXY');
  A.eq(proxyUrlFor('http:', { HTTPS_PROXY: 'http://secure-proxy:8080', HTTP_PROXY: 'http://plain-proxy:8080' }), 'http://plain-proxy:8080', 'HTTP prefers HTTP_PROXY');
  A.eq(parseProxy('proxy.local:3128').href, 'http://proxy.local:3128/', 'a scheme-less corporate proxy defaults to http');
  A.eq(parseProxy('socks5://proxy.local:1080'), null, 'unsupported proxy schemes fail closed rather than bypassing the proxy');
  A.ok(shouldBypassProxy('api.telegram.org', '.telegram.org'), 'NO_PROXY domain suffix bypasses the proxy');
  A.ok(shouldBypassProxy('localhost', 'localhost'), 'NO_PROXY exact host bypasses the proxy');

  let directCalls = 0;
  const direct = async () => { directCalls++; return { ok: true, status: 200, json: async () => ({ direct: true }) }; };
  const noProxyFetch = makeEnvironmentProxyFetch(direct, {});
  A.eq((await noProxyFetch('https://api.telegram.org/botX/getMe')).ok, true, 'no proxy configuration preserves injected fetch');
  const bypassFetch = makeEnvironmentProxyFetch(direct, { HTTP_PROXY: 'http://ignored:8080', NO_PROXY: 'api.telegram.org' });
  await bypassFetch('http://api.telegram.org/botX/getMe');
  A.eq(directCalls, 2, 'NO_PROXY preserves direct fetch for the selected host');

  let seen = null;
  const proxy = http.createServer((req, res) => {
    seen = { url: req.url, method: req.method, host: req.headers.host };
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      seen.body = Buffer.concat(chunks).toString('utf8');
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': '31' });
      res.end(JSON.stringify({ ok: true, throughProxy: true }));
    });
  });
  const port = await listen(proxy);
  try {
    const viaProxy = makeEnvironmentProxyFetch(direct, { HTTP_PROXY: 'http://127.0.0.1:' + port });
    const response = await viaProxy('http://example.test/botSECRET/sendMessage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"chat_id":"1"}' });
    A.eq(response.ok, true, 'HTTP proxy response keeps fetch ok semantics');
    A.eq(await response.json(), { ok: true, throughProxy: true }, 'HTTP proxy response supplies fetch json()');
    A.eq(response.headers.get('content-length'), '31', 'HTTP proxy response supplies fetch-style headers.get()');
    A.eq(seen.url, 'http://example.test/botSECRET/sendMessage', 'forward proxy receives the absolute request URL');
    A.eq(seen.method, 'POST', 'request method rides through the proxy');
    A.eq(seen.body, '{"chat_id":"1"}', 'JSON body rides through the proxy byte-for-byte');
    A.eq(directCalls, 2, 'configured proxy does not silently bypass to direct fetch');
  } finally { await close(proxy); }

  const invalid = makeEnvironmentProxyFetch(direct, { HTTPS_PROXY: 'socks5://proxy.local:1080' });
  let error = null;
  try { await invalid('https://api.telegram.org/botSECRET/getMe'); } catch (e) { error = e; }
  A.ok(error && /proxy URL must use http or https/.test(error.message), 'invalid proxy config fails closed without exposing the request URL/token');
  A.ok(!/SECRET/.test(error.message), 'proxy errors never echo the Bot API URL/token');

  A.report('channels.proxy-fetch.test');
})().catch(e => { console.log('FAIL: ' + (e && e.stack || e)); process.exit(1); });
