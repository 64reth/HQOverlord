/* node test/qa-ledger.test.js — the Self-Testing Station's findings spine (lane Q0),
   fed an in-memory io + a controllable clock (zero disk). Asserts the Part-5 laws:
   fingerprint dedup (same defect files once), known/dismissed refusal (anti-nag),
   evidence-required rejection (no vibes-findings), a readable digest grouped by
   severity+crew, a per-crew status roll-up, and graceful malformed-input handling.
   Pure + deterministic — ts always comes from the injected clock, never Date.now(). */
'use strict';
const A = require('./_assert.js');
const { makeLedger, fingerprintOf } = require('../scripts/qa/ledger.mjs');

// an in-memory io: findings live in an inspectable array; known fingerprints are a Set we control.
function memIo(seedFindings, knownSet) {
  const rows = (seedFindings || []).slice();
  const known = knownSet || new Set();
  return {
    rows, known,
    listFindings() { return rows.map(r => Object.assign({}, r)); },
    writeFinding(f) { rows.push(Object.assign({}, f)); },
    knownFingerprints() { return known; }
  };
}
let clk = 1000;
const clock = { now: () => clk };

const base = (over) => Object.assign({
  crew: 'Green Guardian', severity: 'P1', title: 'a real finding',
  detail: 'something broke', evidence: ['.bugloops/x/shot.png'],
  checkId: 'chk', subject: 'the broken thing'
}, over || {});

// ---- A. fingerprint dedup: the SAME finding filed twice writes exactly ONE file ----
{
  const io = memIo();
  const L = makeLedger({ io, clock });
  const r1 = L.add(base());
  A.eq(r1.ok, true, 'first add accepted');
  A.eq(r1.status, 'added', 'first add is a fresh add');
  const r2 = L.add(base());                       // identical -> same fingerprint
  A.eq(r2.ok, true, 'second add is still ok (idempotent)');
  A.eq(r2.status, 'duplicate', 'second add is a duplicate, not a new file');
  A.eq(io.rows.length, 1, 'only ONE finding persisted despite two adds');
  A.eq(L.count(), 1, 'in-memory count stays at one');
  A.eq(r1.finding.fingerprint, r2.finding.fingerprint, 'both share one stable fingerprint');
}

// ---- B. known/dismissed fingerprints are REFUSED on re-add (anti-nag law) ----
{
  // B1: fingerprint listed in the KNOWN baseline (io.knownFingerprints) is refused.
  const fp = fingerprintOf({ crew: 'Visual Auditor', checkId: 'VA-3', subject: 'undimmed floor' });
  const io = memIo([], new Set([fp]));
  const L = makeLedger({ io, clock });
  const res = L.add(base({ crew: 'Visual Auditor', checkId: 'VA-3', subject: 'undimmed floor' }));
  A.eq(res.ok, false, 'a known-baseline fingerprint is refused');
  A.eq(res.status, 'refused', 'refusal status is explicit');
  A.ok(/known-or-dismissed/.test(res.reason), 'refusal reason names the anti-nag rule');
  A.eq(io.rows.length, 0, 'nothing persisted for a known fingerprint');

  // B2: a finding already ON DISK with status 'dismissed' also suppresses its fingerprint.
  const dfp = fingerprintOf({ crew: 'Janitor', checkId: 'dead-doc', subject: 'stale ref' });
  const io2 = memIo([{ id: 'seed', fingerprint: dfp, crew: 'Janitor', severity: 'P2', status: 'dismissed', evidence: ['x'], title: 't' }]);
  const L2 = makeLedger({ io: io2, clock });
  const r = L2.add(base({ crew: 'Janitor', checkId: 'dead-doc', subject: 'stale ref' }));
  A.eq(r.ok, false, 'a dismissed on-disk fingerprint is refused');
  A.eq(r.status, 'refused', 'dismissed -> refused');
  A.eq(io2.rows.length, 1, 'no new file for a dismissed fingerprint (only the seed remains)');
}

// ---- C. evidence-required: a finding with NO evidence path is REJECTED ----
{
  const io = memIo();
  const L = makeLedger({ io, clock });
  A.eq(L.add(base({ evidence: [] })).status, 'rejected', 'empty evidence array rejected');
  A.eq(L.add(base({ evidence: undefined })).status, 'rejected', 'missing evidence rejected');
  A.eq(L.add(base({ evidence: ['   '] })).status, 'rejected', 'whitespace-only evidence rejected');
  A.eq(L.add(base({ evidence: null })).status, 'rejected', 'null evidence rejected');
  A.eq(io.rows.length, 0, 'no vibes-finding ever persisted');
  // a single string is coerced to a one-element array and accepted.
  const ok = L.add(base({ evidence: 'log.txt', subject: 'evidence-as-string' }));
  A.eq(ok.ok, true, 'a lone evidence string is accepted');
  A.eq(ok.finding.evidence, ['log.txt'], 'string evidence coerced to a one-element array');
}

// ---- D. digest renders a readable report grouped by severity then crew ----
{
  const io = memIo();
  const L = makeLedger({ io, clock });
  clk = 2001; L.add(base({ crew: 'Green Guardian', severity: 'P0', title: 'test suite red', subject: 'suite/foo', evidence: ['.bugloops/a.log'] }));
  clk = 2002; L.add(base({ crew: 'Beginner Run', severity: 'P1', title: 'stuck at create-agent', subject: 'step/create', evidence: ['.bugloops/b.png'] }));
  clk = 2003; L.add(base({ crew: 'Janitor', severity: 'P2', title: 'root PNG litter', subject: 'root/*.png', evidence: ['.bugloops/c.txt'] }));
  const md = L.digest({ date: '2026-07-01' });
  A.ok(/# QA morning digest — 2026-07-01/.test(md), 'digest has a dated header');
  A.ok(/\*\*3\*\* open findings/.test(md), 'digest counts 3 open findings');
  A.ok(/1 P0 · 1 P1 · 1 P2/.test(md), 'digest severity tallies rendered');
  A.ok(/## P0 \(1\)/.test(md), 'P0 section present');
  A.ok(/### Green Guardian/.test(md), 'crew sub-heading present');
  A.ok(/test suite red/.test(md), 'a finding title is rendered');
  A.ok(/evidence: `\.bugloops\/a\.log`/.test(md), 'evidence path is rendered');
  // P0 must sort before P2 in the output (severity ordering).
  A.ok(md.indexOf('## P0') < md.indexOf('## P2'), 'P0 renders before P2');
  // fixed/dismissed findings drop out of the digest.
  L.add(base({ crew: 'Overseer', severity: 'P0', title: 'already handled', subject: 'done/thing', status: 'fixed', evidence: ['x'] }));
  A.ok(!/already handled/.test(L.digest({ date: 'd' })), 'a fixed finding is excluded from the digest');
}

// ---- D2. an empty ledger digests to a clean "all clear" report ----
{
  const L = makeLedger({ io: memIo(), clock });
  const md = L.digest({ date: '2026-07-01' });
  A.ok(/No open findings/.test(md), 'empty ledger -> all-clear digest');
  A.ok(/\*\*0\*\* open findings/.test(md), 'empty ledger reports zero');
}

// ---- E. status(): per-crew roll-up with every seat, open counts, worst severity ----
{
  const io = memIo();
  const L = makeLedger({ io, clock });
  clk = 3001; L.add(base({ crew: 'Green Guardian', severity: 'P2', title: 'minor', subject: 's1', evidence: ['x'] }));
  clk = 3005; L.add(base({ crew: 'Green Guardian', severity: 'P0', title: 'major', subject: 's2', evidence: ['y'] }));
  const s = L.status();
  A.eq(s.crews['Green Guardian'].findings, 2, 'guardian has two findings');
  A.eq(s.crews['Green Guardian'].open, 2, 'both open');
  A.eq(s.crews['Green Guardian'].worstSeverity, 'P0', 'worst severity is P0');
  A.eq(s.crews['Green Guardian'].lastTs, 3005, 'last finding ts is the newest');
  A.eq(s.crews['Janitor'].findings, 0, 'a quiet crew still appears with zero');
  A.ok(/\| Green Guardian \| 2 \| 2 \| P0 \|/.test(s.markdown), 'markdown table row for the busy crew');
  A.ok(/\| Beginner Run \| 0 \| 0 \|/.test(s.markdown), 'markdown shows every seat');

  // Staleness columns: the oldest open finding's age and the count older than 30 days, both from
  // the injected clock. A quiet seat renders '—' for both (never a fake 0d).
  const DAY = 86400000;
  clk = 3005 + 45 * DAY;                                   // 45 days after the newest finding
  const s2 = L.status();
  A.eq(s2.staleDays, 30, 'the stale threshold is exposed');
  A.eq(s2.crews['Green Guardian'].oldestOpenDays, 45, 'oldest open age is measured from the injected clock');
  A.eq(s2.crews['Green Guardian'].staleOpen, 2, 'both findings are older than 30 days');
  A.eq(s2.crews['Janitor'].oldestOpenDays, null, 'a seat with nothing open has no age');
  A.ok(/\| Oldest open \| >30d \|/.test(s2.markdown), 'markdown header carries the staleness columns');
  A.ok(/\| Green Guardian \| 2 \| 2 \| P0 \| 3005 \| 45d \| 2 \|/.test(s2.markdown), 'busy crew row shows 45d and 2 stale');
  A.ok(/\| Janitor \| 0 \| 0 \| — \| — \| — \| — \|/.test(s2.markdown), 'quiet seat renders dashes, not 0d');
  // a fixed finding never ages the backlog: fix one, the oldest-open moves to the other.
  const io2 = memIo();
  const L2 = makeLedger({ io: io2, clock });
  clk = 5000; L2.add(base({ subject: 'old-but-fixed', status: 'fixed', evidence: ['x'] }));
  clk = 5000 + 10 * DAY; L2.add(base({ subject: 'young-open', evidence: ['y'] }));
  clk = 5000 + 12 * DAY;
  A.eq(L2.status().crews['Green Guardian'].oldestOpenDays, 2, 'a fixed row is excluded from the oldest-open age');
  A.eq(L2.status().crews['Green Guardian'].staleOpen, 0, 'a fixed row never counts as stale');
}

// ---- F. malformed input coerces to a safe finding (never throws), fields clamped ----
{
  const io = memIo();
  const L = makeLedger({ io, clock });
  // garbage severity/crew/status -> safe defaults; evidence present so it is accepted.
  clk = 4000;
  let res;
  A.notThrows(() => { res = L.add({ severity: 'KABOOM', crew: '', status: 'nonsense', title: 'ok', evidence: ['e'], subject: 'x' }); }, 'malformed add does not throw');
  A.eq(res.ok, true, 'malformed-but-evidenced finding is accepted');
  A.eq(res.finding.severity, 'P2', 'unknown severity clamped to P2');
  A.eq(res.finding.crew, 'Unknown', 'blank crew -> Unknown');
  A.eq(res.finding.status, 'open', 'unknown status clamped to open');
  A.eq(res.finding.ts, 4000, 'ts stamped from the injected clock (not Date.now)');
  // an entirely-empty add is rejected for missing evidence, and does not throw.
  A.notThrows(() => { res = L.add({}); }, 'empty add does not throw');
  A.eq(res.status, 'rejected', 'empty add rejected (no evidence)');
  // a title-less but evidenced finding is rejected too.
  A.eq(L.add({ evidence: ['e'] }).status, 'rejected', 'missing title rejected');
  // title is length-capped so a pathological blob cannot bloat a finding file.
  const big = L.add(base({ title: 'x'.repeat(500), subject: 'bigtitle' }));
  A.ok(big.finding.title.length <= 160, 'title length-capped');
}

// ---- G. corrupt io (throwing listFindings) -> empty ledger, add still works (fail-open) ----
{
  const bad = { listFindings() { throw new Error('disk gone'); }, writeFinding() {}, knownFingerprints() { return []; } };
  let L;
  A.notThrows(() => { L = makeLedger({ io: bad, clock }); }, 'construction tolerates a throwing listFindings');
  A.eq(L.count(), 0, 'corrupt store -> empty ledger');
  A.eq(L.add(base({ subject: 'after-corrupt' })).ok, true, 'add still works over a corrupt store');
}

// ---- H. a failing writeFinding is reported (ok:false) but does not throw into the caller ----
{
  const bad = { listFindings() { return []; }, writeFinding() { throw new Error('disk full'); }, knownFingerprints() { return []; } };
  const L = makeLedger({ io: bad, clock });
  let res;
  A.notThrows(() => { res = L.add(base({ subject: 'write-fails' })); }, 'a throwing writeFinding does not crash add');
  A.eq(res.ok, false, 'a write failure is surfaced as ok:false');
  A.eq(res.status, 'write-failed', 'write-failed status is explicit (so a CLI can exit nonzero)');
}

// ---- H2. aggregate authorities fail closed on unreadable or structurally malformed stores ----
{
  A.throws(() => makeLedger({ strictRead: true, clock, io: { listFindings() { throw new Error('EACCES'); } } }),
    'strict authority propagates a read failure');
  A.throws(() => makeLedger({ strictRead: true, clock, io: { listFindings() { return {}; } } }),
    'strict authority rejects a non-array store');
  A.throws(() => makeLedger({ strictRead: true, clock, io: { listFindings() { return [{ id: 'x' }]; } } }),
    'strict authority rejects a syntactically valid but malformed finding');
  const valid = { id: 'x', fingerprint: 'deadbeef', crew: 'Overseer', severity: 'P1', status: 'open', title: 'real', evidence: ['proof.log'] };
  A.eq(makeLedger({ strictRead: true, clock, io: { listFindings() { return [valid]; } } }).openBySeverity().P1, 1,
    'strict authority accepts a complete stored finding');
}

// ---- I. dedupCheck reports filed / known / new correctly ----
{
  const fpKnown = fingerprintOf({ crew: 'Visual Auditor', checkId: 'VA-6', subject: 'clip' });
  const io = memIo([], new Set([fpKnown]));
  const L = makeLedger({ io, clock });
  L.add(base({ crew: 'Truth Auditor', checkId: 'a', subject: 'filed-one', evidence: ['x'] }));
  const fpFiled = fingerprintOf({ crew: 'Truth Auditor', checkId: 'a', subject: 'filed-one' });
  A.eq(L.dedupCheck(fpFiled).filed, true, 'a filed fingerprint reports filed:true');
  A.eq(L.dedupCheck(fpFiled).status, 'open', 'filed-and-open reports its status');
  A.eq(L.dedupCheck(fpKnown).known, true, 'a known fingerprint reports known:true');
  A.eq(L.dedupCheck(fpKnown).status, 'known', 'known fingerprint status is known');
  A.eq(L.dedupCheck('deadbeef').status, 'new', 'an unseen fingerprint is new');
}

A.report('qa-ledger.test');
