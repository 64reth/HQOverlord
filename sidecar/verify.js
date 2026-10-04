/* sidecar/verify.js — the PURE verification core of the execution spine (Commit 4): turn a check-command run
   into a pass/fail verdict, and compute the lint-DELTA (only NEWLY-introduced diagnostics) after an edit.

   "Reliability" means did it actually work. Two pure transforms, no clock / fs / rng (lint-determinism-clean,
   headless-testable like cron.js / checkpoint.js). The ambient half (running the check, running a linter) lives
   in sidecar/tools/builtin/verify.js + index.js; this file only judges the results.

     interpret({ exitCode, out, timedOut?, aborted? }) -> { passed:bool, summary:string }
       passed = exit 0 AND not timed-out/aborted; summary = a meaningful one-liner (a test/error count line if the
       output has one, else the last non-empty line), clamped — the human/HUD-facing verdict.

     diagnosticDelta(before, after, keyOf?) -> { added[], removed[], addedCount, removedCount }
       the NOISE FILTER: surface only diagnostics an edit INTRODUCED (in `after`, not in `before`) — and the ones
       it fixed (removed) — so pre-existing problems never drown the signal. keyOf maps a diagnostic to its
       identity (default: file+line+message), so two runs are compared by stable identity, not object reference. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).verify = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // a count line tools commonly print: "5 passing", "2 failed", "3 errors", "Tests: 1 failed, 4 passed".
  const COUNT_RE = /(\d+)\s+(pass(?:ed|ing)?|fail(?:ed|ing|ures?)?|errors?)/i;

  function interpret(r) {
    r = r || {};
    const passed = r.exitCode === 0 && !r.timedOut && !r.aborted;
    const out = String(r.out == null ? '' : r.out);
    let summary = '';
    const lines = out.split('\n').map(s => s.trim()).filter(Boolean);
    // prefer a line carrying a pass/fail/error COUNT; else the last non-empty line.
    for (let i = lines.length - 1; i >= 0; i--) { if (COUNT_RE.test(lines[i])) { summary = lines[i]; break; } }
    if (!summary && lines.length) summary = lines[lines.length - 1];
    summary = summary.slice(0, 200);
    if (r.timedOut) summary = ('timed out — ' + summary).trim();
    else if (r.aborted) summary = ('aborted — ' + summary).trim();
    if (!summary) summary = passed ? 'check passed' : 'check failed (exit ' + (r.exitCode == null ? '?' : r.exitCode) + ')';
    return { passed: passed, summary: summary };
  }

  function defaultKey(d) {
    if (d == null) return 'null';
    if (typeof d !== 'object') return String(d);
    return [d.file || '', d.line == null ? '' : d.line, d.col == null ? '' : d.col, d.code || '', d.message || ''].join('|');
  }

  function diagnosticDelta(before, after, keyOf) {
    keyOf = typeof keyOf === 'function' ? keyOf : defaultKey;
    const b = before || [], a = after || [];
    const bKeys = new Set(b.map(keyOf));
    const aKeys = new Set(a.map(keyOf));
    const added = a.filter(d => !bKeys.has(keyOf(d)));
    const removed = b.filter(d => !aKeys.has(keyOf(d)));
    return { added: added, removed: removed, addedCount: added.length, removedCount: removed.length };
  }

  return { interpret: interpret, diagnosticDelta: diagnosticDelta, _internals: { defaultKey: defaultKey, COUNT_RE: COUNT_RE } };
});
