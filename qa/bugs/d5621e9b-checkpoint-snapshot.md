---
fingerprint: d5621e9b
slug: checkpoint-snapshot
title: checkpoint snapshot() uses the SYNC loadIndex despite being async — after an index+bak loss it re-stamps a 1-entry index that permanently blocks the git rebuild
surface: sessions
severity: P1
status: fixed
found: 2026-07-28
lane: sweep/sessions
fix: b315063b
---

# checkpoint snapshot() uses the SYNC loadIndex despite being async — after an index+bak loss it re-stamps a 1-entry index that permanently blocks the git rebuild

## Symptom

After a crash/torn write that leaves index.json (and its .bak) unusable while the shadow git repo is intact, the very next mutating tool call silently rewrites the rollback index down to ONE entry. The rewind UI shows a single restore point instead of the Commander's real history, and restore() refuses every earlier snapshot id even though the commits are still on disk — work the Commander could have rolled back to becomes unreachable.

## Repro

Real git, temp root, keep:20. Take 5 snapshots (each after a real file edit). Delete .checkpoints/<aid>/index.json and index.json.bak. Confirm the recovery path works: listResilient() rebuilds all 5 from git log. Re-delete both files, edit the file once more, then call snapshot() BEFORE any list (the order a real run takes — a mutating tool snapshots first). Observed live: 6 commits remain in the shadow repo, but the index now holds 1 snapshot, and `restore(aid, <oldest pre-crash id>)` returns false.

## Evidence

`sidecar/checkpoint-store.js:258`

**Mechanism (read from the code):** `snapshot()` is async and `loadIndexResilient()` sits right above it, but line 258 calls the SYNC loader: `const index = cp.record(loadIndex(aid), {...})`. `loadIndex` consults only index.json + index.json.bak and returns `cp.toIndex([])` on failure (line 87) — it deliberately 'Never rebuilds (git is async)' (line 77). `saveIndex` then persists that 1-entry index. From then on `readIndexRaw` reports status 'ok', so `loadIndexResilient` (line 137: `if (m.status === 'ok') return m.index;`) never reaches `rebuildIndexFromGit`, and `restore()`'s gate `if (!cp.findById(await loadIndexResilient(aid), sha)) return false;` (line 276) refuses the surviving commits forever. The header claims 'the shadow git COMMITS are the truth; the index.json is just a cache of them' (line 105) — snapshot() is the one writer that does not honour that. The same asymmetry makes the catch at line 262 dishonest: its comment says 'index persistence failed — the git commit still exists + is restorable', but a commit missing from a NON-empty index is not restorable via restore() at all.

**Existing test coverage:** test/checkpoint-store.test.js:89-97 — wipes BOTH index.json and .bak and proves listResilient() rebuilds from the git commits and re-persists. It never calls snapshot() while the index is still missing, so it covers the read order but not the write order a live run actually takes. No test found for snapshot()-after-index-loss.

**Adversarial verdict (survived refutation):** Read + reproduced live with real git. checkpoint-store.js:258 calls the SYNC `loadIndex(aid)`, which returns `cp.toIndex([])` when index.json and index.json.bak are both gone (line 87) and explicitly 'Never rebuilds (git is async)' (line 77); saveIndex(261) then persists that 1-entry index, after which readIndexRaw reports 'ok' so loadIndexResilient short-circuits at line 137 and rebuildIndexFromGit is never reached again — restore()'s gate at line 276 then refuses every surviving commit. Repro output: 5 snapshots, delete index.json + .bak, CONTROL listResilient() rebuilt all 5 (the documented recovery works in READ order); re-delete both, edit the file, call snapshot() first (the WRITE order a mutating tool call takes) -> 6 commits still in the shadow repo, `index len AFTER snapshot(): 1`, `listResilient len AFTER snapshot(): 1`, and restore() returned false for all 5 pre-crash ids. Dispositive on intent: the module's own docstring at line 134 says loadIndexResilient is 'Used by every await-capable caller (snapshot/restore/the list route)' — snapshot is the ONLY await-capable caller that uses the sync loader, so this contradicts documented design rather than expressing it, and it also makes the catch comment at line 262 ('the git commit still exists + is restorable') false once the index is non-empty. test/checkpoint-store.test.js:89-97 covers only the read order (wipe both, then listResilient) and never calls snapshot() while the index is missing. Kept at P1, not P0: it requires the narrow precondition that index.json AND its durably-written .bak are both lost while the repo survives.

_Found by the `sweep/sessions` lane, 2026-07-28. Finder confidence: medium. Severity claimed P1, after refutation P1._

## Verdict

_Filled in when the bug leaves the backlog: what was true, and why it is closed._
