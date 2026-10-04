/* node test/verify.test.js — the PURE verification core (execution-spine Commit 4): interpret() turns a check
   run into a pass/fail verdict + summary; diagnosticDelta() is the lint noise filter (only NEW diagnostics).
   No clock/fs/rng — headless + deterministic, in the fast gate. */
'use strict';
const A = require('./_assert.js');
const { interpret, diagnosticDelta } = require('../sidecar/verify.js');

// ---- interpret: pass/fail from the exit code (+ timeout/abort), with a meaningful summary ----
{
  A.eq(interpret({ exitCode: 0, out: 'all good\n' }).passed, true, 'exit 0 -> passed');
  A.eq(interpret({ exitCode: 1, out: 'boom\n' }).passed, false, 'non-zero -> failed');
  A.eq(interpret({ exitCode: 0, timedOut: true, out: '' }).passed, false, 'a timed-out run never passes');
  A.eq(interpret({ exitCode: 0, aborted: true, out: '' }).passed, false, 'an aborted run never passes');

  // a count line is preferred for the summary over a trailing noise line
  A.eq(interpret({ exitCode: 1, out: 'running…\n3 passed, 1 failed\nDone.\n' }).summary, '3 passed, 1 failed', 'summary prefers the pass/fail count line');
  // no count -> the last non-empty line
  A.eq(interpret({ exitCode: 0, out: 'step one\nfinished cleanly\n\n' }).summary, 'finished cleanly', 'no count -> last non-empty line');
  // empty output -> a sensible default verdict
  A.eq(interpret({ exitCode: 0, out: '' }).summary, 'check passed', 'empty+pass -> default passed summary');
  A.eq(interpret({ exitCode: 2, out: '' }).summary, 'check failed (exit 2)', 'empty+fail -> default failed summary names the exit');
  A.ok(/^timed out — /.test(interpret({ exitCode: -1, timedOut: true, out: 'partial\n' }).summary), 'timed-out summary is prefixed');
}

// ---- diagnosticDelta: only NEWLY-introduced diagnostics surface (and the ones an edit fixed) ----
{
  const d = (file, line, message) => ({ file, line, message });
  const before = [d('a.ts', 1, 'X'), d('a.ts', 2, 'Y')];
  const after = [d('a.ts', 2, 'Y'), d('b.ts', 9, 'Z')];   // X fixed, Z introduced, Y pre-existing
  const delta = diagnosticDelta(before, after);
  A.eq(delta.addedCount, 1, 'one newly-introduced diagnostic');
  A.eq(delta.added[0].message, 'Z', 'the added one is Z (the edit introduced it)');
  A.eq(delta.removedCount, 1, 'one diagnostic was fixed');
  A.eq(delta.removed[0].message, 'X', 'the removed one is X');

  // identical sets -> no noise
  const same = diagnosticDelta(before, before);
  A.eq(same.addedCount, 0, 'identical before/after -> nothing added');
  A.eq(same.removedCount, 0, 'identical before/after -> nothing removed');

  // empties + a custom key
  A.eq(diagnosticDelta(null, null).addedCount, 0, 'null inputs are safe');
  const byCode = diagnosticDelta([{ code: 'A' }], [{ code: 'A' }, { code: 'B' }], (x) => x.code);
  A.eq(byCode.addedCount, 1, 'custom keyOf compares by identity');
}

A.report('verify.test');
