// Real Chrome, local cookie fixture, two production browser sessions sharing the host-style lease.
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import browser from '../sidecar/tools/builtin/browser.js';
const root = path.join(import.meta.dirname, '.platform-proof');
fs.mkdirSync(root, { recursive: true });
const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Local session fixture</title><p>Session proof</p>'); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = 'http://127.0.0.1:' + server.address().port;
let holder = null;
const drivers = [], waits = [];
const create = id => browser.makeBrowserTools({ forceHeadless: true, cdpPort: 0,
  persistentProfile: { dir: path.join(root, 'session-profile'), acquire() { if (holder && holder !== id) return false; holder = id; return true; }, release() { if (holder === id) holder = null; } },
  onProfileWait: waiting => waits.push({ id, waiting }),
  makeDriver: deps => { const d = browser._internals.makeCdpDriver(deps); drivers.push(d); return d; } });
const a = create('first'), b = create('second');
try {
  await a.tools.find(t => t.name === 'browser.tabs').run({}, {});
  await drivers[0].navigate(url);
  await drivers[0].testEval("document.cookie = 'platform_proof=saved; path=/; max-age=3600'");
  const next = b.tools.find(t => t.name === 'browser.tabs').run({}, {});
  await new Promise(r => setTimeout(r, 300));
  assert.equal(drivers.length, 1, 'waiting run never launches a temporary browser');
  assert.ok(waits.some(x => x.id === 'second' && x.waiting));
  await a.session.close();
  await next;
  await drivers[1].navigate(url);
  const cookie = await drivers[1].testEval('document.cookie');
  assert.match(cookie, /platform_proof=saved/);
  assert.equal(drivers[0].profileDir, drivers[1].profileDir);
  await b.session.close();
  assert.equal(holder, null);
  assert.equal(waits.at(-1).waiting, false);
  fs.writeFileSync(path.join(root, 'browser-receipt.json'), JSON.stringify({ realChrome: true, localFixture: true, savedCookieReused: true, launches: drivers.length, waits, leaseReleased: holder === null }, null, 2));
  console.log('LIVE BROWSER PASS: concurrent session waited, reused saved cookie in the same profile, and released the lease.');
} finally { await a.session.close(); await b.session.close(); server.close(); }
