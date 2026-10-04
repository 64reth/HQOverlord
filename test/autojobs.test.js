/* node test/autojobs.test.js — the PURE self-initiation engine (frontend/app/autojobs.js), Slice 2 of the
   autonomy layer. Locks the disciplines that keep proposed standing jobs honest:
     - shouldPropose(): posture-gated (autonomy on), graduation-first (after the First Pitch), knows-enough, not
       already-proposed, not drowning in routines — every quiet outcome carries a reason.
     - buildProposalDirective(): hands the model the real beliefs, demands GROUNDING + the achievable-unattended
       envelope (no tools/web/writes), a cadence id from the curated menu, and the strict tagged format.
     - parseProposals(): drops any block missing a title / grounds / run (the grounding gate); clamps the cadence to
       the menu; caps the count.
     - CADENCES: every curated schedule string actually PARSES in the real sidecar/cron.js (cross-lock — a routine
       can never be created with an unschedulable expression).
     - toCronBody(): maps a proposal to a valid POST /api/cron body (recurring forever).
   Pure + deterministic — no clock, no RNG. */
'use strict';
const A = require('./_assert.js');
const J = require('../frontend/app/autojobs.js');
const cron = require('../sidecar/cron.js');   // the REAL cron-math core — cross-lock the cadence strings against it

const NOW = 1_750_000_000_000;   // a fixed epoch ms (pure test — no Date.now); cron.parseSchedule needs a `now`

/* ---------- CADENCES are all real, schedulable expressions ---------- */
A.ok(J.CADENCES.length >= 3, 'there is a small curated cadence menu');
for (const c of J.CADENCES) {
  A.ok(c.id && c.label && c.schedule, 'cadence "' + (c.id || '?') + '" has id/label/schedule');
  const parsed = cron.parseSchedule(c.schedule, NOW);
  A.ok(parsed && (parsed.kind === 'cron' || parsed.kind === 'interval'), 'cadence "' + c.id + '" → a valid cron/interval schedule ("' + c.schedule + '")');
}
A.ok(J.CADENCES.some(c => c.id === J.DEFAULT_CADENCE), 'the default cadence is in the menu');
A.eq(J.cadenceById('nope').id, J.DEFAULT_CADENCE, 'an unknown cadence id falls back to the default');
A.eq(J.cadenceById('weekly').id, 'weekly', 'a known cadence id resolves');

/* ---------- shouldPropose(): the proactive gate ---------- */
const ready = { enabled: true, alreadyProposed: false, firstPitchDone: true, knownDims: ['goals', 'pain'], existingJobCount: 0 };
A.eq(J.shouldPropose(ready), { go: true, reason: 'ready' }, 'autonomy on + graduated + knows enough → propose');
A.eq(J.shouldPropose(Object.assign({}, ready, { enabled: false })), { go: false, reason: 'autonomy-off' }, 'never proposes when autonomy is off (Initiative wait)');
A.eq(J.shouldPropose(Object.assign({}, ready, { alreadyProposed: true })), { go: false, reason: 'already-proposed' }, 'the proactive offer is fire-once');
A.eq(J.shouldPropose(Object.assign({}, ready, { firstPitchDone: false })), { go: false, reason: 'no-first-pitch' }, 'graduation first — never before the First Pitch');
A.eq(J.shouldPropose(Object.assign({}, ready, { knownDims: ['pain'] })), { go: false, reason: 'missing:goals' }, 'cannot propose standing work without knowing the goal');
A.eq(J.shouldPropose(Object.assign({}, ready, { knownDims: ['goals'] })), { go: false, reason: 'too-cold' }, 'stays quiet until it knows enough dims');
A.eq(J.shouldPropose(Object.assign({}, ready, { existingJobCount: 8 })), { go: false, reason: 'enough-jobs' }, 'does not pile on when many routines already exist');
A.eq(J.shouldPropose({}).go, false, 'defensive: empty state never proposes, never throws');

/* ---------- buildProposalDirective(): grounded, achievable-now, strict ---------- */
const dir = J.buildProposalDirective({
  beliefs: { goals: ['ship StarNet'], pain: ['loses time to manual standups'], ambition: ['write a book'], stack: ['node, git'] },
  existingJobs: ['Morning brief'],
  max: 3
});
A.ok(/ship StarNet/.test(dir) && /manual standups/.test(dir) && /write a book/.test(dir), 'the directive hands the model the real beliefs to ground on');
A.ok(/GROUNDED|ground it/i.test(dir), 'the directive demands grounding');
A.ok(/no tools|NO web|NO file writes|NO sending|without|unattended/i.test(dir), 'the directive constrains to the achievable-unattended (reason/draft) envelope');
A.ok(/Morning brief/.test(dir), 'the directive tells it not to duplicate existing routines');
A.ok(/JOB:/.test(dir) && /WHY:/.test(dir) && /GROUNDS:/.test(dir) && /CADENCE:/.test(dir) && /RUN:/.test(dir), 'the directive demands the strict tagged format');
for (const c of J.CADENCES) A.ok(dir.indexOf(c.id) >= 0, 'the directive lists cadence id "' + c.id + '"');
A.eq(J.buildProposalDirective({ beliefs: {} }), J.buildProposalDirective({ beliefs: {} }), 'buildProposalDirective is deterministic');

/* ---------- parseProposals(): grounding VETO + cadence clamp + cap ----------
   The evidence pool is the caller's obligation (autojobstore passes the SAME belief map it grounded the directive
   with). A parse with no pool grounds nothing and every proposal dies — fail-closed, exactly like the night
   shift's parseCandidates, because the failure this gate replaces was INVENTING standing work. */
const POOL = {
  goals: ['ship the invoice rewrite this quarter', 'a real goal'],
  pain: ['loses time to manual standups', 'a goal'],
  ambition: ['write a book someday'],
  stack: ['prometheus dashboards', 'kubernetes cluster', 'postgres backups', 'terraform modules']
};
const reply = [
  'JOB: Standup draft',
  'WHY: kills the manual standup pain',
  'GROUNDS: loses time to manual standups',
  'CADENCE: morning',
  'RUN: Draft today\'s standup from what you know and leave it on the desk.',
  '',
  'JOB: Book nudge',
  'WHY: moves toward the book ambition',
  'GROUNDS: write a book',
  'CADENCE: weekly',
  'RUN: Draft one concrete next step toward the book.'
].join('\n');
const props = J.parseProposals(reply, { beliefs: POOL });
A.eq(props.length, 2, 'parses every well-formed block');
A.eq(props[0].title, 'Standup draft', 'reads the job title');
A.eq(props[0].cadenceId, 'morning', 'reads a valid cadence');
A.ok(props[0].prompt.indexOf('Draft today') >= 0, 'the RUN instruction becomes the job prompt');
A.eq(props[1].cadenceId, 'weekly', 'reads the second cadence');

// grounding gate: a block with no GROUNDS (or no RUN) is dropped
const ungrounded = 'JOB: Vague thing\nWHY: seems nice\nCADENCE: morning\nRUN: do something';
A.eq(J.parseProposals(ungrounded, { beliefs: POOL }).length, 0, 'a block missing GROUNDS is dropped (no grounding, no candidate)');
const noRun = 'JOB: Titled\nGROUNDS: a real goal\nCADENCE: morning';
A.eq(J.parseProposals(noRun, { beliefs: POOL }).length, 0, 'a block missing RUN is dropped');
// unknown cadence clamps to default
const badCad = 'JOB: X\nGROUNDS: a goal\nCADENCE: yearly\nRUN: think about X';
A.eq(J.parseProposals(badCad, { beliefs: POOL })[0].cadenceId, J.DEFAULT_CADENCE, 'an unknown cadence clamps to the default');
// tolerant of chatter + case; caps at max
const messy = ['sure! here you go:', '', 'job: one', 'grounds: prometheus dashboards', 'run: r1', '',
  'JOB: two', 'GROUNDS: the kubernetes cluster', 'RUN: r2', '',
  'JOB: three', 'GROUNDS: postgres backups', 'RUN: r3', '',
  'JOB: four', 'GROUNDS: terraform modules', 'RUN: r4'].join('\n');
A.eq(J.parseProposals(messy, { max: 3, beliefs: POOL }).length, 3, 'parse is case-insensitive, ignores chatter, and caps at max');
A.eq(J.parseProposals('no jobs here', { beliefs: POOL }), [], 'an unparseable reply → [] (caller handles gracefully)');
A.eq(J.parseProposals('', { beliefs: POOL }), [], 'empty reply → []');

/* THE VETO ITSELF — a perfectly-formatted block whose GROUNDS the station has never heard of. This is the whole
   point: the block below is INDISTINGUISHABLE from a good one by shape, and approving it would have written a
   cron job that wakes unattended forever under a beat that says "now that i know you". */
const invented = ['JOB: Competitor digest', 'WHY: keeps you ahead',
  'GROUNDS: you mentioned tracking competitor pricing announcements weekly',
  'CADENCE: weekly', 'RUN: Draft a competitor digest from what you know.'].join('\n');
A.eq(J.parseProposals(invented, { beliefs: POOL }).length, 0, 'invented grounding is VETOED, not scheduled');
A.eq(J.parseProposals(reply, { beliefs: {} }).length, 0, 'an EMPTY evidence pool grounds nothing — fail-closed');
A.eq(J.parseProposals(reply).length, 0, 'and a caller that supplies no pool at all gets nothing (never a silent pass)');
// …and a paraphrase of something real still survives: the veto is a structural floor, not a semantic judge.
const paraphrase = ['JOB: Standup helper', 'GROUNDS: the manual standups that eat their time',
  'CADENCE: morning', 'RUN: Draft the standup.'].join('\n');
A.eq(J.parseProposals(paraphrase, { beliefs: POOL }).length, 1, 'a paraphrase of a REAL belief is not vetoed');

/* ---------- toCronBody(): a valid POST /api/cron body ---------- */
const body = J.toCronBody({ title: 'Standup draft', prompt: 'Draft the standup.', cadenceId: 'morning' });
A.eq(body.name, 'Standup draft', 'name = the title');
A.eq(body.prompt, 'Draft the standup.', 'prompt = the RUN instruction');
A.eq(body.schedule, '0 9 * * *', 'schedule = the cadence schedule string');
A.eq(body.repeat, { times: null }, 'recurring forever (repeat.times null)');
A.eq(body.agentId, 'agent', 'runs as the hero');
A.ok(cron.parseSchedule(body.schedule, NOW), 'the cron body schedule actually parses (end-to-end)');
// a missing/odd title still yields a safe, capped name
A.ok(J.toCronBody({}).name.length > 0 && J.toCronBody({}).name.length <= J.NAME_CHARS, 'toCronBody always yields a non-empty, capped name');

/* ---------- presentation helpers ---------- */
A.eq(J.introLine(0), '', 'no intro for zero proposals');
A.ok(/want it/i.test(J.introLine(1)), 'singular intro for one proposal');
A.ok(/pick the ones/i.test(J.introLine(3)), 'plural intro for several');
A.ok(J.proposalLines({ title: 'Standup draft', cadenceId: 'morning', why: 'kills the standup' })[0].indexOf('every morning') >= 0, 'a proposal line shows the title + cadence label');
const ch = J.approveChoices();
A.eq(ch.map(c => c.value), ['yes', 'no'], 'approval is schedule-it / skip');
A.ok(/anytime/i.test(J.doneLine(0)), 'declining-all points them at ROUTINES for later');
A.ok(/schedule/i.test(J.doneLine(2)), 'scheduling a couple confirms it');

/* ---------- cadenceLabel(): timezone-honest wall-clock labels (item #4) ---------- */
A.eq(J.cadenceLabel('morning'), 'every morning · 9:00', 'a wall-clock cadence names the hour (no tz claim without localTz)');
A.eq(J.cadenceLabel('morning', { localTz: true }), 'every morning · 9:00 (your local time)', 'with a persisted device tz it claims "your local time"');
A.eq(J.cadenceLabel('weekly', { localTz: true }), 'every Monday morning · 9:00 (your local time)', 'the weekly wall-clock cadence too');
A.eq(J.cadenceLabel('sixhourly', { localTz: true }), 'every 6 hours', 'an INTERVAL cadence names no hour — never a fabricated time, even asked for local');
A.eq(J.cadenceLabel('hourly'), 'every hour', 'the hourly interval label is unchanged');
A.eq(J.cadenceLabel('nope', { localTz: true }), 'every morning · 9:00 (your local time)', 'an unknown id falls back to the default cadence label');

/* ---------- toCronBody(): persists the device tz for a wall-clock cadence (item #4) ---------- */
// deviceTz() resolves from Intl at author time; in this node test it returns a real zone or '' — either is honest.
const tz = J.deviceTz();
const bodyM = J.toCronBody({ title: 'Morning brief', prompt: 'x', cadenceId: 'morning' });
if (tz) { A.eq(bodyM.tz, tz, 'a wall-clock cadence body carries the resolved device tz so it fires on LOCAL 9:00'); }
else { A.ok(!('tz' in bodyM), 'no resolvable tz → the body stays tz-less (host default applies), never a fake tz'); }
const bodyI = J.toCronBody({ title: 'Six-hourly', prompt: 'x', cadenceId: 'sixhourly' });
A.ok(!('tz' in bodyI), 'an INTERVAL cadence never carries a tz (no local wall-clock anchor to honor)');

/* ---------- armStateLine(): the routines-disarmed truth keys on the SCHEDULER, not autonomy (item #1) ---------- */
A.eq(J.armStateLine(true), null, 'scheduler armed → no disarmed line (nothing to warn about)');
const dis = J.armStateLine(false);
A.ok(dis && /scheduler is off/i.test(dis.text), 'scheduler off → an honest "scheduler is off" line');
A.ok(dis && !/autonomy/i.test(dis.text), 'the disarmed line NEVER blames Autonomy (cron firing does not gate on the autonomy dial)');
A.ok(dis && dis.cta && dis.cta.panel === 'routines', 'the disarmed CTA routes to the ROUTINES panel (where scheduling is armed)');
A.ok(J.armStateLine(undefined) && /scheduler is off/i.test(J.armStateLine(undefined).text), 'unknown arm-state defaults to the honest disarmed warning');

/* ---------- doneLine(): honest when the scheduler that fires the job is OFF ---------- */
A.ok(/won'?t run|OFF/i.test(J.doneLine(1, false)), 'scheduler off → the done-line admits it won\'t run yet');
A.ok(/enable scheduling/i.test(J.doneLine(2, false)), 'scheduler off → the done-line points at enabling scheduling');
A.ok(!/won'?t run/i.test(J.doneLine(1, true)), 'scheduler armed → the normal, confident done-line');

A.report('autojobs.test');
