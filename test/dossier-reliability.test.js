/* node test/dossier-reliability.test.js — S2: the GROWTH dossier renders the RELIABILITY meter honestly.

   Companion to the pure-engine coverage in test/xp.test.js: that suite locks WHAT the meter computes, this
   one locks what the Commander actually SEES. The two things a rendered honest meter must never do are
   (a) show a percentage it has not earned, and (b) quietly shrink its own denominator — a run excluded from
   the ratio has to be NAMED on screen, or "100%" is a lie of omission.

   agGrowth is isolated from stationui.js the same way dossier-skin-accessibility.test.js isolates agCommand
   (the file is DOM/flow code, not node-loadable), but fed the REAL Xp engine so the rendered numbers are the
   engine's, not a fixture's. */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const A = require('./_assert.js');
const Xp = require('../frontend/app/xp.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'stationui.js'), 'utf8');
const start = source.indexOf('  function agGrowth(a) {');
const end = source.indexOf('\n  function agSkills(agentId) {', start);
A.ok(start >= 0 && end > start, 'the growth dossier renderer can be isolated from stationui.js');

const render = vm.runInNewContext(source.slice(start, end) + '\n  agGrowth;', {
  Xp,
  XpStore: { stationStats: () => null },
  present: [{ id: 'agent' }],
  esc: value => String(value),
});

// fold real events through the real engine — the same path the live app uses
const runEnd = (reason, runId) => ({ name: 'agent.run.end', payload: { agentId: 'a', runId: runId || 'r', reason, turns: 1, usd: 0 } });
function statsFrom(reasons) {
  let s = Xp.fresh();
  reasons.forEach((r, i) => { s = Xp.applyEvent(s, runEnd(r, 'r' + i)).stats; });
  return s;
}
const draw = reasons => render({ id: 'a', name: 'NOVA', role: 'orchestrator', stats: statsFrom(reasons) });

/* ---- 1. an uncalibrated meter shows a dash, never a number ---- */
const fresh = render({ id: 'a', name: 'NOVA', role: 'orchestrator', stats: Xp.fresh() });
A.ok(/Reliability/.test(fresh), 'the growth dossier renders a Reliability section');
A.ok(/CALIBRATING/.test(fresh.slice(fresh.indexOf('Reliability'))), 'an uncalibrated reliability renders CALIBRATING');
A.ok(/0 of 3 attributable runs so far/.test(fresh), 'it says how many attributable runs are still needed');
const freshTail = fresh.slice(fresh.indexOf('Reliability'));
A.ok(!/\d+<span style="font-size:18px;color:var\(--ph-dim\);">%/.test(freshTail), 'an uncalibrated reliability renders NO percentage at all');

/* ---- 2. a calibrated meter shows the engine's number, and the band that goes with it ---- */
const clean = draw(['done', 'done', 'done']);
const cleanTail = clean.slice(clean.indexOf('Reliability'));
A.ok(/100<span style="font-size:18px;color:var\(--ph-dim\);">%/.test(cleanTail), 'three clean runs render 100%');
A.ok(/DEPENDABLE/.test(cleanTail), '100% renders its band');
A.ok(/>3 <span class="gx-dim">\/<\/span> 3</.test(cleanTail), 'the finished/owned receipt shows the raw counts behind the %');

const shortfall = draw(['done', 'done', 'max_iters']);
const shortTail = shortfall.slice(shortfall.indexOf('Reliability'));
A.ok(/67<span style="font-size:18px;color:var\(--ph-dim\);">%/.test(shortTail), 'a run the agent owned but did not finish drags the % down');
A.ok(/>2 <span class="gx-dim">\/<\/span> 3</.test(shortTail), 'the receipt shows 2 of 3 finished');

/* ---- 3. THE LIE OF OMISSION GUARD — an excluded run must be named on screen ---- */
const faulted = draw(['done', 'done', 'done', 'error', 'cancelled']);
const faultTail = faulted.slice(faulted.indexOf('Reliability'));
A.ok(/100<span style="font-size:18px;color:var\(--ph-dim\);">%/.test(faultTail), 'provider faults + cancellations stay out of the ratio');
A.ok(/2 runs set aside/.test(faultTail), 'but the excluded runs are NAMED, never silently dropped from the denominator');
A.ok(/1 the provider failed/.test(faultTail), 'a provider fault is attributed to the provider, in words');
A.ok(/1 you stopped or it asked a question/.test(faultTail), 'a Commander stop is attributed to the Commander, in words');
A.ok(/never charged to this agent/.test(faultTail), 'and the readout says plainly that neither is the agent\'s fault');
A.ok(!/set aside/.test(cleanTail), 'an agent with nothing excluded shows no set-aside line at all');

/* ---- 4. the two meters stay legibly DISTINCT (they measure different things and may disagree) ---- */
A.ok(/Satisfaction/.test(clean) && /Reliability/.test(clean), 'Satisfaction and Reliability are separate sections');
A.ok(clean.indexOf('Satisfaction') < clean.indexOf('Reliability'), 'Reliability sits under Satisfaction (what you said, then what the station saw)');
A.ok(/what the station observed — Satisfaction above is what you said/.test(clean), 'the dossier states the difference between the two meters');
// the disagreement case is the whole point: a rated-well agent that keeps failing must show both truths
let mixed = statsFrom(['done', 'max_iters', 'max_iters']);
mixed = Xp.applyEvent(mixed, { name: 'memory.feedback', payload: { agentId: 'a', id: 'm1', delta: 2, reason: 'work_great' } }).stats;
const dis = render({ id: 'a', name: 'NOVA', role: 'orchestrator', stats: mixed });
A.ok(/33<span style="font-size:18px;color:var\(--ph-dim\);">%/.test(dis.slice(dis.indexOf('Reliability'))), 'a well-rated agent can still show a poor reliability — the meters are allowed to disagree');
A.ok(/FALTERING/.test(dis.slice(dis.indexOf('Reliability'))), 'and it bands honestly rather than softening it');

/* ---- 5. a pre-S2 save renders calibrating, never a back-filled number ---- */
const legacy = Xp.fresh(); legacy.counters = { runs: 40, tasksDone: 31, toolsOk: 90 };
const leg = render({ id: 'a', name: 'NOVA', role: 'orchestrator', stats: legacy });
const legTail = leg.slice(leg.indexOf('Reliability'));
A.ok(/CALIBRATING/.test(legTail), 'a save written before S2 renders CALIBRATING, not a percentage derived from older counters');
A.ok(!/100</.test(legTail), 'specifically: it never renders the fabricated 100% that reusing tasksDone would have produced');

A.report('dossier-reliability.test');
