#!/usr/bin/env node
/* rec-spine-live.mjs — LIVE proof for the recommendation spine lane (throwaway verification driver).
   Boots a seeded SKYNET_DEV sidecar on its own port + its own scratch workspace, drives headless
   Chrome to the floor, then asserts against the REAL page:
     1. recommend.js loaded and its arbiter behaves live (one voice, evidence or silence).
     2. The offer card's grammar renders and STYLES correctly in the real cabinet — the exact DOM
        recCard() emits, measured with getComputedStyle (no OS paint, matte, boxed glyph, entrance).
     3. No console errors / exceptions during boot.
   Usage: SKYNET_REC_PORT=8813 SKYNET_REC_CDP=9313 node scripts/rec-spine-live.mjs */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, collectDiagnostics, capture, sleep } from './lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from './lib/seed.mjs';

const port = process.env.SKYNET_REC_PORT || '8813';
const cdpPort = Number(process.env.SKYNET_REC_CDP || 9313);
const url = `http://127.0.0.1:${port}/`;
const scratch = mkdtempSync(join(process.cwd(), '.dev-workspaces-recspine-'));
const profile = mkdtempSync(join(tmpdir(), 'recspine-profile-'));
let fail = 0, pass = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('FAIL: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a));

materializeSeedWorkspace(scratch);
const sidecar = bootSeededSidecar({ port, scratchDir: scratch });
const chrome = launchChrome({ cdpPort, profileDir: profile });
let cdp = null;
try {
  await waitUp(url);
  await sleep(1200);
  cdp = await connectCDP(cdpPort);
  const diag = collectDiagnostics(cdp);
  await cdp.send('Page.navigate', { url });
  await waitDevReady(cdp, evalJS, { url });

  /* ---- 1. the spine is live in the page ---- */
  const spine = await evalJS(cdp, `(() => {
    if (typeof Recommend === 'undefined') return { loaded: false };
    const u = { dims: { goals: { weight: 1, conf: 0 }, style: { weight: 0.2, conf: 0.9 } } };
    const field = [
      { kind: 'curiosity', why: 'i still do not know your goals', dim: 'goals' },
      { kind: 'study', why: 'you said "ship the billing rewrite"' },
      { kind: 'thread', why: 'you said "automate the invoice thing"' }
    ];
    return {
      loaded: true,
      priority: Recommend.PRIORITY,
      winner: (Recommend.pick(field, u) || {}).kind,
      silence: Recommend.pick([{ kind: 'study' }, { kind: 'curiosity' }]) === null,
      why: Recommend.whyLine({ why: 'You said invoices eat your Sundays.' }),
      slot: Recommend.slotKindOf('curiosity')
    };
  })()`);
  ok(spine && spine.loaded, 'recommend.js is loaded in the live page');
  eq(spine.winner, 'study', 'the live arbiter picks the highest-priority cited candidate');
  ok(spine.silence === true, 'the live arbiter returns SILENCE when nothing can cite');
  eq(spine.why, 'because you said invoices eat your Sundays', 'the live whyLine grammar');
  eq(spine.slot, 'nudge', 'the gentle channels share one slot family live');
  eq(spine.priority[0], 'memory', 'memory still outranks everything');

  /* ---- 2. the offer card renders + styles in the real cabinet ---- */
  const card = await evalJS(cdp, `(() => {
    const log = document.getElementById('chat-log');
    if (!log) return { err: 'no #chat-log' };
    // the EXACT DOM recCard() emits (chat.js), built here because the renderer is module-private.
    const d = document.createElement('div');
    d.className = 'cmsg agent tool turnin rec study';
    const body = document.createElement('div'); body.className = 'body';
    const title = document.createElement('span'); title.className = 'turnin-title rec-eyebrow';
    const glyph = document.createElement('span'); glyph.className = 'rec-glyph'; glyph.textContent = '\\u25C8';
    title.appendChild(glyph); title.appendChild(document.createTextNode('NOTICED'));
    const slot = document.createElement('span'); slot.className = 'turnin-slot';
    const item = document.createElement('div'); item.className = 'turnin-item rec-item';
    const ev = document.createElement('div'); ev.className = 'rec-evidence';
    ev.textContent = 'because you said \\u201Cinvoices eat my Sundays\\u201D';
    const kind = document.createElement('span'); kind.className = 'turnin-kind'; kind.textContent = 'PAIN';
    const text = document.createElement('span'); text.className = 'turnin-text';
    text.textContent = 'invoicing is a recurring Sunday drain worth automating';
    const btns = document.createElement('span'); btns.className = 'consent-btns';
    const mk = (l, c) => { const b = document.createElement('button'); b.className = 'consent-btn' + (c ? ' ' + c : ''); b.textContent = l; return b; };
    const yes = mk('Keep', ''), no = mk('Discard', 'deny');
    btns.appendChild(yes); btns.appendChild(no);
    item.appendChild(ev); item.appendChild(kind); item.appendChild(text);
    const note = document.createElement('div'); note.className = 'turnin-evidence';
    note.textContent = '\\u21B3 the agent would remember this about your pain';
    item.appendChild(note); item.appendChild(btns);
    slot.appendChild(item); body.appendChild(title); body.appendChild(slot); d.appendChild(body);
    log.appendChild(d);
    d.scrollIntoView();
    const cs = el => getComputedStyle(el);
    const rect = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    const g = cs(glyph), b1 = cs(yes), evs = cs(ev), cardS = cs(d);
    return {
      rendered: !!d.isConnected,
      order: [rect(ev).y, rect(text).y, rect(btns).y],
      cardBg: cardS.backgroundImage === 'none' ? cardS.backgroundColor : 'gradient',
      cardBorderLeft: cardS.borderLeftColor,
      animation: cardS.animationName + ' ' + cardS.animationDuration,
      evColor: evs.color,
      evBorderBottom: evs.borderBottomWidth,
      glyphBox: { w: Math.round(parseFloat(g.width)), h: Math.round(parseFloat(g.height)), display: g.display, justify: g.justifyContent },
      btnBg: b1.backgroundColor, btnColor: b1.color, btnBorder: b1.borderTopColor,
      denyColor: cs(no).color,
      cardRect: rect(d), evRect: rect(ev), textRect: rect(text),
      bodyOverflowX: document.body.scrollWidth <= document.body.clientWidth
    };
  })()`);
  ok(card && card.rendered, 'the offer card renders into the live COMMS feed');
  ok(card.order[0] < card.order[1] && card.order[1] <= card.order[2],
    'reading order is evidence → proposal → consent (' + JSON.stringify(card.order) + ')');
  ok(card.animation.indexOf('rec-card-in') === 0 && card.animation.indexOf('0.26s') > 0,
    'the entrance animation is live: ' + card.animation);
  ok(parseFloat(card.evBorderBottom) > 0, 'the evidence line carries its hairline rule');
  eq(card.glyphBox.w, 11, 'the ◈ glyph is box-sized (11px), not padded from font-size');
  eq(card.glyphBox.justify, 'center', 'the glyph is box-CENTRED');
  const osPaint = ['rgb(255, 255, 255)', 'rgb(239, 239, 239)'];
  ok(osPaint.indexOf(card.btnBg) < 0, 'no OS buttonface on the consent buttons (' + card.btnBg + ')');
  ok(card.btnBorder !== 'rgb(118, 118, 118)', 'no OS ButtonBorder on the consent buttons (' + card.btnBorder + ')');
  ok(card.btnColor !== 'rgb(0, 0, 0)', 'the consent buttons are phosphor, not OS black');
  ok(card.denyColor !== card.btnColor, 'the deny button reads as the refusal (distinct colour)');
  ok(card.bodyOverflowX === true, 'the card never pushes the page into horizontal scroll');
  ok(card.evRect.w > 0 && card.evRect.w <= card.cardRect.w, 'the evidence line stays inside the card');
  ok(card.textRect.w > 30, 'the proposal column is not crushed (' + card.textRect.w + 'px)');

  await capture(cdp, '.uishots-rec', 'rec-card');

  /* ---- 3. clean boot ---- */
  const errs = (diag.consoleMsgs || []).map(m => m.type + ': ' + m.text).concat(diag.exceptions || []);
  eq(errs.filter(e => /recommend|recCard|recommendPass/i.test(String(e))), [], 'no console errors from the spine');
  console.log('console/exception log: ' + JSON.stringify(errs.slice(0, 6)));
  console.log('spine: ' + JSON.stringify(spine));
  console.log('card: ' + JSON.stringify(card));
} catch (e) {
  fail++; console.log('FAIL: driver threw — ' + (e && e.stack || e));
} finally {
  try { chrome.kill(); } catch {}
  try { sidecar.kill(); } catch {}
  await sleep(400);
  try { rmSync(scratch, { recursive: true, force: true }); } catch {}
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
console.log(fail ? ('rec-spine-live: ' + fail + ' problem(s), ' + pass + ' ok') : ('rec-spine-live: OK (' + pass + ' assertions)'));
process.exit(fail ? 1 : 0);
