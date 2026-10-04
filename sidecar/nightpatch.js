/* sidecar/nightpatch.js — the PURE patch-apply TARGET RESOLVER (autonomy layer, NS-5b).

   The night shift can't write into the user's real repo (its tools are jailed to the workshop). So a project-focus
   beat's deliverable is a UNIFIED-DIFF .patch file left in workshop/<runId>/. On decide 'keep' the host may apply
   that patch to a NEW BRANCH in the user's repo — human-gated, additive, reversible. This module owns the SAFETY
   DECISION only (which root the patch may touch, which file is the patch, what the branch is named); the git exec
   (branch create / apply / commit) is ambient in index.js.

   THE LAWS THIS ENFORCES (so index.js can't get them wrong):
     • NEVER apply into a root that is not CURRENTLY blessed — a model-authored manifest.targetRoot is untrusted; it
       must match (equal or be inside) a live `path:<root>` grant, and the matched BLESSED root (not the model's
       string) is the git cwd. An autonomous run can never bless a new root, and neither can a keep.
     • NEVER onto main/master — the only mutation allowed is CREATING a branch ns/<date>-<slug> and committing there.
     • The patch file must be a SAFE relative path inside the jail (no traversal, no absolute) — index.js re-jails it
       through fsJail.resolveInside too, but the shape is validated here as defense in depth.

   DETERMINISM SPLIT: pure — a transform over (manifest, blessedRoots, opts). No fs, no clock (the host passes the
   date string); lint-determinism clean; node-testable. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).nightpatch = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const str = (v) => (v == null ? '' : String(v));
  // Sets, not object literals: `({a:1})['constructor']` is truthy, so an object-literal allowlist
  // silently admits every Object.prototype key — and these keys come off persisted/model-supplied data.
  const PROTECTED = new Set(['main', 'master', 'head', 'trunk']);

  // never mutate a protected ref beyond branch creation. Case-insensitive.
  function isProtectedRef(name) { return PROTECTED.has(str(name).trim().toLowerCase()); }

  // slugify a title into a branch-safe segment: lowercase, non-alphanumerics → '-', collapse, trim, cap length.
  function slugify(title) {
    const s = str(title).toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/g, '');
    return s;
  }

  // the branch to create + commit on: ns/<date>-<slug>. Never main/master (slug can't be empty → 'patch').
  function branchName(dateStr, title) {
    const d = str(dateStr).replace(/[^0-9A-Za-z]/g, '') || 'x';
    const slug = slugify(title) || 'patch';
    return 'ns/' + d + '-' + slug;
  }

  // is a relative path safe to live inside the jail? no NUL, not absolute, no '..' segment, not empty.
  function isSafeRel(p) {
    const s = str(p);
    if (!s || s.indexOf('\0') >= 0) return false;
    if (/^[\\/]/.test(s) || /^[A-Za-z]:[\\/]/.test(s) || /^[\\/]{2}/.test(s)) return false;   // absolute / drive / UNC
    const parts = s.split(/[\\/]+/);
    for (const seg of parts) if (seg === '..') return false;
    return true;
  }

  // normalize a path for containment comparison (winish → lowercase + forward slashes).
  function normP(p, winish) {
    let s = str(p).replace(/[\\/]+/g, '/').replace(/\/+$/, '');
    if (winish) s = s.toLowerCase();
    return s;
  }
  // is `child` equal to or inside `base`?
  function sameOrInside(child, base, winish) {
    const c = normP(child, winish), b = normP(base, winish);
    return c === b || c.indexOf(b + '/') === 0;
  }

  /* patchTargetFrom(manifest, blessedRoots, opts) — resolve a keep into a safe apply target, or refuse.
       manifest: the validated deliverable.json ({ kind, targetRoot, patch?, files? }).
       blessedRoots: the LIVE blessed-root set (index.js: blessedRoots()).
       opts: { winish }  (path case-sensitivity — index.js passes path.sep === '\\').
     Returns { ok, root?, patchRel?, reason? }. `root` is the BLESSED root (the git cwd), never the model's raw
     string. Only manifest.kind === 'patch' triggers an apply — every other deliverable is an ordinary file keep. */
  function patchTargetFrom(manifest, blessedRoots, opts) {
    opts = opts || {};
    const winish = !!opts.winish;
    const man = (manifest && typeof manifest === 'object') ? manifest : {};
    if (str(man.kind) !== 'patch') return { ok: false, reason: 'not-a-patch' };
    const target = str(man.targetRoot);
    if (!target) return { ok: false, reason: 'manifest names no targetRoot' };

    const roots = Array.isArray(blessedRoots) ? blessedRoots.filter(Boolean) : [];
    let matched = null;
    for (const R of roots) { if (sameOrInside(target, R, winish)) { matched = R; break; } }
    if (!matched) return { ok: false, reason: 'target root is not currently blessed — refusing to apply' };

    // the patch file: explicit `patch`, else the first .patch/.diff in files[].
    let patchRel = str(man.patch);
    if (!patchRel) {
      for (const f of (Array.isArray(man.files) ? man.files : [])) {
        const p = str(f && f.path);
        if (/\.(patch|diff)$/i.test(p)) { patchRel = p; break; }
      }
    }
    if (!patchRel) return { ok: false, reason: 'no .patch/.diff file in the deliverable' };
    if (!isSafeRel(patchRel)) return { ok: false, reason: 'unsafe patch path' };

    return { ok: true, root: matched, patchRel: patchRel };
  }

  return { patchTargetFrom, branchName, slugify, isProtectedRef, isSafeRel, sameOrInside, _normP: normP };
});
