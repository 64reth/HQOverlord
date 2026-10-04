/* node test/comms-presence.test.js — REGRESSION LOCK for the COMMS run-status honesty fixes
   (branch comms-ui-reliability, 2026-07-11).

   The escape this guards against: the live working-presence card (#comms-presence) only ever
   worked for a stream's FIRST run. resolvePresence() rewrote the card into a "■ RUN COMPLETE"
   summary (destroying its .cp-verb/.cp-tool/.cp-time children) but KEPT the id, so every later
   run's presenceCard() resurrected the dead card — no THINKING/WORKING indicator ever rendered
   again, and the stale summary was re-pinned under the new turn. The user-visible symptom:
   "I give a task and nothing shows it's working until text streams."

   chat.js is browser-flow (DOM + streaming), not node-loadable, so — like chat-runmeta.test.js —
   the DOM-layer invariants are locked by reading the source; the state-model behavior
   (connecting→confirmed upgrade, start re-stamp, pause-aware elapsed) is asserted live against
   channels.js, which IS node-loadable. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const C = require('../frontend/app/channels.js');

const src = fs.readFileSync(path.join(__dirname, '../frontend/app/chat.js'), 'utf8');

/* ---------- 1. a resolved card is history, never the next run's live card ---------- */
// presenceCard() must check for the resolved class and shed the id instead of reusing the card.
const pc = /function\s+presenceCard\s*\(\)\s*\{([\s\S]*?)\n  \}/.exec(src);
A.ok(pc, 'presenceCard() exists');
A.ok(/classList\.contains\(\s*'resolved'\s*\)/.test(pc[1]), 'presenceCard refuses to resurrect a resolved card (checks .resolved)');
A.ok(/removeAttribute\(\s*'id'\s*\)/.test(pc[1]), 'presenceCard demotes the resolved card to history (sheds the id) and builds a fresh live card');
// clearPresence (stream switch) must also keep resolved summaries as history, not delete them.
const cp = /function\s+clearPresence\s*\(\)\s*\{(.*)\}/.exec(src);
A.ok(cp, 'clearPresence() exists');
A.ok(/classList\.contains\(\s*'resolved'\s*\)/.test(cp[1]), 'clearPresence keeps a resolved summary (only live cards are torn down)');

/* ---------- 2. displayed durations come from the honest clock, never raw wall-arithmetic ---------- */
A.ok(/function\s+renderElapsed[\s\S]{0,700}Channels\.elapsedOf\(/.test(src), 'header timer reads Channels.elapsedOf (re-stamped start, pauses excluded)');
A.ok(/function\s+renderPresence[\s\S]{0,2200}Channels\.elapsedOf\(/.test(src), 'presence card time reads Channels.elapsedOf');
A.ok(/function\s+resolvePresence[\s\S]{0,600}Channels\.elapsedOf\(/.test(src), 'RUN COMPLETE duration reads Channels.elapsedOf');

/* ---------- 3. no state claim before server confirmation ---------- */
A.ok(/CONNECTING/.test(src), 'presence verb has the CONNECTING state (pre-confirmation honesty)');
A.ok(/setRunId\(\s*ws\.id\s*,\s*id\s*,\s*Date\.now\(\)\s*\)/.test(src), 'onRunId re-stamps the run start with the confirmation instant');
// walkToDesk may fire pre-confirmation (eager task walk) but must not claim working… until the run is confirmed.
const wtd = /function\s+walkToDesk\s*\(\)\s*\{([\s\S]*?)\n    \}/.exec(src);
A.ok(wtd, 'walkToDesk() exists');
A.ok(/runIdOf\(\s*ws\.id\s*\)/.test(wtd[1]), 'walkToDesk gates the working… claim on a confirmed runId');
// approval pauses feed the pause ledger (both directions).
A.ok(/setPending\(\s*ws\.id\s*,\s*\{[\s\S]{0,200}\}\s*,\s*Date\.now\(\)\s*\)/.test(src), 'onPermission opens the pause span (setPending with a timestamp)');
A.ok(/clearPending\(\s*(ws\.id|id)\s*,\s*Date\.now\(\)\s*\)/.test(src), 'consent resolution closes the pause span (clearPending with a timestamp)');

/* ---------- 4. the state model itself (real behavior, not source shape) ---------- */
C.reset();
C.begin('w', 1000);
A.eq(C.statusOf('w'), 'connecting…', 'begin claims only connecting… — a click proves nothing');
C.setRunId('w', 'r1', 1800);
A.eq(C.statusOf('w'), 'thinking…', 'server confirmation upgrades to thinking…');
A.eq(C.startedAtOf('w'), 1800, 'confirmation re-stamps the start (connect latency excluded)');
C.setPending('w', { promptId: 'p', tool: 't', argsSummary: '', runId: 'r1' }, 3800);
C.clearPending('w', 6800);
A.eq(C.elapsedOf('w', 7800), 3000, 'elapsed excludes the 3s approval pause (6s wall − 3s paused)');
C.end('w');
A.eq(C.elapsedOf('w', 9000), 0, 'end zeroes the honest elapsed');

/* ---------- 5. concurrent sessions: a peer run is a SOFT indicator, never a send gate ----------
   (concurrent-sessions lane, 2026-07-18: the sidecar admits concurrent same-agent runs — the workspace
   is guarded by a run-scoped lease backend-side. COMMS must SHOW the peer run truthfully but must not
   re-become the old hard gate: no disabled composer, no preflight refusal.) */
A.ok(/function\s+busyPeerFor\s*\(ws\)[\s\S]{0,700}Workstreams\.list[\s\S]{0,1200}Channels\.isBusy/.test(src),
  'COMMS still resolves a same-agent peer run (the soft indicator\'s source of truth)');
A.ok(/ALSO RUNNING IN/.test(src) && /VIEW ACTIVE RUN/.test(src),
  'a session with a busy peer names it and offers a route to the active run');
A.ok(/function\s+maybeEmptyState[\s\S]{0,300}busyPeerFor\(activeWs\)/.test(src),
  'an empty busy-peer session shows the peer row, not competing starter chips');
// the OLD hard gate must stay dead: nothing may disable the composer off a peer run…
const uc = /function\s+updateControls\s*\(\)\s*\{([\s\S]*?)\n  \}/.exec(src);
A.ok(uc, 'updateControls() exists');
A.ok(!/disabled\s*=\s*!!peer/.test(uc[1]), 'the composer is never disabled because a peer session is running');
A.ok(/input\.disabled\s*=\s*false/.test(uc[1]), 'the input is explicitly kept live under a peer run');
// …and send() must not refuse a turn because of one (the per-STREAM one-run gate stays).
A.ok(!/preflightPeer/.test(src), 'send has no agent-global preflight refusal (the old blocked-return is gone)');
A.ok(/Channels\.isBusy\(ws\.id\)\)\s*return/.test(src), 'the per-stream one-run-per-session gate still holds');

/* ---------- 6. a disconnect durably keeps real partial output before its marker ---------- */
A.ok(/function\s+persistPartial[\s\S]{0,700}role:\s*'assistant'[\s\S]{0,220}content:/.test(src),
  'chat owns one helper that persists accumulated partial assistant text');
A.ok(/if\s*\(error\)[\s\S]{0,2200}persistPartial\(ws,\s*acc\)[\s\S]{0,900}error:\s*true/.test(src),
  'a 200/error-envelope stores partial text before its durable failure marker');
A.ok(/catch\s*\(e\)[\s\S]{0,1500}persistPartial\(ws,\s*acc\)[\s\S]{0,900}error:\s*true/.test(src),
  'a thrown stream disconnect stores partial text before its durable failure marker');

/* ---------- 7. persisted hierarchy replaces the lead-only tool illusion ---------- */
A.ok(/card\.dataset\.runId\s*=\s*presenceRunId/.test(src), 'resolved presence is joined to its durable run row by runId');
A.ok(/function\s+hydrateRunTelemetry[\s\S]{0,2200}entry\.children/.test(src), 'run completion hydrates lead + worker hierarchy from persisted rows');
A.ok(/workerCalls[\s\S]{0,800}reasoningEffort/.test(src), 'summary exposes worker call count plus actual model/effort');
A.ok(/function\s+telemetryRun[\s\S]{0,1300}t\.ms/.test(src), 'expanded hierarchy renders each persisted per-tool duration');
A.ok(/hydrateRunTelemetry\(ws,\s*entry,\s*runId\)[\s\S]{0,300}if\s*\(!arts\.length/.test(src), 'clean artifact-less runs still hydrate telemetry before the quiet recap return');

A.report('comms-presence.test');
