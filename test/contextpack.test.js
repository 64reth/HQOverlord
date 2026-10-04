/* node test/contextpack.test.js — the PURE recency-weighted CONTEXT PACK (NS-2).

   Locks the guarantees the propose step's magic depends on, all as deterministic transforms over injected inputs +
   a fake `now` (no Date.now — passes lint-determinism):
     · BOUNDS — total text ≤ maxChars; each section capped in item count; per-line length clamped.
     · EXCLUSIONS — internal streamIds (nightshift-/cron-/workshop-) never appear; out-of-window rows dropped.
     · DETERMINISM — same inputs → byte-identical output (twice).
     · REDACTION — a secret in a chat body never reaches the pack (redact injected, applied to first-lines).
     · EVIDENCE POOL — activityLines carries the real run/chat/goal/landed lines (the veto's extended pool) + is bounded. */
'use strict';
const A = require('./_assert.js');
const CP = require('../sidecar/contextpack.js');

const T = 1700000000000;              // fixed "now"
const DAY = 86400000;
const ago = (d) => T - d * DAY;
A.eq(CP.assemble({ runs: [{ title: 'INTERNAL recommendation reasoning', ts: T, internal: true, streamId: '' }] }, { now: T }).counts.runs, 0,
  'Internal recommendation generation must never become evidence of user work');

// a fake redact that strips a known secret shape (stands in for context.js's redact).
const redact = (s) => String(s == null ? '' : s).replace(/sk-secret-[A-Za-z0-9]+/g, '[redacted]');

function baseInputs(over) {
  return Object.assign({
    runs: [
      { title: 'Ship the StarNet beta', ts: ago(1), streamId: '' },            // user run (empty stream = default)
      { title: 'Refactor the belt router', ts: ago(2), streamId: 'ws-main' },  // user run (named workstream)
      { title: 'night-shift: Busywork', ts: ago(0), streamId: 'nightshift-abc' }, // INTERNAL — must be excluded
      { title: 'cron digest', ts: ago(0), streamId: 'cron-xyz' },              // INTERNAL — must be excluded
      { title: 'workshop build', ts: ago(0), streamId: 'workshop-1' },         // INTERNAL — must be excluded
      { title: 'Ancient task', ts: ago(30), streamId: '' }                     // OUT OF WINDOW (>7d) — dropped
    ],
    chats: [
      { role: 'user', content: 'help me automate release notes\nsecond line', ts: ago(1), streamId: '' },
      { role: 'assistant', content: 'sure', ts: ago(1), streamId: '' },        // not a user turn — dropped
      { role: 'user', content: 'internal beat prompt', ts: ago(0), streamId: 'nightshift-x' }, // internal — dropped
      { role: 'user', content: 'my key is sk-secret-ABC123 keep it safe', ts: ago(2), streamId: '' } // secret — redacted
    ],
    briefs: [
      { originalDirective: 'Audit the recommendation system\nFocus on evidence provenance and replay evaluation', ts: ago(1) }
    ],
    goal: { text: 'Launch to 100 users', done: 2, total: 5, next: 'write onboarding' },
    landed: [
      { title: 'Release checklist tool', verdict: 'kept', ts: ago(1) },
      { title: 'A rambling essay', verdict: 'discarded', ts: ago(2) }
    ],
    beliefs: { goals: ['ship the beta'], stack: ['node', 'canvas'] },
    learn: { 'advance-goal': { up: 3, down: 0 }, 'scout': { up: 0, down: 2 } },
    redact
  }, over || {});
}

/* ---------- exclusions: internal streams + out-of-window ---------- */
(function exclusions() {
  const pack = CP.assemble(baseInputs(), { now: T });
  const worked = (pack.sections.find(s => s.label === 'What they worked on recently') || {}).lines || [];
  A.ok(worked.some(l => /Ship the StarNet beta/.test(l)), 'a user run appears');
  A.ok(worked.some(l => /Refactor the belt router/.test(l)), 'a named-workstream user run appears');
  A.ok(!worked.some(l => /Busywork|cron digest|workshop build/.test(l)), 'internal-stream runs are excluded');
  A.ok(!worked.some(l => /Ancient task/.test(l)), 'out-of-window (>7d) run is excluded');
  // and the excluded ones are not in the evidence pool either:
  A.ok(!pack.activityLines.some(l => /Busywork|cron digest/.test(l)), 'internal runs are not in the evidence pool');
})();

/* ---------- redaction ---------- */
(function redaction() {
  const pack = CP.assemble(baseInputs(), { now: T });
  const all = pack.text + '\n' + pack.activityLines.join('\n');
  A.ok(all.indexOf('sk-secret-ABC123') < 0, 'the raw secret never reaches the pack');
  A.ok(all.indexOf('[redacted]') >= 0, 'the secret was redacted (backstop applied to chat first-lines)');
  // first-line only: the second line of the multi-line chat must not appear.
  A.ok(all.indexOf('second line') < 0, 'only the FIRST line of a chat is carried (not the whole body)');
})();

/* ---------- goal + landed + learn sections ---------- */
(function sections() {
  const pack = CP.assemble(baseInputs(), { now: T });
  const goalSec = pack.sections.find(s => s.label === 'Their current goal');
  A.ok(goalSec && /Launch to 100 users/.test(goalSec.lines[0]) && /2\/5 done/.test(goalSec.lines[0]) && /onboarding/.test(goalSec.lines[0]), 'goal line carries text + progress + next');
  const landedSec = pack.sections.find(s => s.label === 'Recent work they kept vs discarded');
  A.ok(landedSec && landedSec.lines.some(l => /Release checklist tool.*kept/.test(l)) && landedSec.lines.some(l => /rambling essay.*discarded/.test(l)), 'landed section marks kept vs discarded');
  const learnSec = pack.sections.find(s => s.label === 'What they tend to keep');
  A.ok(learnSec && /advance-goal/.test(learnSec.lines[0]) && /scout/.test(learnSec.lines[0]), 'learn line names up/down archetypes');
  // the goal + landed lines are in the evidence pool (candidates may ground on them):
  A.ok(pack.activityLines.some(l => /Launch to 100 users/.test(l)), 'goal line is in the evidence pool');
  A.ok(pack.activityLines.some(l => /Release checklist tool/.test(l)), 'a landed line is in the evidence pool');
  const briefSec = pack.sections.find(s => s.label === 'Completed task evidence');
  A.ok(briefSec && /evidence provenance and replay evaluation/.test(briefSec.lines[0]), 'completed briefs retain evidence beyond the first directive line');
  A.eq(pack.counts.briefs, 1, 'completed brief evidence is counted explicitly');
})();

/* ---------- determinism: same inputs → byte-identical ---------- */
(function determinism() {
  const a = CP.assemble(baseInputs(), { now: T });
  const b = CP.assemble(baseInputs(), { now: T });
  A.eq(a.text, b.text, 'text is deterministic');
  A.eq(a.activityLines.join('|'), b.activityLines.join('|'), 'evidence pool is deterministic');
  A.eq(JSON.stringify(a.counts), JSON.stringify(b.counts), 'counts are deterministic');
})();

/* ---------- bounds: char cap, item caps, line clamp ---------- */
(function bounds() {
  // a firehose: many runs + a giant title.
  const bigRuns = [];
  for (let i = 0; i < 50; i++) bigRuns.push({ title: 'Task number ' + i + ' ' + 'x'.repeat(400), ts: ago(1) - i, streamId: '' });
  const pack = CP.assemble(baseInputs({ runs: bigRuns }), { now: T, maxChars: 500 });
  A.ok(pack.text.length <= 500, 'total text respects maxChars (got ' + pack.text.length + ')');
  const worked = (pack.sections.find(s => s.label === 'What they worked on recently') || {}).lines || [];
  A.ok(worked.length <= CP.MAX_RUNS, 'run section capped to MAX_RUNS (' + worked.length + ')');
  A.ok(worked.every(l => l.length <= CP.LINE_MAX + 20), 'each run line is clamped near LINE_MAX');
  A.ok(pack.activityLines.length <= CP.ACTIVITY_POOL_MAX, 'evidence pool capped to ACTIVITY_POOL_MAX');
})();

/* ---------- empty night: honest empty pack ---------- */
(function empty() {
  const pack = CP.assemble({ runs: [], chats: [], goal: null, landed: [], beliefs: {}, learn: {} }, { now: T });
  A.eq(pack.text, '', 'a truly empty night yields empty text (nothing fabricated)');
  A.eq(pack.activityLines.length, 0, 'an empty night yields an empty evidence pool');
  A.eq(pack.counts.runs, 0, 'zero runs counted');
})();

/* ---------- isInternalStream unit ---------- */
A.eq(CP.isInternalStream('nightshift-abc'), true, 'nightshift- is internal');
A.eq(CP.isInternalStream('cron-1'), true, 'cron- is internal');
A.eq(CP.isInternalStream('workshop-9'), true, 'workshop- is internal');
A.eq(CP.isInternalStream(''), false, 'empty stream (default browser run) is NOT internal');
A.eq(CP.isInternalStream('ws-main'), false, 'a user workstream is NOT internal');

/* ---------- dayTag unit ---------- */
A.eq(CP.dayTag(T, T), 'today', 'same day → today');
A.eq(CP.dayTag(ago(1), T), 'yesterday', '1 day → yesterday');
A.eq(CP.dayTag(ago(3), T), '3d ago', '3 days → Nd ago');
A.eq(CP.dayTag(0, T), '', 'undated → empty tag');

setTimeout(() => A.report('contextpack.test'), 30);
