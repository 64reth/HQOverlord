---
fingerprint: cf0cd4cd
slug: the-projects-rail-s-add-doorway-records-a-non-ca
title: The Projects rail's ADD doorway records a NON-canonical path grant, so blessing a folder reached through a junction/symlink reports success and grants nothing
surface: safecell
severity: P1
status: fixed
found: 2026-07-28
lane: sweep/safecell
fix: 226cec3c
---

# The Projects rail's ADD doorway records a NON-canonical path grant, so blessing a folder reached through a junction/symlink reports success and grants nothing

## Symptom

The Commander clicks + ADD (or BROWSE…) in the PROJECTS rail and picks a folder whose path traverses a junction or symlink (a Windows junction, a OneDrive-redirected known folder, ~/code → /mnt/data/code, macOS /tmp → /private/tmp). The UI notifies 'added "<folder>"' and the rail renders the row as a trusted project (git badge, no REVOKED tag, + NEW enabled). The agent is then denied on every file in it: a watched session raises the folder-trust card again on EVERY single file touch, and an unattended run hard-denies with "an autonomous run cannot bless a new folder". The exact consent-fatigue loop the 2026-07-27 pathtrust fix was written to kill, re-opened at the sibling doorway.

## Repro

Live, on a real Windows junction (proved in this session):

  cd <scratch> && cmd /c "mklink /J link <scratch>\real"   # real/proj/src/a.js exists

then drive the two real cores against it — POST /api/projects/bless equivalent, followed by the run's own guard:

  typed folder        : ...\scratchpad\link\proj
  its realpath        : ...\scratchpad\real\proj
  POST /api/projects/bless -> {"ok":true,"root":"...\\link\\proj","isGitRepo":false}
  standing grant key  : path:...\link\proj
  rail shows blessed  : true
  watched agent read  : DENIED — "access to ...\link\proj\src\a.js was denied"  | re-prompted: 1
  autonomous run read : DENIED — path is outside the agent workspace and no project root grant covers it
  CONTROL chat doorway: path:...\real\proj\src   (canonical — never re-prompts)

Same result with the injected-fs shape used by pathtrust.test.js:242-260 (SYM=/home/me/code → REALROOT=/mnt/data/code): blessPath returns ok:true with root '/home/me/code', and the very next guard() call re-prompts.

## Evidence

`sidecar/projectbless.js:78`

**Mechanism (read from the code):** pathtrust.guard canonicalizes before recording: `const proposedReal = await realpathOrSelf(proposed);` (pathtrust.js:149) and then `await bless(proposedReal, ...)` (:175) — with the in-file comment explaining that `normalizeRoot` is only `P.resolve`, so an un-canonical key "could never match" the realpath comparison in step 1. projectbless.blessPath never does that step: `const proposed = normalizeRoot(await detectRoot(norm));` (:72) then `const isGit = await isGitRepoOf(proposed);` / `const ok = await bless(proposed, ...)` (:77-78) — the raw P.resolve string. Meanwhile the enforcement seam still compares realpaths: guard computes `const real = await realpathDeepest(norm);` (:124) and tests `pathInside(real, R)` against `blessedRoots()` (:135-137), which index.js:2023 derives verbatim from the stored `path:` keys. The rail meanwhile reports the row as trusted from the un-canonical key it stored: `blessed: grantsPermanent.has('path:' + p.root)` (index.js:11513). UI says trusted; enforcement says no.

**Existing test coverage:** test/projectbless.test.js — cannot see this: its fake fs defines `async realpath(p) { return norm(p); }` (line 26), i.e. the identity function, so a symlinked ancestor is unrepresentable in the whole suite. The identical case IS covered for the OTHER doorway at test/pathtrust.test.js:238-260 ("the grant is recorded under the CANONICAL (realpath) root"), which is what makes this a one-producer fix that never generalized.

**Adversarial verdict (survived refutation):** Confirmed by reading both doorways and reproducing. sidecar/projectbless.js:72 computes `const proposed = normalizeRoot(await detectRoot(norm))` and :78 calls `bless(proposed, …)` — normalizeRoot is only `P.resolve` (sidecar/pathtrust.js:84) and detectRoot (pathtrust.js:99-111) only stats ancestors, so no realpath ever happens on this path. The sibling doorway DOES canonicalize: pathtrust.js:149 `const proposedReal = await realpathOrSelf(proposed)` and :175 `await bless(proposedReal, …)`, with the in-file comment at :154-160 explaining precisely why (an un-canonical key 'could never match'). Enforcement compares realpaths: pathtrust.js:125 `realpathDeepest(norm)` then :135-137 `pathInside(real, R)` over sidecar/index.js:2023 blessedRoots(), which strips the stored key verbatim. sidecar/index.js:11528 hardcodes surface 'interactive' and passes the typed path straight through; sidecar/index.js:2027-2039 blessProjectRoot does no canonicalization of its own. I ran the injected-fs shape (SYM=/home/me/code → REALROOT=/mnt/data/code): blessPath → {ok:true, root:'/home/me/code'}, stored key `path:/home/me/code`, and the very next watched guard() re-prompted (asked=1, then 'access … was denied'), while the autonomous guard threw 'no project root grant covers it'. The rail still reports it trusted — sidecar/index.js:11513 joins `blessed: grantsPermanent.has('path:' + p.root)` against the same un-canonical key. Test coverage is structurally blind exactly as claimed: test/projectbless.test.js:26 defines `async realpath(p) { return norm(p); }` (identity), so a symlinked ancestor cannot be expressed; the identical case is covered for the other doorway at test/pathtrust.test.js:238-260.

_Found by the `sweep/safecell` lane, 2026-07-28. Finder confidence: high. Severity claimed P1, after refutation P1._

## Verdict

_Filled in when the bug leaves the backlog: what was true, and why it is closed._
