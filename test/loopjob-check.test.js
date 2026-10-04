/* node test/loopcheck.test.js — the PURE host-check verdict core (standing objectives, S2).

   The reason this file exists: making "the tests pass" a loop's exit condition turns the tests into a TARGET.
   The cheapest way for an agent to satisfy that goal is to change the check — weaken an assertion, delete the
   failing case, or edit package.json's `scripts.test` to `exit 0`. This suite is a list of the specific ways
   that can be attempted, and proves each one produces an UNTRUSTED verdict that stops for a human.

   The law under test: a green check only counts as green if the loop can PROVE the check itself was not
   modified. Unprovable is treated exactly like unsafe. */
'use strict';
const A = require('./_assert.js');
const LC = require('../sidecar/loopjob-check.js');

const green = { exitCode: 0, out: '42 passing' };
const red = { exitCode: 1, out: '2 failing\n40 passing' };
const V = (o) => LC.verdict(Object.assign({ result: green, changed: [], gitProven: true }, o));

// ---- 1. the honest cases ----------------------------------------------------------------------------
{
  const ok = V({ changed: ['src/auth.js'] });
  A.eq(ok.passed, true, 'exit 0 is a pass');
  A.eq(ok.trusted, true, 'a pass with only source files touched is TRUSTED');
  A.eq(ok.mustReview, false, 'and needs no forced review');
  A.eq(ok.summary, '42 passing', 'the summary is the real count line from the output');

  const fail = V({ result: red, changed: ['src/auth.js'] });
  A.eq(fail.passed, false, 'exit 1 is a failure');
  A.eq(fail.trusted, false, 'a failing check is never trusted');
  A.eq(fail.mustReview, false, 'a plain red does not force review — it just feeds the next iteration');
  // KNOWN QUIRK of the shipped verify.interpret (sidecar/verify.js:27): it takes the LAST line matching a
  // pass/fail COUNT, so "2 failing\n40 passing" summarises as "40 passing" — which reads like success on a
  // RED run. Pinned here so nobody "tidies" the note below without understanding why it exists.
  A.eq(fail.summary, '40 passing', 'verify.interpret picks the last count line, even when it flatters a failure');
  A.ok(/^check failed/.test(fail.note), 'so the NOTE leads with the exit-code verdict, never the flattering summary');

  const none = LC.verdict({ result: null });
  A.eq(none.ran, false, 'a loop with no check configured reports it did not run one');
  A.eq(none.trusted, false, 'and can never be trusted-green');
}

// ---- 2. THE ATTACK LIST — every one of these must come back untrusted --------------------------------
{
  const attacks = [
    ['test/auth.test.js', 'edited the test file itself'],
    ['tests/test_auth.py', 'python test dir + test_ prefix'],
    ['src/__tests__/login.js', 'a __tests__ folder anywhere in the tree'],
    ['app/login.spec.ts', 'a .spec sibling of the source'],
    ['e2e/checkout.js', 'the e2e suite'],
    ['spec/models/user_spec.rb', 'rspec layout'],
    ['package.json', 'THE CLASSIC — rewrite scripts.test to exit 0, touching no "test"-named file'],
    ['pyproject.toml', 'same move in python'],
    ['Cargo.toml', 'same move in rust'],
    ['Makefile', 'same move behind `make test`'],
    ['jest.config.js', 'point the runner at an empty testMatch'],
    ['vitest.config.ts', 'same for vitest'],
    ['playwright.config.ts', 'same for playwright'],
    ['.mocharc.yml', 'a dotfile runner config'],
    ['conftest.py', 'pytest fixtures — can neuter an entire suite'],
    ['tox.ini', 'the tox test env definition']
  ];
  for (const [path, why] of attacks) {
    const v = V({ changed: ['src/thing.js', path] });
    A.eq(v.tampered, true, 'DETECTED: ' + why + ' (' + path + ')');
    A.eq(v.trusted, false, 'and the green is NOT trusted — ' + path);
    A.eq(v.mustReview, true, 'and it is forced in front of a human — ' + path);
    A.ok(v.tamperedPaths.indexOf(path) >= 0, 'the offending path is named — ' + path);
    A.ok(/changed the check itself/.test(v.note), 'and the note says plainly what happened — ' + path);
  }
}

// ---- 3. a rename counts — moving a failing test out of the way is tampering ---------------------------
{
  const moved = LC.parseChangedFiles('R  test/auth.test.js -> attic/auth.test.js.bak');
  A.eq(moved.length, 2, 'a rename yields BOTH sides');
  A.ok(moved.indexOf('test/auth.test.js') >= 0, 'the original path is captured');
  const v = V({ changed: moved });
  A.eq(v.tampered, true, 'so renaming a test away from the suite is caught');
}

// ---- 4. tampering is surfaced even when the check went RED --------------------------------------------
{
  const v = V({ result: red, changed: ['test/auth.test.js'] });
  A.eq(v.tampered, true, 'an edited test on a failing run is still flagged');
  A.eq(v.mustReview, true, 'and still forced in front of a human — an agent editing tests is signal either way');
}

// ---- 5. UNPROVABLE is treated as UNSAFE (the non-git project) -----------------------------------------
{
  const v = LC.verdict({ result: green, changed: null, gitProven: false });
  A.eq(v.passed, true, 'the check genuinely passed');
  A.eq(v.tampered, false, 'nothing is ACCUSED — we simply cannot enumerate what changed');
  A.eq(v.trusted, false, 'but an unprovable green is NOT trusted');
  A.eq(v.mustReview, true, 'so it stops for a human');
  A.ok(/not a git repo/.test(v.note), 'and says exactly why it cannot vouch for itself');
  A.eq(LC.satisfiesExit({ exitOn: 'check-green' }, v), false,
    'an unprovable green can never DECLARE THE OBJECTIVE COMPLETE — that is the lie the product forbids');
}

// ---- 6. the exit condition demands TRUSTED, not merely passed -----------------------------------------
{
  A.eq(LC.satisfiesExit({ exitOn: 'check-green' }, V({ changed: ['src/a.js'] })), true, 'a trusted green satisfies check-green');
  A.eq(LC.satisfiesExit({ exitOn: 'check-green' }, V({ changed: ['package.json'] })), false, 'a tampered green does NOT');
  A.eq(LC.satisfiesExit({ exitOn: 'check-green' }, V({ result: red })), false, 'a red does NOT');
  A.eq(LC.satisfiesExit({ exitOn: 'empty-digests' }, V({ changed: ['src/a.js'] })), false,
    'a check verdict never satisfies a LEDGER-based exit condition — that lives in loopjob.js');
  A.eq(LC.satisfiesExit(null, null), false, 'and it is null-safe');
}

// ---- 7. timeouts / aborts are failures, never passes ---------------------------------------------------
{
  const t = V({ result: { exitCode: 0, out: 'hanging', timedOut: true } });
  A.eq(t.passed, false, 'a timed-out check is NOT a pass even at exit 0');
  A.ok(/timed out/.test(t.summary), 'and says so');
  const ab = V({ result: { exitCode: 0, out: '', aborted: true } });
  A.eq(ab.passed, false, 'an aborted check is not a pass either');
}

// ---- 8. an explicit protected-path list covers layouts the heuristic would miss -------------------------
{
  const v = LC.verdict({ result: green, changed: ['qa/goldens/home.png'], gitProven: true, extraPaths: ['qa/goldens'] });
  A.eq(v.tampered, true, 'a loop may declare extra protected paths');
  A.eq(LC.isCheckFile('qa/goldens/home.png'), false, 'which the default heuristic would NOT have caught');
}

// ---- 9. ordinary source files are not false positives ---------------------------------------------------
{
  const innocent = ['src/index.js', 'lib/attest.js', 'README.md', 'src/protest/banner.tsx', 'docs/testimonials.md', 'src/latest.ts'];
  for (const p of innocent) A.eq(LC.isCheckFile(p), false, 'not a check file: ' + p);
  // …but the near-misses that ARE check files still register
  A.eq(LC.isCheckFile('src/auth.test.js'), true, 'auth.test.js is a check file');
  A.eq(LC.isCheckFile('test/helpers.js'), true, 'anything inside test/ is a check file');
}

// ---- 10. porcelain parsing handles what git actually emits ----------------------------------------------
{
  A.eq(LC.parseChangedFiles(' M src/a.js\n?? new.js\nA  test/b.test.js'), ['src/a.js', 'new.js', 'test/b.test.js'], 'status codes are stripped');
  A.eq(LC.parseChangedFiles(''), [], 'a clean tree yields no paths');
  A.eq(LC.parseChangedFiles(null), [], 'and null is safe');
  A.eq(LC.parseChangedFiles(' M "src/with space.js"'), ['src/with space.js'], 'git-quoted paths are unquoted');
  A.eq(LC.parseChangedFiles(' M src/a.js\r\n M src/b.js'), ['src/a.js', 'src/b.js'], 'CRLF is handled');
  A.eq(LC.parseChangedFiles(' M src\\win\\path.js'), ['src/win/path.js'], 'backslashes normalize to forward');
}

A.report('loopcheck (host-run check verdict + tamper guard)');
