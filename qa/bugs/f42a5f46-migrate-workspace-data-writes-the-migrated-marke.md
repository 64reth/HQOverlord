---
fingerprint: f42a5f46
slug: migrate-workspace-data-writes-the-migrated-marke
title: migrate_workspace_data writes the .migrated marker unconditionally and drops copy_missing_dir's Err with no log — a partial legacy migration is permanent and lo
surface: release
severity: P1
status: fixed
found: 2026-07-28
lane: sweep/release
fix: 5f8aa7ce
---

# migrate_workspace_data writes the .migrated marker unconditionally and drops copy_missing_dir's Err with no log — a partial legacy migration is permanent and lo

## Symptom

On an upgrade where the live workspace root is empty and a legacy root (%LOCALAPPDATA%\StarNet\workspaces, ...\Skynet\workspaces, <install>\sidecar\workspaces) holds the user's sessions/keys/projects/station, a single I/O failure during the copy (Windows sharing violation from a lingering old sidecar, AV lock, ACL denial, long path) aborts that whole subtree — and the app then writes the .migrated marker anyway, so the migration is never retried. The user boots into a partially-populated or empty station with no error, no dialog, and no log line naming what failed. The startup log records `migrated_from=[]`, which is byte-identical to the honest "no legacy data existed" case.

## Repro

Cold-start path only (live root empty, legacy root populated): 1) rename %LOCALAPPDATA%\ai.skynet.harness\workspaces aside so the live root is absent; 2) populate %LOCALAPPDATA%\StarNet\workspaces with agent.save.json + sessions; 3) hold an exclusive open handle on one file inside it (a lingering node.exe sidecar, or `Get-Content -Wait`); 4) launch StarNet. Result: copy_missing_dir returns Err at that file, the remaining tree is skipped, `.migrated` is written, startup.log shows `migrated_from=[]`, and no subsequent boot ever retries. The parallel purge routine at lines 565-575 shows the intended pattern — it logs every soft-fail — while this path logs nothing at all.

## Evidence

`src-tauri/src/main.rs:471`

**Mechanism (read from the code):** `migrate_workspace_data` (lines 445-473): `if copy_missing_dir(legacy, current).is_ok() { migrated.push(legacy.clone()); }` — the Err arm is discarded entirely, with no `log_startup` call. Then line 471 `let _ = std::fs::write(&marker, b"1");` runs unconditionally, outside any success check. `copy_missing_dir` (393-416) propagates the first error with `?` through its recursion, so one locked file aborts everything remaining in that tree. The doc comment on lines 443-444 claims "The marker is written only AFTER the copy pass completes, so a crash mid-copy simply retries the (idempotent, copy-missing-only) migration next boot rather than stranding a half state" — that reasoning holds for a process crash but NOT for a returned Err, which is the far more likely failure and is exactly what the marker then locks in forever. Guard (1) at line 451 makes it permanent; guard (2) at line 456 would also stamp it, since a partial copy leaves real content behind.

**Existing test coverage:** test/desktop-workspace-migration.test.js — a source-REGEX lock over main.rs (asserts the legacy roots are listed, that copy is dst-missing-only, that symlinks are skipped, that MIGRATION_MARKER exists and is checked, and that migration precedes spawn_sidecar). It never executes the Rust and has no assertion touching copy_missing_dir's Err path or the unconditional marker write, so it passes vacuously with respect to this defect.

**Adversarial verdict (survived refutation):** Confirmed verbatim. src-tauri/src/main.rs:465 `if copy_missing_dir(legacy, current).is_ok() { migrated.push(legacy.clone()); }` discards the Err arm with no log_startup call, and :471 `let _ = std::fs::write(&marker, b"1");` runs unconditionally outside any success check. copy_missing_dir (:393-415) propagates the first error via `?` through its recursion (:411-413), so one locked/denied file aborts the remaining subtree. The doc comment at :443-444 justifies marker-last as crash-safety only, which does not cover a returned Err; guard (1) at :451 then makes the half-state permanent. The caller at :2140-2147 logs only `migrated_from={:?}`, which for an aborted copy prints `[]` — byte-identical to the honest 'no legacy data' case. The contrast the claim draws is real: the purge routine at :565-575 logs every soft-fail as `webview-cache-purge: SKIP … (soft-fail: {e})`. test/desktop-workspace-migration.test.js is a pure source-regex lock over main.rs (legacy roots listed, dst-missing-only copy, symlinks skipped, MIGRATION_MARKER declared/checked, migration before spawn) with zero assertion on the Err arm or the unconditional marker write — it passes vacuously with respect to this defect.

_Found by the `sweep/release` lane, 2026-07-28. Finder confidence: medium. Severity claimed P1, after refutation P1._

## Verdict

_Filled in when the bug leaves the backlog: what was true, and why it is closed._
