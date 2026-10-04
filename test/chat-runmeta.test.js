/* node test/chat-runmeta.test.js — source-lock for chat.js's RUN-META LEDGER (pitch-arc tail polish #17/#18).

   The bus agent.run.end payload carries no isTask flag and no title, so the proactive advice beats (the First Pitch
   graduation gate in pitchstore.js) can't tell a real TASK from casual chat — or name the run that just finished —
   from the event alone. chat.js closes that gap: at run START (onRunId, where isTask + the origin workstream are
   both in scope) it records runId -> { isTask, title } into a capped ledger, exposed read-only as Chat.runMeta(id).
   app.js wires that into adviceDeps.wasTaskRun / getRecentTask (asserted in pitchstore.test.js via the dep contract).

   chat.js is browser-flow (DOM + streaming), not node-loadable, so — like harness-internal.test.js and
   newhero-reset.test.js — we lock the invariant by reading the source. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../frontend/app/chat.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(__dirname, '../frontend/app/app.js'), 'utf8');
const stationSrc = fs.readFileSync(path.join(__dirname, '../frontend/app/stationui.js'), 'utf8');

// the ledger exists.
A.ok(/const\s+RUN_META\s*=\s*new\s+Map\(\)/.test(src), 'chat.js declares the RUN_META ledger (Map)');

// it is populated at run START (onRunId), keyed by the runId, capturing BOTH isTask and the workstream title.
const rec = /RUN_META\.set\(\s*id\s*,\s*\{([^}]*)\}/.exec(src);
A.ok(rec, 'RUN_META.set(id, {...}) records the run at start (onRunId)');
A.ok(/\bisTask\b/.test(rec[1]), 'the ledger entry captures isTask (so a real task is distinguishable from chat)');
A.ok(/\btitle\b/.test(rec[1]), 'the ledger entry captures the run title (so the right run can be named)');
A.ok(/\brecipeId\b/.test(rec[1]), 'the ledger entry captures recipeId (the provenance spine: rateWork attributes the verdict to the launching recipe)');
// the spine rides the wire too: launchRecipe passes recipeId into Chat.send, and harness.js puts it on the /api/run body.
A.ok(/Chat\.send\(\s*text\s*,\s*\{[^}]*recipeId\s*:\s*source\s*&&\s*source\.direct\s*\?\s*undefined\s*:\s*recipe\.id/.test(appSrc), 'template launches pass recipeId; direct tasks carry no template attribution (behavior covered by direct-work-launch.test.js)');
const harnessSrc = fs.readFileSync(path.join(__dirname, '../frontend/app/harness.js'), 'utf8');
A.ok(/reqBody\.recipeId\s*=/.test(harnessSrc), 'harness.js forwards recipeId on the /api/run body (spine → durable run row)');
A.ok(/RUN_META\.set\b/.test(src) && /onRunId/.test(src), 'the record sits on the onRunId path (recorded at run start, before run.end)');

// it is bounded (a long session can't leak runIds).
A.ok(/RUN_META\.size\s*>\s*\d+[\s\S]{0,40}RUN_META\.delete/.test(src), 'the ledger is capped (FIFO eviction once it grows past the cap)');

// it is exposed read-only as Chat.runMeta and the public API returns it.
A.ok(/function\s+runMeta\s*\(\s*id\s*\)/.test(src), 'a runMeta(id) accessor is defined');
A.ok(/return\s*\{[^}]*\brunMeta\b[^}]*\}/.test(src), 'runMeta is exported on the Chat public API');

// multi-agent COMMS routing stays centralized: task-board opens must route through App.openWorkstream(), which
// performs the focusAgent + Chat.load pair. Direct StationUI Workstreams.switch()+Chat.load calls caused identity
// drift for specialist-bound streams.
A.ok(/function\s+openWorkstream\s*\(\s*id\s*\)/.test(appSrc), 'App exposes a canonical openWorkstream(id) helper');
A.ok(/return\s*\{[^}]*\bopenWorkstream\b[^}]*\}/.test(appSrc), 'openWorkstream is exported on the App public API');
A.ok(/App\.openWorkstream/.test(stationSrc), 'StationUI task-board opens delegate to App.openWorkstream');

A.report('chat-runmeta.test');
