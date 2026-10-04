// Live Wave 4B journey: keyboard + trusted pointer resize, minimize/restore, persistence, phone clamp.
// Uses the repository's sanctioned CDP harness against the real seeded station.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep } from '../lib/cdp.mjs';

const url = process.env.STARNET_URL || 'http://127.0.0.1:9084';
const cdpPort = Number(process.env.STARNET_CDP_PORT || 9484);
const profileDir = mkdtempSync(join(tmpdir(), 'starnet-terminal-resize-'));
const { proc } = launchChrome({ cdpPort, win: '1440,900', profileDir });
let cdp;

const CASES = [
  { key: 'settings', title: 'SETTINGS', family: 'console' },
  { key: 'skills', title: 'SKILLS & CAPABILITIES', family: 'console' },
  { key: 'agents', title: 'AGENT DOSSIER', family: 'dossier' },
  { key: 'notifs', title: 'NOTIFICATIONS', family: 'small' },
];

const selectorFor = title => `.term:has(.term-x[aria-label=${JSON.stringify('Close ' + title)}])`;

async function waitFor(expr, label, attempts = 70) {
  for (let i = 0; i < attempts; i++) {
    if (await evalJS(cdp, expr).catch(() => false)) return;
    await sleep(100);
  }
  throw new Error('timed out waiting for ' + label);
}

async function openTerm(item) {
  await evalJS(cdp, `StationUI.openTerm(${JSON.stringify(item.key)})`);
  const sel = selectorFor(item.title);
  await waitFor(`!!document.querySelector(${JSON.stringify(sel)})`, item.title);
  await sleep(500);
  return sel;
}

async function rect(sel) {
  return evalJS(cdp, `(() => {
    const w = document.querySelector(${JSON.stringify(sel)});
    const r = w.getBoundingClientRect();
    return { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height };
  })()`);
}

async function keyResize(sel, key) {
  await evalJS(cdp, `document.querySelector(${JSON.stringify(sel + ' .term-resize')}).focus()`);
  const vk = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 }[key];
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await sleep(120);
}

async function pointerResize(sel, dx, dy) {
  const p = await evalJS(cdp, `(() => {
    const r = document.querySelector(${JSON.stringify(sel + ' .term-resize')}).getBoundingClientRect();
    return { x:r.left+r.width/2, y:r.top+r.height/2 };
  })()`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x + dx, y: p.y + dy, button: 'left', buttons: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x + dx, y: p.y + dy, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(180);
}

async function probe(item, label) {
  const sel = selectorFor(item.title);
  const result = await evalJS(cdp, `(() => {
    const w = document.querySelector(${JSON.stringify(sel)});
    const head = w && w.querySelector('.term-head');
    const close = w && w.querySelector('.term-x');
    const grip = w && w.querySelector('.term-resize');
    const body = w && w.querySelector('.term-body');
    const scroller = w && (w.querySelector('.con-pane') || body);
    if (!w || !head || !close || !grip || !body || !scroller) return { ok:false, reason:'missing terminal chrome' };
    const box = e => { const r=e.getBoundingClientRect(); return [r.left,r.top,r.right,r.bottom,r.width,r.height]; };
    const wr=box(w), hr=box(head), xr=box(close), gr=box(grip), br=box(body), sr=box(scroller);
    const inView = r => r[0] >= -0.5 && r[1] >= -0.5 && r[2] <= innerWidth + 0.5 && r[3] <= innerHeight + 0.5;
    const saved = JSON.parse(localStorage.getItem('starnet.station.v1') || '{}');
    const overflow = getComputedStyle(scroller).overflowY;
    const ok = inView(xr) && inView(gr) && hr[3] > 0 && hr[1] < innerHeight &&
      br[5] > 0 && br[3] <= wr[3] + 0.5 && sr[5] > 0 && sr[3] <= wr[3] + 0.5 &&
      (overflow === 'auto' || overflow === 'scroll');
    return { ok, label:${JSON.stringify(label)}, key:${JSON.stringify(item.key)}, family:${JSON.stringify(item.family)},
      viewport:[innerWidth,innerHeight], window:wr, close:xr, grip:gr, body:br,
      bodyScroll:[scroller.clientHeight,scroller.scrollHeight], overflow, active:document.activeElement?.getAttribute('aria-label') || '',
      savedSize:saved.termSize && saved.termSize[${JSON.stringify(item.key)}],
      savedPosition:saved.termPos && saved.termPos[${JSON.stringify(item.key)}] };
  })()`);
  if (!result.ok) throw new Error(label + ' invariant failed: ' + JSON.stringify(result));
  return result;
}

async function closeTerm(item) {
  const sel = selectorFor(item.title);
  await evalJS(cdp, `document.querySelector(${JSON.stringify(sel + ' .term-x')}).click()`);
  await waitFor(`!document.querySelector(${JSON.stringify(sel)})`, item.title + ' close');
}

const receipts = [];
try {
  cdp = await connectCDP(cdpPort);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url });
  await waitFor("typeof StationUI === 'object' && typeof StationUI.openTerm === 'function' && !!document.querySelector('#screen-game.active')", 'active station');
  await evalJS(cdp, "localStorage.removeItem('starnet.station.v1')");
  await cdp.send('Page.reload');
  await sleep(700);
  await waitFor("typeof StationUI === 'object' && !!document.querySelector('#screen-game.active')", 'clean station');

  for (const item of CASES) {
    const sel = await openTerm(item);
    const initial = await rect(sel);
    await keyResize(sel, 'ArrowRight');
    await keyResize(sel, 'ArrowDown');
    const keyboard = await rect(sel);
    if (!(keyboard.width > initial.width && keyboard.height > initial.height))
      throw new Error(item.key + ' keyboard resize did not change both dimensions');

    // Pointer follows a persisted keyboard resize: this catches the old-size snap-back seam.
    await pointerResize(sel, 64, 48);
    const pointer = await rect(sel);
    if (!(pointer.width > keyboard.width && pointer.height > keyboard.height))
      throw new Error(item.key + ' pointer resize did not survive saved-size clamping');
    receipts.push(await probe(item, 'desktop keyboard + pointer'));

    if (item.key === 'settings') {
      await evalJS(cdp, `document.querySelector(${JSON.stringify(sel + ' .term-min')}).click()`);
      await waitFor(`document.querySelector(${JSON.stringify(sel)})?.classList.contains('term-min-hidden')`, 'Settings minimize');
      await evalJS(cdp, "StationUI.openTerm('settings')");
      await waitFor(`!document.querySelector(${JSON.stringify(sel)})?.classList.contains('term-min-hidden')`, 'Settings restore');
      await sleep(500);
      const restored = await rect(sel);
      if (Math.abs(restored.width - pointer.width) > 1 || Math.abs(restored.height - pointer.height) > 1)
        throw new Error('Settings minimize/restore changed dimensions: ' + JSON.stringify({ pointer, restored }));
      receipts.push(await probe(item, 'minimize + restore'));
    }
    await closeTerm(item);
  }

  // A real reload must rehydrate both dimensions, not merely leave inline styles on a live node.
  await cdp.send('Page.reload');
  await sleep(700);
  await waitFor("typeof StationUI === 'object' && !!document.querySelector('#screen-game.active')", 'station after reload');
  const settings = CASES[0], settingsSel = await openTerm(settings);
  receipts.push(await probe(settings, 'reload persistence'));
  await closeTerm(settings);

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await sleep(350);
  for (const item of CASES) {
    await openTerm(item);
    receipts.push(await probe(item, 'phone clamp'));
    await closeTerm(item);
  }

  console.log(JSON.stringify({ ok:true, url, cases:CASES.map(x => x.key), receipts }, null, 2));
} catch (err) {
  console.error(JSON.stringify({ ok:false, error:err.message, receipts }, null, 2));
  process.exitCode = 1;
} finally {
  try { cdp?.ws.close(); } catch {}
  try { proc.kill(); } catch {}
  try { rmSync(profileDir, { recursive:true, force:true }); } catch {}
}
