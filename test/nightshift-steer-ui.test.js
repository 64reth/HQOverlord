/* node test/nightshift-steer-ui.test.js — the machine assertion the SETTINGS › NIGHT SHIFT steer input +
   LAST REPORT button (ui/system/ns-steer,ns-steer-set,ns-report-btn, finding bec0f139) were missing. The
   route contract (POST/GET/DELETE /api/nightshift/focus) is already proven by nightshift-focus.e2e.test.js;
   what had no committed guard was the DOM half: that #ns-steer's value drives the POST body, that the readout
   repaints from the ROUTE's response (server truth, never an optimistic flip), and that LAST REPORT fetches
   the truthful surfaces and renders NightReport.compose (not a cached copy).

   Two levels, each honest:
     1. GENUINE — NightReport.compose (the pure engine LAST REPORT renders) is require-able: an empty night
        composes hasReport:false; a night with acts composes a real headline. This is the render truth.
     2. SOURCE-LOCK the DOM→fetch wiring inside the StationUI IIFE (browser-flow, fetch-bound — not node-loadable),
        matching the settings-p1-ui / outbox-window house pattern.

   OUT OF SCOPE HERE (covered elsewhere): the route's validation/persistence contract = nightshift-focus.e2e.test.js. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const NightReport = require('../frontend/app/nightreport.js');

/* ---- 1. GENUINE: the LAST REPORT engine composes real truth from route surfaces ---- */
const now = Date.now(), awaySince = now - 24 * 3600 * 1000;
const empty = NightReport.compose({ status: null, ledger: [], drafts: [], awaySince, nowMs: now, tzOffsetMin: 0 });
A.ok(empty && empty.hasReport === false, 'an empty night composes hasReport:false (LAST REPORT shows the honest "nothing ran" copy)');
const acted = NightReport.compose({
  status: { focus: { source: 'steer', kind: 'goal', ref: 'ship the thing' } },
  ledger: [{ ts: now - 3600000, kind: 'act', reason: 'built the report card', source: 'nightshift' }],
  drafts: [], awaySince, nowMs: now, tzOffsetMin: 0
});
A.ok(acted && acted.hasReport === true && typeof acted.headline === 'string' && acted.headline, 'a night with an act composes a real headline (the report the button renders)');

/* ---- 2. SOURCE-LOCK the DOM→fetch steer + report wiring ---- */
const src = fs.readFileSync(path.join(__dirname, '../frontend/app/stationui.js'), 'utf8');

// the controls render with accessible ids
A.ok(/id="ns-steer"/.test(src), 'the NIGHT SHIFT panel renders the #ns-steer text input');
A.ok(/id="ns-steer-set"/.test(src) && /id="ns-steer-clear"/.test(src), 'the panel renders STEER + CLEAR buttons');
A.ok(/id="ns-report-btn"/.test(src) && /id="ns-report"/.test(src), 'the panel renders the LAST REPORT button + its container');

// STEER: #ns-steer.value → POST /api/nightshift/focus body, kinds parsed, readout from the ROUTE
A.ok(/nsSteer\s*=\s*host\.querySelector\('#ns-steer'\)/.test(src), '#ns-steer is bound as a live handle');
A.ok(/const raw = nsSteer \? String\(nsSteer\.value\)\.trim\(\) : ''/.test(src), 'STEER reads the input value (the DOM→body link)');
A.ok(/raw\.toLowerCase\(\) === 'goal'[\s\S]{0,40}kind = 'goal'/.test(src), 'the literal "goal" selects the goal kind');
A.ok(/\^thread:[\s\S]{0,60}kind = 'thread'/.test(src), '"thread:<id>" selects the thread kind and strips the prefix');
A.ok(/fetch\('\/api\/nightshift\/focus', \{ method: 'POST'[\s\S]{0,140}JSON\.stringify\(kind \? \{ ref, kind \} : \{ ref \}\)/.test(src),
  'the steer POSTs /api/nightshift/focus with { ref } (or { ref, kind }) — the value drives the request body');
A.ok(/if \(!ok \|\| !j \|\| j\.ok === false\)[\s\S]{0,80}steerMsg/.test(src), 'a rejected steer surfaces the ROUTE\'s error (never an optimistic success)');
A.ok(/refreshPanel\(\);\s*\/\/ repaint FOCUS from the status route/.test(src) || /sfx\('click'\); refreshPanel\(\);/.test(src), 'a successful steer repaints the FOCUS readout from the status route (server truth)');

// CLEAR: DELETE the steer
A.ok(/nsSteerClear[\s\S]{0,200}fetch\('\/api\/nightshift\/focus', \{ method: 'DELETE' \}\)/.test(src), 'CLEAR DELETEs /api/nightshift/focus');

// LAST REPORT: fetch the three truthful surfaces + compose (not a cached copy)
A.ok(/nsReportBtn\.addEventListener\('click', \(\) => \{ renderLastReport\(\)/.test(src), 'the LAST REPORT button triggers renderLastReport');
A.ok(/getJSON\('\/api\/nightshift\/status'\)/.test(src) && /getJSON\('\/api\/autonomy\/ledger\?source=nightshift/.test(src) && /getJSON\('\/api\/nightshift\/drafts/.test(src),
  'LAST REPORT fetches the status + ledger + drafts route surfaces (truthful telemetry, not a frontend cache)');
A.ok(/rep = NightReport\.compose\(\{ status, ledger, drafts/.test(src), 'LAST REPORT renders through NightReport.compose (the pure engine unit-tested above)');
A.ok(/if \(!rep \|\| !rep\.hasReport\)/.test(src), 'an empty night renders the honest "no report" copy, never a fabricated digest');

A.report('nightshift-steer-ui');
