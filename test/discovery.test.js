/* node test/discovery.test.js — THE ENVIRONMENT DISCOVERY ENGINE (sidecar/discovery.js, pure half).

   The product gap this lane closes: every proactive surface studied only what the Commander TYPED; the station
   never looked at the projects it was blessed into. This suite locks the engine's laws:
     - evidence or silence BY CONSTRUCTION: a finding exists only where the scan produced a real line, and that
       line is carried verbatim as the citation; an empty/failed scan yields nothing
     - discovery is not authority: the module holds no IO at all (the host owns isBlessedRoot + projectscan)
     - dismiss is a verdict (permanent denylist); accept resolves (no re-nag); EXPIRY IS NEVER A VERDICT — the
       fingerprint is released so a chore the repo still carries may honestly return
     - decide() names its bindings (no-roots / cooldown / all-fresh) and scans stalest-first, bounded
     - normalize drops any row that cannot cite (no citation, no row) */
'use strict';
const A = require('./_assert.js');
const D = require('../sidecar/discovery.js');

const T = 1780000000000;
const ROOT = 'C:\\Users\\x\\proj\\alpha';

function fakeScan() {
  return {
    ok: true, isGit: true, text: '',
    sections: [
      { label: 'Uncommitted changes (working tree)', lines: [' M sidecar/index.js', '?? notes.md'] },
      { label: 'Recent commits', lines: ['abc1234 fix the belt'] },
      { label: 'TODO / FIXME markers', lines: [
        'sidecar/loop.js:42: // TODO: retry on 429',
        'frontend/app.js:7: // FIXME wire the dial',
        'a.js:1: // TODO one', 'b.js:2: // TODO two', 'c.js:3: // TODO three'
      ] }
    ]
  };
}

/* ── 1. extraction: evidence or silence, by construction ── */
{
  const f = D.extractFindings(fakeScan(), { root: ROOT, displayPath: ROOT, now: T });
  const wip = f.filter(x => x.kind === 'wip');
  const todos = f.filter(x => x.kind === 'todo');
  A.eq(wip.length, 1, 'uncommitted changes fold into ONE wip finding per root');
  A.ok(wip[0].title.indexOf('2 files') >= 0, 'the wip title carries the honest count');
  A.ok(wip[0].quote.indexOf('M sidecar/index.js') >= 0, 'the wip quote cites the porcelain rows verbatim');
  A.eq(todos.length, D.TODO_PER_ROOT, 'TODO findings are capped per root (' + D.TODO_PER_ROOT + ' of 5 markers)');
  A.eq(todos[0].quote, 'sidecar/loop.js:42: // TODO: retry on 429', 'the marker line IS the citation, verbatim');
  A.ok(todos[0].title.indexOf('retry on 429') >= 0, 'the title speaks the marker text, not a paraphrase');
  for (const x of f) { A.ok(x.fingerprint && x.id && x.root === ROOT, 'every finding carries id + root + fingerprint'); }
}
A.eq(D.extractFindings({ ok: false, reason: 'not-blessed', sections: [] }, { root: ROOT, now: T }).length, 0,
  'a refused scan yields NOTHING (the trust boundary already spoke)');
A.eq(D.extractFindings({ ok: true, isGit: true, sections: [] }, { root: ROOT, now: T }).length, 0,
  'a clean repo yields nothing — no invented chores');
A.eq(D.extractFindings(null, { root: ROOT, now: T }).length, 0, 'a null scan yields nothing');
A.eq(D.extractFindings(fakeScan(), { root: '', now: T }).length, 0, 'no root, no findings');

/* ── 2. fingerprints: exact-normalized, root-scoped ── */
A.eq(D.fingerprint(ROOT, 'a.js:1: // TODO one'), D.fingerprint(ROOT, ' A.JS:1:  //  TODO — one!! '),
  'case/punctuation/whitespace collapse to one key (the declinedindex bar)');
A.ok(D.fingerprint(ROOT, 'todo one') !== D.fingerprint('D:\\other', 'todo one'),
  'the same marker in two roots is two findings');

/* ── 3. stage / eligible / caps ── */
{
  let s = D.normalize(null);
  const f = D.extractFindings(fakeScan(), { root: ROOT, displayPath: ROOT, now: T });
  for (const x of f) s = D.stage(s, x, { now: T });
  A.eq(s.staged.length, f.length, 'all fresh findings stage');
  A.eq(D.eligible(s, f[0]), false, 'an already-staged fingerprint is not eligible again');
  s = D.stage(s, f[0], { now: T + 1 });
  A.eq(s.staged.length, f.length, '…and re-staging it is a no-op');
  A.eq(s.ledger.filter(e => e.outcome === 'staged').length, f.length, 'every stage wrote a ledger note (anti-silent-no-mint)');

  // the cap holds
  let full = s;
  for (let i = 0; i < D.STAGED_CAP + 4; i++) {
    full = D.stage(full, { id: 'todo:x' + i, root: ROOT, displayPath: ROOT, kind: 'todo', title: 't' + i, quote: 'q' + i, fingerprint: 'fp' + i, at: T }, { now: T });
  }
  A.ok(full.staged.length <= D.STAGED_CAP, 'the staged shelf is capped at ' + D.STAGED_CAP);
}

/* ── 4. dismiss = verdict, accept = resolved, expiry = neither ── */
{
  let s = D.normalize(null);
  const f = D.extractFindings(fakeScan(), { root: ROOT, displayPath: ROOT, now: T });
  for (const x of f) s = D.stage(s, x, { now: T });
  const victim = s.staged[0];

  const dismissed = D.dismiss(s, victim.id, { now: T + 5 });
  A.eq(dismissed.staged.some(x => x.id === victim.id), false, 'dismiss removes the finding');
  A.ok(dismissed.denylist.indexOf(victim.fingerprint) >= 0, '…and denylists its fingerprint for good');
  A.eq(D.eligible(dismissed, victim), false, '…so it can never be re-staged');
  A.eq(dismissed.ledger.slice(-1)[0].outcome, 'dismissed', '…and the verdict is on the ledger');

  const kept = s.staged[1];
  const accepted = D.accept(s, kept.id, { now: T + 5 });
  A.eq(accepted.staged.some(x => x.id === kept.id), false, 'accept removes the finding');
  A.ok(accepted.resolved.indexOf(kept.fingerprint) >= 0, '…into the resolved memory (picked up — never re-nag)');
  A.eq(D.eligible(accepted, kept), false, '…so it does not return while resolved');

  const later = T + D.FINDING_TTL_MS + 1000;
  const swept = D.sweep(s, later);
  A.eq(swept.staged.length, 0, 'undecided findings age out at the TTL');
  A.eq(swept.denylist.length, 0, 'an EXPIRY IS NEVER A VERDICT — nothing was denylisted');
  A.eq(D.eligible(swept, victim), true, '…and the fingerprint is released: a chore the repo still carries may return');
  A.ok(swept.ledger.some(e => e.outcome === 'expired'), 'the expiries are on the ledger too');
  A.eq(D.accept(s, 'no-such-id', { now: T }).staged.length, s.staged.length, 'an unknown id changes nothing');
}

/* ── 5. decide: named bindings, stalest-first, bounded ── */
{
  let s = D.normalize(null);
  A.eq(D.decide(s, { now: T, roots: [] }).binding, 'no-roots', 'no blessed roots → no-roots (honest cold copy)');
  const roots = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'];
  const d1 = D.decide(s, { now: T, roots });
  A.eq(d1.fire, true, 'a cold engine with roots fires');
  A.eq(d1.roots.length, D.ROOTS_PER_CYCLE, '…over at most ' + D.ROOTS_PER_CYCLE + ' roots per cycle');
  for (const r of d1.roots) s = D.markScanned(s, r, { now: T });
  A.eq(D.decide(s, { now: T + 1000, roots }).binding, 'cooldown', 'a second cycle inside the gap names cooldown');
  const d2 = D.decide(s, { now: T + D.CYCLE_MIN_GAP_MS + 1, roots });
  A.eq(d2.fire, true, 'past the gap it fires again');
  A.eq(d2.roots.indexOf('r5') >= 0 && d2.roots.indexOf('r6') >= 0, true, '…and the never-scanned roots go first (stalest-first)');
  let all = s;
  for (const r of roots) all = D.markScanned(all, r, { now: T + D.CYCLE_MIN_GAP_MS + 2 });
  A.eq(D.decide(all, { now: T + 2 * D.CYCLE_MIN_GAP_MS + 10, roots }).binding, 'all-fresh',
    'every root freshly scanned → all-fresh, and the engine stays quiet');
  const forced = D.decide(all, { now: T + 2 * D.CYCLE_MIN_GAP_MS + 10, roots, force: true });
  A.eq(forced.fire, true, 'force (the Commander\'s own SCAN NOW) overrides cooldown + freshness');
}

/* ── 6. the night-focus join is bounded citations, never bare vibes ── */
{
  let s = D.normalize(null);
  const f = D.extractFindings(fakeScan(), { root: ROOT, displayPath: ROOT, now: T });
  for (const x of f) s = D.stage(s, x, { now: T });
  const lines = D.findingsForRoot(s, ROOT);
  A.eq(lines.length, 2, 'at most 2 citation lines per root (normFocus keeps 6 total)');
  for (const l of lines) A.ok(l.quote && l.quote.length > 0, 'every line carries a real quote');
  A.eq(D.findingsForRoot(s, 'D:\\other').length, 0, 'a root with no findings contributes nothing');
}

/* ── 7. normalize hardening: no citation, no row ── */
{
  const s = D.normalize({ staged: [
    { id: 'x', root: ROOT, kind: 'todo', title: 't', quote: '', fingerprint: 'f', at: T },   // no quote
    { id: 'x2', root: ROOT, kind: 'nope', title: 't', quote: 'q', fingerprint: 'f2', at: T }, // unknown kind
    { id: '', root: ROOT, kind: 'todo', title: 't', quote: 'q', fingerprint: 'f3', at: T },   // no id
    { id: 'ok', root: ROOT, kind: 'todo', title: 't', quote: 'q', fingerprint: 'f4', at: T }
  ], ledger: 'garbage', denylist: [null, 'a'], perRoot: { r: { lastScanAt: 'NaN' } } });
  A.eq(s.staged.length, 1, 'rows that cannot cite (or cannot be named) are DROPPED, never guessed');
  A.eq(s.staged[0].id, 'ok', '…and the citing row survives');
  A.eq(s.denylist.length, 1, 'corrupt denylist entries drop');
  A.eq(s.perRoot.r.lastScanAt, 0, 'an unreadable clock is zero, not NaN');
}

A.report('discovery engine');
