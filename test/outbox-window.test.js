/* node test/outbox-window.test.js — the OUTBOX — FINISHED WORK window contract (2026-07-17).

   Andrew-spec accordion, locked so it can't regress: a collapsed row is TITLE + a small description
   that is the agent's REAL recorded output (transcript-derived) + a dim meta line — and NOTHING
   else (no buttons). Clicking the row expands it (one open at a time) into the full breakdown with
   exactly the relevant actions: ↗ OPEN (test in the run's session), ⊕ NEW SESSION (same-agent
   follow-up chat, prefilled composer), and the rate control (collecting the crate). The chute click
   opens THIS window; the digest beat carries a door to it; rating labels name the RUN's agent.

   stationui.js/chat.js are browser-flow (DOM + live stores), not node-loadable — like
   chat-runmeta.test.js we lock the invariants by reading the shipped source. returns.js IS pure and
   node-loadable, so its streamId contract is asserted by execution. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const station = read('frontend/app/windows/outbox.js');   // the OUTBOX window extracted from stationui.js (BUILDERS split)
const chat = read('frontend/app/chat.js');
const rstore = read('frontend/app/returnstore.js');
const app = read('frontend/app/app.js');
const world = read('frontend/app/world.js');
const css = read('frontend/css/app.css');

/* ---- the window exists and is the chute's click-through ---- */
A.ok(/registerWindow\('outbox',\s*'OUTBOX — FINISHED WORK',\s*buildOutbox/.test(station), 'the OUTBOX window registers itself (StationUI.registerWindow → the same BUILDERS slot)');
A.ok(/setOnOutbox\(\(\)\s*=>\s*\{[^}]*openTerm\('outbox'\)/.test(app), "the world's OUTBOX click opens the window (never the old one-crate beat)");
A.ok(!/reviewNext\(\)/.test(app), 'app.js no longer drives the one-crate-at-a-time review beat from the chute');

/* ---- collapsed row = title + real-output description + meta, and NOTHING else ---- */
const buildFn = station.slice(station.indexOf('function buildOutbox'), station.indexOf('StationUI.registerWindow('));
A.ok(buildFn.length > 200, 'buildOutbox body located');
A.ok(/ReturnStore\.pendingRows/.test(buildFn) || /RS\.pendingRows/.test(buildFn), 'rows come only from the durable pending ledger (ReturnStore.pendingRows)');
const headHtml = /'<div class="ob-head"[\s\S]*?<\/div>'\s*\+\s*'<div class="ob-body"/.exec(buildFn);
A.ok(headHtml, 'the collapsed head block is distinct from the expandable body');
A.ok(!/<button/.test(headHtml[0]), 'the collapsed head carries NO buttons (title + desc + meta only — the Andrew law)');
// the description is the agent's recorded output: the last real assistant turn, [SILENT] excluded
A.ok(/role === 'assistant'/.test(buildFn) && /\[SILENT\]/.test(buildFn), 'the description derives from real assistant output (transcript), [SILENT] excluded');
A.ok(/routine \? \(/.test(buildFn) || /rw\.routine \?/.test(buildFn), 'a routine-fired run is titled by the routine name');
A.ok(/users\[0\]\.content, 64/.test(buildFn), "a non-routine title comes from the transcript's real first ask (never the stored prompt+reply title mush)");

/* ---- expanded breakdown: ONE GRAMMAR with the DELIVERABLES drawer (2026-08-13) ----
   The drawer speaks the library's exact language — what you asked for, what came back, the files —
   so OUTBOX reads as the "awaiting your verdict" door into the same system, not a second one. */
A.ok(/ob-sec">WHAT YOU ASKED FOR</.test(buildFn), 'expanded body shows WHAT YOU ASKED FOR (the library grammar, not THE ASK)');
A.ok(/ob-sec">WHAT CAME BACK</.test(buildFn), 'expanded body shows WHAT CAME BACK (the library grammar, not WHAT THE AGENT DID)');
/* ---- FILES: the library's own index and seams, never a second bookkeeping ---- */
A.ok(/api\/deliverables/.test(buildFn), 'files come from ONE fetch of the library index (/api/deliverables), folded by runId');
A.ok(/class="dlv-files"/.test(buildFn), 'files render with the library’s own markup (dlv-files — the two drawers share one look)');
A.ok(/DLV\.handleOpenClick\(ev, dlvRows, openState/.test(buildFn), 'OPEN rides Deliverables.handleOpenClick (the one desktop-confirm/safe-preview seam)');
A.ok(/d && d\.files\.length/.test(buildFn), 'a run the index doesn’t know shows NO files section (never invented)');
// The library door now navigates with a return route instead of stacking another window.
// Invoke the actual empty-Outbox handlers; the invariant is the destination, not an opener's name.
const navCalls = [], doorClicks = {};
const emptyBody = {
  innerHTML: '',
  querySelector: selector => selector === '#ob-list' ? { innerHTML: '' } : {
    addEventListener: (event, fn) => { doorClicks[selector] = fn; }
  }
};
// This builder contains quoted regex literals; use its registration boundary rather
// than fnBody's deliberately limited brace scanner.
vm.runInNewContext(buildFn + '\nbuildOutbox(body);', {
  body: emptyBody, ReturnStore: { pendingRows: () => [] }, H: { navigateWork: (...args) => navCalls.push(args) }
});
doorClicks['#ob-library'](); doorClicks['#ob-logbook']();
A.eq(navCalls, [['outbox', 'deliverables'], ['outbox', 'logbook']],
  'the library and run-history doors preserve their source for return navigation');
A.ok(/class="consent-btn ob-open">↗ OPEN/.test(buildFn), 'action: ↗ OPEN (test it in the session)');
A.ok(/class="consent-btn ob-fork">⊕ NEW SESSION/.test(buildFn), 'action: ⊕ NEW SESSION (expand on this)');
A.ok(/closeOthers\(/.test(buildFn), 'accordion: opening a row closes the others');
A.ok(/RS\.openWork\s*\?\s*await RS\.openWork\(rw\)/.test(buildFn) || /await RS\.openWork\(rw\)/.test(buildFn), '↗ OPEN rides ReturnStore.openWork (the one transcript-session join)');
A.ok(/w\.create\(\('follow-up: [\s\S]{0,120}agentId:\s*rw\.agentId/.test(buildFn), '⊕ NEW SESSION binds the follow-up chat to the RUN’s agent');
A.ok(/App\.openWorkstream\(ws\.id\)/.test(buildFn), '⊕ NEW SESSION opens the fresh session');
A.ok(/Chat\.prefill\(/.test(buildFn), '⊕ NEW SESSION prefills the composer naming the task (no fabricated turns)');
A.ok(/collect crate/.test(buildFn), 'an already-judged run still offers a plain collect (a crate can never wedge)');
// honest failure copy — a missing/unreachable transcript never renders as a silent blank
A.ok(/no transcript recorded for this run/.test(buildFn), 'a run with no transcript says so honestly');
A.ok(/wasn’t reachable|couldn’t read the result/.test(buildFn), 'a FAILED transcript fetch is distinguished from an empty one');

/* ---- rating: the label names the RUN's agent, and awayRate guards double-judging ---- */
A.ok(/App\.agentName\(agentId \|\| 'agent'\)/.test(chat), "workRateControl labels the verdict with the RUN's agent (App.agentName(agentId)), never whoever the active chat is bound to");
const awayRate = chat.slice(chat.indexOf('function awayRate'), chat.indexOf('function awayRate') + 600);
A.ok(/workRatedRuns\.has\(rw\.runId\)/.test(awayRate), 'awayRate refuses to re-mount for an already-judged run (returns false → caller collects)');
A.ok(/\bawayRate\b/.test(chat.slice(chat.lastIndexOf('return {'))), 'Chat exports awayRate (the OUTBOX window mounts the real XP-law control)');

/* ---- store contract: ledger copies, openWork joins, open window stays fresh ---- */
A.ok(/function pendingRows\(\)[^\n]*\n?.*Object\.assign\(\{\}, r\)/.test(rstore) || /pendingRows[\s\S]{0,200}Object\.assign\(\{\}, r\)/.test(rstore), 'pendingRows hands out COPIES (a render can never mutate durable state)');
A.ok(/revive:\s*true/.test(rstore), 'openWork adopt rides revive:true (the tombstone lane’s ONE deliberate revive path)');
A.ok(/rerender\('outbox'\)/.test(rstore), 'a digest fold re-renders an already-open OUTBOX window (no stale list)');
A.ok(/\bpendingRows\b/.test(rstore.slice(rstore.lastIndexOf('return {'))), 'ReturnStore exports pendingRows');

/* ---- world: the chute is always clickable while placed; hover names the click ---- */
const outboxAtFn = world.slice(world.indexOf('function outboxAt'), world.indexOf('function outboxAt') + 700);
A.ok(!/returnCrates\(\)\s*<=\s*0/.test(outboxAtFn), 'outboxAt has NO crate-count gate (the window has honest content in every state — mirrors the MISSION BOARD)');
A.ok(/function drawOutboxHoverTag/.test(world) && /drawOutboxHoverTag\(now\)/.test(world), 'the hover-glance tag draws each frame while a chute is hovered');
A.ok(/TO REVIEW — CLICK/.test(world) && /FINISHED WORK — CLICK/.test(world), 'hover copy names the click in both states (crates pending / none)');

/* ---- digest beat: the always-available door ---- */
const digestFn = chat.slice(chat.indexOf('function awayDigest'), chat.indexOf('function awayReview'));
A.ok(/openTerm\('outbox'\)/.test(digestFn), 'the while-you-were-away digest carries the ▸ open the OUTBOX door (works with no prop placed)');

/* ---- CSS layer exists (the round-2 cram regression stays dead) ---- */
A.ok(/\.ob-head \{/.test(css) && /\.ob-desc \{/.test(css) && /\.ob-acts \{/.test(css), 'the ob-* layout layer ships in css/app.css');
A.ok(/-webkit-line-clamp:\s*2/.test(css), 'collapsed descriptions clamp to 2 lines');

/* ---- the pure engine: digest rows carry the transcript join (executed, not grepped) ---- */
const R = require('../frontend/app/returns.js');
let s = R.heartbeat(R.hydrate(null), 1000);
const rows = R.unattended(s, [{ runId: 'r1', agentId: 'a1', reason: 'done', ts: 2000, title: 't', streamId: 'cron-r1' }], 1000);
A.eq(rows.length, 1, 'engine digests the unattended run');
A.eq(rows[0].streamId, 'cron-r1', 'the digest row carries streamId (the crate→transcript join the whole window stands on)');
s = R.fold(s, rows);
A.eq(R.hydrate(JSON.parse(JSON.stringify(s))).pending[0].streamId, 'cron-r1', 'streamId SURVIVES the persist/hydrate round trip (a reload cannot orphan a crate from its transcript)');

A.report('outbox-window.test');
