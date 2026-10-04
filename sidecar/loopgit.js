/* sidecar/loopgit.js — the PURE git DECISION half of the LOOP harvest (S3).

   WHAT THIS CLOSES. Until now the review gate was bookkeeping only: loopjob-driver's `defaultHarvest`
   returned `commit: null`, no `harvest` dep was ever injected in index.js, and POST /api/loops/verdict ran
   no git at all. So an iteration's edits piled up UNCOMMITTED in the Commander's project; APPROVE promoted
   nothing, and REJECT undid nothing — the row said 'rejected' while the work sat in the tree exactly where
   the agent left it. loopjob-store's own header already named the contract this module completes: "the HOST
   performs the actual git merge / file promotion BEFORE calling this — the store records what happened, it
   never claims an apply it did not witness."

   This module owns the SAFETY DECISION (which branch, which paths, which commits to undo, and when to
   refuse). The git exec — branch create / add / commit / revert — is ambient in sidecar/index.js, exactly
   the split nightpatch.js uses for the night shift's patch apply.

   THE LAWS (nightpatch.js's, restated for a loop that commits REPEATEDLY rather than once):

     · NEVER commit onto a protected ref. The loop gets its OWN branch, created off whatever HEAD it found.
       main/master/trunk/HEAD are never written beyond that branch creation, and nothing is ever pushed.

     · NEVER `git add -A`. A loop starts in a tree that may already hold the Commander's own uncommitted
       work. An iteration commits ONLY the paths that appeared during THAT pass — the same after-minus-before
       attribution runLoopCheck already computes for the review card. Sweeping the whole tree would fold
       their work into a commit that a later rejection reverts, which is how you lose somebody's afternoon.

     · UNDO IS A REVERT, NEVER A RESET. Rejecting #3 must also undo the #4 and #5 that THE STACKING LAW
       discards. A reset would destroy them; a revert leaves every commit recoverable after a mis-click.
       "Never destroy the last copy" applies to the Commander's repo too.

     · REVERT NEWEST FIRST. #5, then #4, then #3. Reverting the oldest first conflicts on any file a later
       iteration touched again, and a half-applied undo is worse than none.

     · A SHA OFF DISK IS UNTRUSTED INPUT. Iterations are persisted JSON and can be hand-edited, so every sha
       is shape-checked before it can reach an argv. Same class as the model-supplied-key guards.

   DETERMINISM SPLIT: pure — transforms over (loop, inputs). No fs, no clock (the host passes the date
   string), no spawn. Passes test/lint-determinism.js and is node-testable headless like loopjob.js. */
'use strict';
(function (root, factory) {
  const api = factory(typeof require === 'function' ? require('./loopjob.js') : (root.SK && root.SK.loopjob));
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).loopgit = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (LJ) {
  'use strict';

  const SUBJECT_CAP = 72;          // git subject-line convention; the body carries the rest
  const PATHS_CAP = 200;           // one iteration touching more than this is not a reviewable candidate
  const SHA_RE = /^[0-9a-fA-F]{7,40}$/;
  // Sets, not object literals: `({main:1})['constructor']` is truthy, so an object-literal allowlist admits
  // every Object.prototype key — and branch names come off persisted records.
  const PROTECTED = new Set(['main', 'master', 'head', 'trunk', 'develop', 'development']);

  const str = (v) => (v == null ? '' : String(v));

  /* isProtectedRef — never commit onto one of these. Case-insensitive, and it also catches the fully
     qualified forms git hands back (refs/heads/main), because `rev-parse --abbrev-ref` is not the only way
     a branch name reaches us. */
  function isProtectedRef(name) {
    const s = str(name).trim().toLowerCase().replace(/^refs\/heads\//, '');
    return PROTECTED.has(s);
  }

  // slugify a loop name into a branch-safe segment. Same shape as nightpatch.slugify on purpose.
  function slugify(title) {
    return str(title).toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/g, '');
  }

  /* branchName — the loop's own branch: loop/<date>-<slug>-<id>. The loop id is appended because two loops
     can legitimately run against the SAME repo with the same name on the same day, and silently sharing one
     branch would make each one's rejection revert the other's commits. */
  function branchName(dateStr, name, loopId) {
    const d = str(dateStr).replace(/[^0-9A-Za-z]/g, '') || 'x';
    const slug = slugify(name) || 'objective';
    const id = str(loopId).replace(/[^0-9A-Za-z_-]/g, '').slice(0, 12) || 'loop';
    return 'loop/' + d + '-' + slug + '-' + id;
  }

  /* commitSubject — "loop(<name>) #<n>: <title>". The title is the model's own first line; a pass that
     produced no title still gets a subject that says which iteration it was, because a ledger of commits
     reading "loop #4:" with nothing after it is still better than a blank subject. */
  function commitSubject(loop, iterN, title) {
    const name = slugify((loop && loop.name) || '') || 'loop';
    const head = 'loop(' + name + ') #' + (parseInt(iterN, 10) || 0) + ': ';
    const t = str(title).replace(/\s+/g, ' ').trim();
    return (head + (t || 'no title reported')).slice(0, SUBJECT_CAP);
  }

  /* isSafeRel — a repo-relative path we are willing to hand git. Rejects absolute/drive/UNC paths, any '..'
     segment, NUL, and the empty string. Paths reach us from `git status --porcelain` (so they are already
     repo-relative), but they ride through a persisted record on the way, and defense in depth here is free. */
  function isSafeRel(p) {
    const s = str(p);
    if (!s || s.indexOf('\0') >= 0) return false;
    if (/^[\\/]/.test(s) || /^[A-Za-z]:[\\/]/.test(s) || /^[\\/]{2}/.test(s)) return false;
    for (const seg of s.split(/[\\/]+/)) if (seg === '..') return false;
    return true;
  }

  /* commitPaths — the exact pathspec an iteration may stage. Accepts the shapes the pipeline actually
     produces: plain strings from loopcheck.parseChangedFiles, or {path} records from an iteration's files[].
     Deduped, order preserved (the review card lists them in the same order), unsafe entries dropped. */
  function commitPaths(files) {
    const out = [];
    const seen = new Set();
    for (const f of (Array.isArray(files) ? files : [])) {
      const p = str(f && typeof f === 'object' ? f.path : f).trim();
      if (!p || !isSafeRel(p) || seen.has(p)) continue;
      seen.add(p);
      out.push(p);
      if (out.length >= PATHS_CAP) break;
    }
    return out;
  }

  /* harvestDelta — ownership must be proven at BOTH ends of an iteration. A missing pre-run snapshot is not
     equivalent to a clean tree: treating it that way lets every pre-existing untracked file appear "new" and
     sweeps the Commander's work into the loop commit. Fail closed and leave the tree untouched instead. */
  function harvestDelta(before, after) {
    if (!before || before.gitProven !== true || !Array.isArray(before.files)) {
      return { ok: false, paths: [], reason: 'git could not prove the pre-iteration file state' };
    }
    if (!after || after.gitProven !== true || !Array.isArray(after.files)) {
      return { ok: false, paths: [], reason: 'git could not prove the post-iteration file state' };
    }
    const beforeSet = new Set(before.files.map(f => str(f && typeof f === 'object' ? f.path : f)));
    return {
      ok: true,
      paths: commitPaths(after.files.filter(f => !beforeSet.has(str(f && typeof f === 'object' ? f.path : f))))
    };
  }

  function isSha(v) { return SHA_RE.test(str(v).trim()); }

  /* undoPlan(loop, n) — what REJECT must undo, before the verdict is recorded.

     Mirrors recordVerdict exactly: the rejected iteration plus every un-approved candidate stacked above it
     (loopjob.stackedAbove), because those were built on a tree containing it. Returns them NEWEST FIRST,
     which is the only order a stack of reverts applies cleanly in.

     The return is four-valued rather than ok/not-ok, because "nothing to undo", "cannot undo safely" and
     "there is no undo for this shape of loop" are three different facts and the route says a different
     sentence for each:
       mode 'revert'       — commits[] to revert, newest first.
       mode 'none'         — genuinely nothing to undo. A loop with no project folder worked only inside the
                             agent's own jail, so a rejection costs the tree nothing.
       mode 'unrevertable' — the loop edited a REAL folder that git cannot undo (not a repo). The rejection
                             still proceeds, because refusing would strand the Commander with a candidate
                             they can never rule on — but `reason` must be surfaced, because a rejection that
                             silently leaves the files in place is the lie this product forbids. Saying it out
                             loud is what makes it honest.
       mode 'blocked'      — we could undo it but not SAFELY (an unreadable commit id, and at the host layer a
                             dirty file in the blast radius). The verdict is refused outright. */
  function undoPlan(loop, n) {
    const num = parseInt(n, 10);
    const empty = { mode: 'none', commits: [], commitless: [], reason: null };
    if (!loop || !isFinite(num)) return Object.assign({}, empty, { mode: 'blocked', reason: 'no such iteration' });

    const target = (loop.iterations || []).find(it => it && it.n === num);
    if (!target) return Object.assign({}, empty, { mode: 'blocked', reason: 'no such iteration' });

    const affected = [target].concat(LJ.stackedAbove(loop, num));
    const commits = [];
    const commitless = [];
    let bad = null;
    for (const it of affected) {
      if (it.commit == null || it.commit === '') { commitless.push(it.n); continue; }
      if (!isSha(it.commit)) { bad = it.n; continue; }
      commits.push({ n: it.n, sha: str(it.commit).trim() });
    }
    // a malformed sha means a real commit exists that we cannot safely name — refuse rather than undo a
    // subset and report success for the whole stack.
    if (bad != null) {
      return Object.assign({}, empty, {
        mode: 'blocked',
        reason: 'iteration #' + bad + ' has a commit id this loop cannot read, so its work cannot be undone safely'
      });
    }
    if (!commits.length) {
      /* Nothing was ever committed for this stack. Which of two very different situations is it?

         · NO WORKDIR — the loop had no project folder at all, so its agent worked inside its own jail and a
           rejection costs the Commander's disk nothing. Genuinely 'none'.
         · A WORKDIR BUT NO BRANCH — the loop edited a real folder that is not a git repo. Those edits are on
           disk and are NOT being undone, so the rejection must say so out loud. */
      if (!loop.branch && loop.workdir && commitless.length) {
        return Object.assign({}, empty, {
          mode: 'unrevertable',
          commitless: commitless,
          reason: 'this project is not a git repo, so the files this iteration changed were left exactly as they are — undo them yourself if you need to'
        });
      }
      return Object.assign({}, empty, { commitless: commitless });
    }
    commits.sort((a, b) => b.n - a.n);                       // NEWEST FIRST — see the header
    return { mode: 'revert', commits: commits, commitless: commitless, reason: null };
  }

  /* harvestTarget(loop, opts) — may this iteration commit, and onto what?
       opts: { headBranch, isRepo, blessed, dateStr }
     Returns { ok, branch?, create?, reason? }. `create` is true when the loop has no branch yet, which is
     the one moment the host is allowed to run `checkout -b`. A loop whose recorded branch is protected is
     refused outright — that record could only come from a hand-edited file, and honouring it would commit
     the agent's work straight onto the Commander's main. */
  function harvestTarget(loop, opts) {
    opts = opts || {};
    if (!loop || !loop.workdir) return { ok: false, reason: 'this loop has no project folder' };
    if (!opts.blessed) return { ok: false, reason: 'the project folder is no longer approved' };
    if (!opts.isRepo) return { ok: false, reason: 'not a git repo' };

    if (loop.branch) {
      if (isProtectedRef(loop.branch)) return { ok: false, reason: 'refusing to commit onto ' + loop.branch };
      return { ok: true, branch: str(loop.branch), create: false };
    }
    const branch = branchName(opts.dateStr, loop.name, loop.id);
    if (isProtectedRef(branch)) return { ok: false, reason: 'refusing to write a protected ref' };
    return { ok: true, branch: branch, create: true, from: str(opts.headBranch) || null };
  }

  return {
    isProtectedRef, slugify, branchName, commitSubject, commitPaths, harvestDelta, isSafeRel, isSha,
    undoPlan, harvestTarget,
    SUBJECT_CAP, PATHS_CAP,
    _internals: { PROTECTED, SHA_RE }
  };
});
