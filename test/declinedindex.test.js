/* node test/declinedindex.test.js — the SHARED DECLINED INDEX (flagship cross-wire, NS-8 lite).

   Proves the pure read-side unifier that lets a decline in ONE engine suppress a re-propose in ANOTHER:
     · normalization is lowercase / punctuation-stripped / whitespace-collapsed / trimmed, and EXACT-match only
       (no fuzzy overlap — a near-miss must NOT suppress, false suppression being worse than a duplicate);
     · a candidate declined by ANY fed collection is a hit; a candidate no collection holds is not;
     · an empty / punctuation-only candidate is never a hit (never suppress on nothing);
     · TTL expiries are non-suppressing by construction — only the lists the host feeds are matched, and the host
       feeds explicit declines only (an expired-but-not-declined idea, never fed, is never suppressed). */
'use strict';
const A = require('./_assert.js');
const D = require('../sidecar/declinedindex.js');

// ---- normalization ----
A.eq(D.normKey('  Ship the CSV Export!!  '), 'ship the csv export', 'lowercase + punctuation-strip + collapse + trim');
A.eq(D.normKey('Ship   the\tCSV—export'), 'ship the csv export', 'unicode dash + tabs + runs collapse to single spaces');
A.eq(D.normKey('!!!'), '', 'a punctuation-only string normalizes to the empty key');
A.eq(D.normKey(null), '', 'null → empty key (never throws)');

// ---- exact match, no fuzz ----
const idx = D.build([
  ['Automate my weekly stock brief'],                 // e.g. a declined north star
  ['ship the earnings digest', 'call the vendor'],    // e.g. quest deniedTitles
  ['I prefer terse summaries']                         // e.g. a declined memory belief
]);
A.ok(idx.has('automate my weekly stock brief'), 'a declined north star is a hit (case-insensitive)');
A.ok(idx.has('  Ship the Earnings Digest.  '), 'punctuation/case/space variants of a declined title hit');
A.ok(idx.has('I PREFER TERSE SUMMARIES'), 'a declined belief hits regardless of case');
A.ok(!idx.has('ship the earnings report'), 'a DIFFERENT title (report vs digest) does NOT hit — no fuzzy match');
A.ok(!idx.has('weekly stock brief'), 'a substring is NOT a hit — exact normalized key only');
A.ok(!idx.has(''), 'an empty candidate is never a hit');
A.ok(!idx.has('!!!'), 'a punctuation-only candidate is never a hit');

// ---- cross-engine: a decline in ONE list suppresses a candidate proposed for ANOTHER ----
(function crossEngine() {
  const notebookDeclined = ['I want a daily standup digest'];   // declined as a memory belief
  const questTitles = ['launch the referral program'];         // an open quest title namespace
  const i = D.build([notebookDeclined, questTitles, []]);
  // a THREAD-mine / STUDY / SCOUT candidate with the same text is suppressed even though it came from a different engine.
  A.ok(i.has('I want a daily standup digest'), 'a belief declined in notebook suppresses the same idea proposed elsewhere');
  A.ok(!i.has('I want a weekly standup digest'), 'a genuinely different idea (weekly vs daily) is NOT suppressed');
})();

// ---- expiry non-suppression: only EXPLICIT declines are fed; an expired-only idea is absent → never suppressed ----
(function expiryNonSuppression() {
  const explicitDeclines = ['drop the newsletter recipe'];      // the ONLY thing the host feeds (a real decline)
  // 'the podcast recipe' was a scout draft that EXPIRED (TTL) — scout expiry deliberately does NOT denylist, so the
  // host never hands it here. The index must therefore NOT suppress it.
  const i = D.build([explicitDeclines]);
  A.ok(i.has('drop the newsletter recipe'), 'the explicitly-declined idea is suppressed');
  A.ok(!i.has('the podcast recipe'), 'an expired-but-not-declined idea is NOT suppressed (scout expiry preserved)');
})();

// ---- tolerant build: non-array collections / non-string entries are skipped, never a throw ----
(function tolerant() {
  A.notThrows(() => D.build(null), 'build(null) never throws');
  A.notThrows(() => D.build([null, 'not-an-array', [42, undefined, 'ok title']]), 'garbage collections never throw');
  const i = D.build([[42, undefined, 'ok title', {}]]);
  A.eq(i.size, 1, 'only the one real string entry becomes a key');
  A.ok(i.has('ok title'), 'the real entry is matchable');
})();

A.report();
