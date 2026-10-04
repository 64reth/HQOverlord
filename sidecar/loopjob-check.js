/* sidecar/loopjob-check.js — the PURE verdict core for a LOOP's host-run check (standing objectives, S2).

   THE POINT. An open-ended loop ends when the model says it is done — which is the single thing models are
   worst at, because they are trained to be helpful and will invent work rather than concede. A BUILD·TEST·VERIFY
   loop ends on a real process exit code instead. `git exit 0` is not an opinion, so the loop's stopping
   condition stops depending on the model's self-assessment.

   THE OBVIOUS COUNTER-ATTACK, HANDLED HERE. The moment "the check passes" becomes the goal, the cheapest way
   to reach it is to change the check: weaken an assertion, delete the failing case, add a skip, or edit
   `package.json`'s `scripts.test` to `exit 0`. This is a well-documented reward-hacking failure mode, not a
   hypothetical, and a loop that grinds unattended overnight is the ideal environment for it. So:

     A GREEN CHECK ONLY COUNTS AS GREEN IF THE LOOP CAN PROVE THE CHECK ITSELF WAS NOT MODIFIED.

   `verdict()` therefore returns `trusted` separately from `passed`. An untrusted green NEVER auto-approves and
   never satisfies an exit condition — it stops for human review carrying the reason. This holds in both
   directions that matter: the agent edited a test file, OR the loop simply cannot prove either way (a non-git
   project, where there is no changed-file list to inspect). Unprovable is treated exactly like unsafe, because
   asserting a green we cannot substantiate is the lie this product forbids.

   PURE: every function is a transform over (result, changed, config) — no clock, no fs, no rng, no spawn — so
   it passes test/lint-determinism.js and is headless-testable like verify.js / loopjob.js. The ambient half
   (running the command at the blessed root, asking git what changed) lives ONLY in sidecar/index.js.

   Surface:
     parseChangedFiles(porcelain)             -> string[]        // `git status --porcelain` -> repo-relative paths
     isCheckFile(relPath, extraPatterns)      -> boolean         // is this file PART OF the check?
     verdict({ result, changed, gitProven, extraPaths }) -> Verdict
     satisfiesExit(loop, verdict)             -> boolean         // did this iteration meet the loop's exit condition?

   A Verdict:
     { ran, passed, summary,            // passed/summary come straight from verify.interpret
       tampered, tamperedPaths,         // the check's OWN files that this iteration changed
       gitProven,                       // could we enumerate what changed at all?
       trusted,                         // passed AND !tampered AND gitProven — the only green that counts
       mustReview,                      // a result a human has to look at regardless of the exit condition
       note }                           // one honest human-facing line
*/
'use strict';
(function (root, factory) {
  const api = factory(typeof require === 'function' ? require('./verify.js') : (root.SK && root.SK.verify));
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).loopcheck = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (verify) {
  'use strict';

  /* THE CHECK-SURFACE PATTERNS — files that define WHAT the check does, so changing them changes the meaning of
     a pass. Two families, and the second is the one people forget:

       (a) the tests themselves — test/ tests/ spec/ __tests__/, *.test.*, *.spec.*
       (b) the files that DEFINE the check — package.json (scripts.test!), pyproject.toml, Cargo.toml, Makefile,
           and the runner configs. Editing `"test": "exit 0"` is the purest possible form of this hack and it
           touches no file with "test" in its name.

     Deliberately broad. A false positive costs one human glance at a green run; a false negative costs a loop
     that spent all night making its own scoreboard easier. */
  const DIR_RE = /(^|\/)(tests?|spec|specs|__tests__|__specs__|e2e|testing)(\/|$)/i;
  const NAME_RE = /(^|[./_-])(test|tests|spec|specs)([./_-]|$)/i;
  const DEFINES_CHECK = [
    'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
    'pyproject.toml', 'setup.cfg', 'setup.py', 'tox.ini', 'pytest.ini', 'conftest.py',
    'cargo.toml', 'go.mod', 'makefile', 'justfile', 'gemfile', 'composer.json', 'build.gradle', 'pom.xml'
  ];
  const CONFIG_RE = /(^|\/)(jest|vitest|karma|mocha|ava|cypress|playwright|nyc|jasmine|phpunit|tsconfig)[.\w-]*\.(js|cjs|mjs|ts|json|ya?ml|xml|config\.[jt]s)$/i;
  const DOTCONFIG_RE = /(^|\/)\.(mocharc|nycrc|babelrc|swcrc)[.\w-]*$/i;

  function norm(p) { return String(p == null ? '' : p).replace(/\\/g, '/').replace(/^\.\//, '').trim(); }
  function base(p) { const s = norm(p); const i = s.lastIndexOf('/'); return (i < 0 ? s : s.slice(i + 1)).toLowerCase(); }

  /* isCheckFile — does this repo-relative path form part of the check surface? `extraPatterns` lets a loop
     declare additional protected paths (plain substrings, matched case-insensitively) for projects whose test
     layout this heuristic would miss. */
  function isCheckFile(relPath, extraPatterns) {
    const p = norm(relPath);
    if (!p) return false;
    const lower = p.toLowerCase();
    if (Array.isArray(extraPatterns)) {
      for (const pat of extraPatterns) {
        const s = norm(pat).toLowerCase();
        if (s && lower.indexOf(s) >= 0) return true;
      }
    }
    if (DEFINES_CHECK.indexOf(base(p)) >= 0) return true;
    if (CONFIG_RE.test(lower) || DOTCONFIG_RE.test(lower)) return true;
    if (DIR_RE.test(lower)) return true;
    return NAME_RE.test(base(p));
  }

  /* parseChangedFiles — turn `git status --porcelain` into repo-relative paths.
     Lines are `XY <path>`, or `XY <orig> -> <new>` for a rename (BOTH sides count: moving a test out of the
     way is a modification of the check surface), and a path containing spaces/specials arrives git-quoted. */
  function parseChangedFiles(porcelain) {
    const out = [];
    const lines = String(porcelain == null ? '' : porcelain).split('\n');
    for (const raw of lines) {
      const line = raw.replace(/\r$/, '');
      if (!line.trim()) continue;
      let rest = line.length > 3 ? line.slice(3) : line.trim();     // strip the 2-char status + separator
      const arrow = rest.indexOf(' -> ');
      const parts = arrow >= 0 ? [rest.slice(0, arrow), rest.slice(arrow + 4)] : [rest];
      for (const part of parts) {
        let p = part.trim();
        if (p.length > 1 && p.charAt(0) === '"' && p.charAt(p.length - 1) === '"') {
          p = p.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        }
        p = norm(p);
        if (p && out.indexOf(p) < 0) out.push(p);
      }
    }
    return out;
  }

  /* verdict — judge one iteration's check.

     inputs:
       result    { exitCode, out, timedOut?, aborted? } | null   // null = no check configured / not run
       changed   string[] | null                                 // repo-relative paths this iteration touched;
                                                                 //   null = could not be determined
       gitProven bool                                            // was `changed` actually established from git?
       extraPaths string[]                                       // the loop's declared extra protected paths

     The trust rule is the whole file: `trusted` requires a real pass AND an untampered check surface AND the
     ability to have proven it. `mustReview` is deliberately wider than `!trusted` is narrow — a tampered run
     is the single most important thing to put in front of a human, so it is flagged even when the check failed
     (an agent that edited the tests and STILL went red is telling you something too). */
  function verdict(input) {
    input = input || {};
    const result = input.result;
    if (!result) {
      return {
        ran: false, passed: false, summary: '', tampered: false, tamperedPaths: [],
        gitProven: !!input.gitProven, trusted: false, mustReview: false, note: 'no check configured'
      };
    }
    const v = verify.interpret(result);
    const changed = Array.isArray(input.changed) ? input.changed : [];
    const gitProven = !!input.gitProven;
    const tamperedPaths = changed.filter(p => isCheckFile(p, input.extraPaths));
    const tampered = tamperedPaths.length > 0;
    const trusted = v.passed && !tampered && gitProven;

    let note;
    if (tampered) {
      note = 'this iteration changed the check itself (' + tamperedPaths.slice(0, 3).join(', ') +
        (tamperedPaths.length > 3 ? ' +' + (tamperedPaths.length - 3) + ' more' : '') + ') — a pass here proves nothing until you look';
    } else if (v.passed && !gitProven) {
      note = 'check passed, but this project is not a git repo so the loop cannot prove the tests were left alone — read it before approving';
    } else if (!v.passed) {
      // NEVER surface a bare summary on a failure. verify.interpret picks the LAST count line in the output,
      // so a run printing "2 failing" then "40 passing" summarises as "40 passing" — which reads like success
      // on a red run. The verdict word comes from the exit code (fact), the summary is context after it.
      note = 'check failed — ' + v.summary;
    } else {
      note = v.summary;
    }

    return {
      ran: true, passed: v.passed, summary: v.summary,
      tampered: tampered, tamperedPaths: tamperedPaths,
      gitProven: gitProven, trusted: trusted,
      // ALWAYS stop for a human on tampering, and never let an unprovable green satisfy an exit condition.
      mustReview: tampered || (v.passed && !trusted),
      note: note
    };
  }

  /* satisfiesExit — did this iteration meet the loop's exit condition? Only `check-green` is decided here; the
     digest-count conditions live in loopjob.js because they are a property of the LEDGER, not of one check.
     Note it requires `trusted`, not merely `passed`: an untrusted green stops the loop for review but must
     never be allowed to declare the objective COMPLETE. */
  function satisfiesExit(loop, v) {
    if (!loop || !v) return false;
    if (loop.exitOn !== 'check-green') return false;
    return !!v.trusted;
  }

  return {
    parseChangedFiles: parseChangedFiles,
    isCheckFile: isCheckFile,
    verdict: verdict,
    satisfiesExit: satisfiesExit,
    _internals: { DIR_RE: DIR_RE, NAME_RE: NAME_RE, DEFINES_CHECK: DEFINES_CHECK, CONFIG_RE: CONFIG_RE, norm: norm, base: base }
  };
});
