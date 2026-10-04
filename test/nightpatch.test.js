/* node test/nightpatch.test.js — the PURE patch-apply TARGET RESOLVER (NS-5b).

   The night shift's project deliverable is a unified-diff .patch file in the workshop jail. On decide 'keep' the
   host may apply it to a NEW BRANCH in the user's repo — but ONLY into a currently-blessed root, and NEVER onto
   main/master beyond creating the branch. This pure module owns the SAFETY DECISION (which root, which patch file,
   what branch name); the git exec itself is ambient in index.js. Proves:
     · a keep only targets a root that is CURRENTLY blessed (a model-picked arbitrary path is refused)
     · the branch name is ns/<date>-<slug> and never main/master
     · the patch file must be a safe relative path inside the jail (no traversal / absolute) */
'use strict';
const A = require('./_assert.js');
const P = require('../sidecar/nightpatch.js');

const blessed = ['C:/Users/me/repo/alpha', 'C:/Users/me/repo/beta'];
const opts = { winish: true };

// ---- a valid patch manifest resolves to the blessed root + its patch file ----
(function validTarget() {
  const man = { kind: 'patch', targetRoot: 'C:/Users/me/repo/alpha', patch: 'fix.patch', files: [{ path: 'fix.patch' }] };
  const r = P.patchTargetFrom(man, blessed, opts);
  A.eq(r.ok, true, 'a blessed target with a patch file resolves');
  A.eq(r.root, 'C:/Users/me/repo/alpha', 'the blessed root is the apply cwd (never a model-picked arbitrary path)');
  A.eq(r.patchRel, 'fix.patch', 'the patch file is carried through');
})();

// ---- a target that is NOT currently blessed is refused (never blesses, never applies) ----
(function unblessedRefused() {
  const man = { kind: 'patch', targetRoot: 'C:/Users/me/secret', patch: 'fix.patch' };
  const r = P.patchTargetFrom(man, blessed, opts);
  A.eq(r.ok, false, 'an un-blessed root is refused');
  A.ok(/bless/i.test(r.reason), 'the refusal names the missing bless');
})();

// ---- a non-patch manifest (an ordinary file deliverable) is a clean no-op, not an apply ----
(function nonPatchNoop() {
  const r = P.patchTargetFrom({ kind: 'tool', targetRoot: 'C:/Users/me/repo/alpha' }, blessed, opts);
  A.eq(r.ok, false, 'a non-patch deliverable does not trigger an apply');
})();

// ---- the patch file must be a SAFE relative path inside the jail ----
(function safePatchPath() {
  A.eq(P.patchTargetFrom({ kind: 'patch', targetRoot: blessed[0], patch: '../../../etc/x.patch' }, blessed, opts).ok, false, 'a traversal patch path is refused');
  A.eq(P.patchTargetFrom({ kind: 'patch', targetRoot: blessed[0], patch: 'C:/abs.patch' }, blessed, opts).ok, false, 'an absolute patch path is refused');
})();

// ---- infer the patch file from files[] when `patch` is absent ----
(function inferPatchFile() {
  const man = { kind: 'patch', targetRoot: blessed[0], files: [{ path: 'notes.txt' }, { path: 'change.diff' }] };
  const r = P.patchTargetFrom(man, blessed, opts);
  A.eq(r.ok, true, 'a .diff in files[] is discovered');
  A.eq(r.patchRel, 'change.diff', 'the first diff/patch file is used');
})();

// ---- branchName is ns/<date>-<slug>, and never a protected ref ----
(function branchNaming() {
  const b = P.branchName('20260708', 'Fix the invoice export bug!!');
  A.eq(/^ns\/20260708-/.test(b), true, 'branch is under the ns/ namespace with the date');
  A.ok(!/\s/.test(b), 'branch name has no whitespace');
  A.ok(b !== 'main' && b !== 'master', 'never main/master');
  A.eq(P.branchName('20260708', ''), 'ns/20260708-patch', 'an empty title falls back to a stable slug');
  A.ok(P.slugify('Über Café: №1 — TODO/FIX').length > 0, 'slugify tolerates unicode + punctuation');
})();

// ---- isProtectedRef guards the never-mutate-main law ----
(function protectedRefs() {
  A.eq(P.isProtectedRef('main'), true, 'main is protected');
  A.eq(P.isProtectedRef('master'), true, 'master is protected');
  A.eq(P.isProtectedRef('ns/20260708-x'), false, 'an ns/ branch is not protected');
})();

A.report();
