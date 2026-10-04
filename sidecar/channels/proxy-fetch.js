/* proxy-fetch.js -- a small HTTP(S) forward-proxy fetch bridge for channel transports.

   Node's built-in fetch deliberately ignores HTTP(S)_PROXY. Telegram is a long-lived transport and needs to
   work on a locked-down network, but adding an undeclared dispatcher dependency would make desktop packaging
   fragile. This module keeps the boundary narrow: it implements the subset of fetch the Bot API uses (GET/POST,
   JSON and Buffer bodies, response json/arrayBuffer) and routes HTTPS through CONNECT. It is not installed as a
   global fetch replacement, so unrelated provider traffic cannot silently change network policy. */
'use strict';

const http = require('http');
const https = require('https');
const tls = require('tls');

function envValue(env, names) {
  const e = env || {};
  for (const name of names) {
    const v = String(e[name] == null ? '' : e[name]).trim();
    if (v) return v;
  }
  return '';
}

function proxyUrlFor(protocol, env) {
  return protocol === 'https:'
    ? envValue(env, ['HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy'])
    : envValue(env, ['HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']);
}

function parseProxy(raw) {
  const source = String(raw || '').trim();
  if (!source) return null;
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(source) ? source : ('http://' + source)); }
  catch (_) { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!u.hostname) return null;
  return u;
}

function shouldBypassProxy(host, noProxy) {
  const h = String(host || '').replace(/^\[|\]$/g, '').toLowerCase();
  const entries = String(noProxy || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  for (let entry of entries) {
    if (entry === '*') return true;
    entry = entry.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const colon = entry.lastIndexOf(':');
    if (colon > 0 && entry.indexOf(':') === colon) entry = entry.slice(0, colon);
    if (!entry) continue;
    if (entry[0] === '.') { if (h.endsWith(entry) || h === entry.slice(1)) return true; }
    else if (h === entry || h.endsWith('.' + entry)) return true;
  }
  return false;
}

function headerObject(raw) {
  const out = Object.create(null);
  if (!raw) return out;
  if (typeof raw.forEach === 'function') {
    raw.forEach((v, k) => { out[String(k)] = String(v); });
    return out;
  }
  for (const k of Object.keys(raw)) out[String(k)] = String(raw[k]);
  return out;
}

function responseHeaders(raw) {
  const lower = Object.create(null);
  for (const k of Object.keys(raw || {})) lower[String(k).toLowerCase()] = Array.isArray(raw[k]) ? raw[k].join(', ') : String(raw[k]);
  return { get: (name) => lower[String(name || '').toLowerCase()] == null ? null : lower[String(name || '').toLowerCase()] };
}

function responseOf(res) {
  let bytes = null;
  function read() {
    if (bytes) return bytes;
    bytes = new Promise((resolve, reject) => {
      const chunks = [];
      res.on('data', c => chunks.push(Buffer.from(c)));
      res.once('end', () => resolve(Buffer.concat(chunks)));
      res.once('error', reject);
      res.once('aborted', () => reject(new Error('proxy response aborted')));
    });
    return bytes;
  }
  const status = Number(res.statusCode) || 0;
  return {
    status: status, ok: status >= 200 && status < 300, headers: responseHeaders(res.headers),
    text: async () => (await read()).toString('utf8'),
    json: async () => JSON.parse((await read()).toString('utf8')),
    arrayBuffer: async () => {
      const b = await read();
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    }
  };
}

function bodyEnd(req, body) {
  if (body == null) { req.end(); return; }
  if (Buffer.isBuffer(body) || typeof body === 'string') { req.end(body); return; }
  if (body instanceof Uint8Array) { req.end(Buffer.from(body)); return; }
  if (body instanceof ArrayBuffer) { req.end(Buffer.from(body)); return; }
  if (body && typeof body.pipe === 'function') { body.pipe(req); return; }
  req.end(String(body));
}

function proxyAuthorization(proxy) {
  if (!proxy || (!proxy.username && !proxy.password)) return '';
  let user = '', pass = '';
  try { user = decodeURIComponent(proxy.username || ''); pass = decodeURIComponent(proxy.password || ''); }
  catch (_) { user = String(proxy.username || ''); pass = String(proxy.password || ''); }
  return 'Basic ' + Buffer.from(user + ':' + pass).toString('base64');
}

function proxyError(message) {
  // Never include the request URL: for Bot API requests it contains the bot token in the path.
  const e = new Error(String(message || 'proxy request failed'));
  e.code = 'PROXY_ERROR';
  return e;
}

function requestViaHttpProxy(target, init, proxy, deps) {
  const d = deps || { http, https, tls };
  const requestLib = proxy.protocol === 'https:' ? d.https : d.http;
  const headers = headerObject(init && init.headers);
  if (!headers.host && !headers.Host) headers.host = target.host;
  const auth = proxyAuthorization(proxy); if (auth) headers['proxy-authorization'] = auth;
  return new Promise((resolve, reject) => {
    const req = requestLib.request({ protocol: proxy.protocol, hostname: proxy.hostname, port: Number(proxy.port) || (proxy.protocol === 'https:' ? 443 : 80),
      method: (init && init.method) || 'GET', path: target.href, headers: headers }, res => resolve(responseOf(res)));
    const signal = init && init.signal;
    const abort = () => req.destroy(proxyError('proxy request aborted'));
    if (signal) { if (signal.aborted) return abort(); signal.addEventListener('abort', abort, { once: true }); }
    req.once('error', () => reject(proxyError('proxy request failed')));
    bodyEnd(req, init && init.body);
  });
}

function requestViaConnectProxy(target, init, proxy, deps) {
  const d = deps || { http, https, tls };
  const proxyRequest = proxy.protocol === 'https:' ? d.https : d.http;
  const headers = { Host: target.host };
  const auth = proxyAuthorization(proxy); if (auth) headers['Proxy-Authorization'] = auth;
  return new Promise((resolve, reject) => {
    let active = null;
    let finished = false;
    const settle = (fn, arg) => { if (finished) return; finished = true; fn(arg); };
    const signal = init && init.signal;
    const abort = () => { if (active && typeof active.destroy === 'function') active.destroy(proxyError('proxy request aborted')); };
    if (signal && signal.aborted) return reject(proxyError('proxy request aborted'));
    if (signal) signal.addEventListener('abort', abort, { once: true });
    const finish = (fn, arg) => { if (signal) signal.removeEventListener('abort', abort); settle(fn, arg); };
    const connect = proxyRequest.request({ protocol: proxy.protocol, hostname: proxy.hostname, port: Number(proxy.port) || (proxy.protocol === 'https:' ? 443 : 80),
      method: 'CONNECT', path: target.host, headers: headers });
    active = connect;
    connect.once('error', () => finish(reject, proxyError('proxy CONNECT failed')));
    connect.once('connect', (res, socket, head) => {
      if (Number(res && res.statusCode) !== 200) { try { socket.destroy(); } catch (_) {} return finish(reject, proxyError('proxy CONNECT was refused')); }
      if (head && head.length) socket.unshift(head);
      const secure = d.tls.connect({ socket: socket, servername: target.hostname });
      active = secure;
      secure.once('error', () => finish(reject, proxyError('proxy tunnel failed')));
      secure.once('secureConnect', () => {
        const headers2 = headerObject(init && init.headers);
        if (!headers2.host && !headers2.Host) headers2.host = target.host;
        const req = d.https.request({ hostname: target.hostname, port: Number(target.port) || 443, path: target.pathname + target.search,
          method: (init && init.method) || 'GET', headers: headers2, agent: false, createConnection: () => secure }, res => finish(resolve, responseOf(res)));
        active = req;
        req.once('error', () => finish(reject, proxyError('proxy tunneled request failed')));
        bodyEnd(req, init && init.body);
      });
    });
    connect.end();
  });
}

function makeEnvironmentProxyFetch(fetchImpl, env, deps) {
  if (typeof fetchImpl !== 'function') throw new Error('makeEnvironmentProxyFetch: fetch is required');
  const e = env || process.env;
  return function proxyFetch(url, init) {
    let target;
    try { target = new URL(String(url)); }
    catch (_) { return fetchImpl(url, init); } // preserve native fetch's URL validation for non-channel callers
    const raw = proxyUrlFor(target.protocol, e);
    if (!raw || shouldBypassProxy(target.hostname, envValue(e, ['NO_PROXY', 'no_proxy']))) return fetchImpl(url, init);
    const proxy = parseProxy(raw);
    if (!proxy) return Promise.reject(proxyError('proxy URL must use http or https'));
    return target.protocol === 'https:' ? requestViaConnectProxy(target, init || {}, proxy, deps) : requestViaHttpProxy(target, init || {}, proxy, deps);
  };
}

module.exports = { makeEnvironmentProxyFetch, proxyUrlFor, parseProxy, shouldBypassProxy, _internals: { responseOf, headerObject, proxyAuthorization, requestViaHttpProxy, requestViaConnectProxy } };
