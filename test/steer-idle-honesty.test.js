/* node test/steer-idle-honesty.test.js — source-lock: /steer with NO run in flight must refuse, never run.

   Adversarial sweep 2026-07-14, F3: typing `/steer go faster` while idle minted a USER turn
   ("Steering note for the current task: go faster") and launched a FULL model run on the fronted agent —
   real-provider spend for a command that had nothing to act on. The sidecar's own /api/run/steer honestly
   404s when no run holds the id (index.js handleRunSteer); the frontend just never asked it — steerCommand's
   idle branch fell through to send(note). The fix replaces that fallthrough with an honest refusal that
   points at /queue (the affordance that DOES stage text for the next run).

   chat.js is browser-flow (DOM + streaming), not node-loadable — invariants locked by reading the source
   (the chat-runmeta.test.js mold). The busy-path behaviors (live POST to /api/run/steer with a known runId;
   queue fallback otherwise) are locked too, so this fix can't regress mid-run steering. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../frontend/app/chat.js'), 'utf8');

const fn = /function\s+steerCommand\s*\(args\)\s*\{([\s\S]*?)\n  \}/.exec(src);
A.ok(fn, 'steerCommand exists in chat.js');
const body = fn ? fn[1] : '';

// the live mid-run path still steers the addressed run through the sidecar's per-run buffer…
A.ok(/\/api\/run\/steer/.test(body), 'busy path: a live runId is steered via POST /api/run/steer');
// …and an unaddressable busy run still falls back to the queue (a steer is never silently dropped).
A.ok(/steerQueueFallback\(note\)/.test(body), 'busy path: no runId → the note queues (never silently dropped)');

// the IDLE path refuses honestly and never launches a run.
A.ok(/Nothing is running to steer/.test(body), 'idle path: an honest refusal line exists');
A.ok(!/^\s*send\(note\);?\s*$/m.test(body), 'idle path: the send(note) fallthrough is gone — /steer can never mint a model run');
// the refusal teaches the real affordance instead of a dead end.
A.ok(/\/queue/.test(body), 'the refusal points at /queue (the honest way to stage text for the next run)');

A.report('steer-idle-honesty.test');
