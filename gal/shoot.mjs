// Headless-Chrome shooter for gal/shoot.html — no deps, Node 22 native WebSocket.
// node gal/shoot.mjs "<query>" <outPng> [port]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, resolve, normalize } from 'node:path';

const QUERY = process.argv[2] || 'ids=arcade';
const OUT = process.argv[3] || 'gal/out.png';
const PORT = +(process.argv[4] || 8931);
const ROOT = resolve(process.cwd());
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.css': 'text/css' };

const srv = createServer((req, res) => {
  const p = normalize(join(ROOT, decodeURIComponent(req.url.split('?')[0])));
  if (!p.startsWith(ROOT) || !existsSync(p) || !statSync(p).isFile()) { res.writeHead(404); return res.end('no'); }
  res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
});
await new Promise(r => srv.listen(PORT, '127.0.0.1', r));

const profile = `${process.env.TEMP}/starnet-shoot-${PORT}`;
rmSync(profile, { recursive: true, force: true }); mkdirSync(profile, { recursive: true });
const cdpPort = PORT + 1000;
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
  '--force-device-scale-factor=1', '--window-size=2400,1600',
  `http://127.0.0.1:${PORT}/gal/shoot.html?${QUERY}`,
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let wsUrl = null;
for (let i = 0; i < 60 && !wsUrl; i++) {
  await sleep(250);
  try {
    const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
    const pg = list.find(t => t.type === 'page' && t.url.includes('shoot.html'));
    if (pg) wsUrl = pg.webSocketDebuggerUrl;
  } catch {}
}
if (!wsUrl) { chrome.kill(); srv.close(); throw new Error('chrome never came up'); }

const ws = new WebSocket(wsUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pend = new Map();
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
});
const send = (method, params) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

// wait for the page script to finish (it stamps document.title)
let ok = false, title = '';
for (let i = 0; i < 40 && !ok; i++) {
  await sleep(200);
  const r = await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
  title = r.result?.result?.value || '';
  ok = title === 'ready';
  if (title.startsWith('ERR ')) break;
}
if (!ok) { ws.close(); chrome.kill(); srv.close(); throw new Error(`page never signalled ready — title was ${JSON.stringify(title)}`); }

const box = await send('Runtime.evaluate', {
  expression: 'JSON.stringify({w:document.getElementById("c").width,h:document.getElementById("c").height})',
  returnByValue: true,
});
const { w, h } = JSON.parse(box.result.result.value);
await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
await sleep(150);
const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height: h, scale: 1 } });
writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
console.log(`${OUT}  ${w}x${h}`);
ws.close(); chrome.kill(); srv.close();
process.exit(0);
