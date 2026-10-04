# v0.10.13 cut checklist — REFRESHED 2026-09-02

Refreshed on 2026-09-02 against cut-preparation parent
`a39e0953cd4f26afe4d25dad4539c17e13437175` on `feat/harness-backend`. The documentation commit that
records this snapshot is intentionally not counted.
This is a point-in-time inventory, not release authority. `docs/RELEASE_RUNBOOK.md`,
`npm run release:preflight`, and `npm run qa:ready` remain authoritative at cut time.

The frozen branch was `rc/0.10.13`; its RC marker was the tag `rc/0.10.13-rc.1`. Both pointed at
`5e7ff198ee73ecfc831de87eae316e689690a1ec`, which is **invalidated**. Its soak evidence remains
useful forensic history, but its bytes contain the confirmed durable-store quarantine deadlock and
cannot be promoted or used to satisfy a later candidate's soak. The misleading remote release branch
was preserved as `archive/rc-0.10.13-rc.1-invalid`, then `origin/rc/0.10.13` was deleted; the marker
tag remains for forensic identity. The RC.1 heartbeat is retired. RC.2 is frozen at
`0365ceb92d6389081ff8bae8457cf6516d850828` and marked by `rc/0.10.13-rc.2`; its Windows installer
passed a byte-bound installed smoke and a real OpenRouter dogfood shift. Andrew has explicitly waived
a second full 48-hour duration run for the same-night cut. That waiver does not convert RC.1 evidence
into RC.2 evidence.

## Recommendation

Cut `0.10.13`. Although the tree gained environment discovery, outcome learning, 42 new
connector/key-directory entries, and the 19-system LINES library, StarNet's established 0.10.x
release convention has already carried similarly large feature bundles in patch releases. For
comparison, `0.10.2` contained 252 commits across 250 files and `0.10.8` contained 228 commits
across 204 files; this snapshot contains 205 commits across 187 files. No singular product-generation
or intentionally breaking contract justifies moving the release line to `0.11.0`.

## Measured delta from v0.10.12

| Item | Value |
| --- | --- |
| Baseline | `v0.10.12` · `86f8fd144d11b6c28a34cfc105f5429f611cb5a1` · 2026-08-26 |
| Candidate snapshot | `a39e0953cd4f26afe4d25dad4539c17e13437175` · 2026-09-02 cut preparation |
| Commits | 212 total · 192 non-merge · 20 merge |
| First-parent history | 76 commits |
| Source delta | 195 files · 8,116 insertions · 627 deletions |
| Current version pins | all five agree on `0.10.13` |
| Local vs origin | candidate is 212 commits ahead of `origin/feat/harness-backend` |
| Claims surface | PASS · 37 claims / 212 locked surface files at the cut-preparation parent |
| Website mirror | PASS · in sync |

## 2026-09-02 release-blocker repair and adversarial review

Both previously unreviewed August 31 sweep batches were reviewed commit-by-commit:
`5558a707a..422e38c6f` (24 commits) and `5ab47a230..66a37410f` (16 commits).
The review reproduced or confirmed the reported failure paths and added a fifth concrete finding.

| Finding | Resolution |
| --- | --- |
| Absent main plus empty/corrupt orphan `.bak` permanently wedged every durable store key | Fixed: quarantine targets the actual bad generation and a successful quarantine permits same-call empty initialization; regression covers restart-safe forensic preservation. |
| A headed browser teardown timeout could leave an unshimmed driver reusable | Fixed: failed teardown invalidates the driver and latches the browser subsystem closed for the run; the next mode-less action is refused. |
| KEEP/EDIT consumed a pending skill proposal before its durable write | Fixed: lookup is non-consuming and the proposal is dropped only after a successful write; rejected writes return a retryable result instead of a route 500. |
| Attachment verification failures could strand an unverified final file or temp artifact | Fixed: rejected uploads remove only the names created by that attempt; collision failures never delete another target. |
| Logout/FORGET retains the live session when credential removal cannot be proven on disk | **Intentional fail-closed contract, not reverted.** Clearing RAM alone would display a false logout while the persisted secret could resurrect on restart. The route returns failure and keeps the session usable until both protected copies are sanitized and read back. |

No additional P0/P1 was found in those 40 commits. This closes the missing adversarial-review
process debt for the two sweep merges. On the repair head, `test:fast` is GREEN (691/691 steps),
`test:http` is GREEN (87/87 steps), and the claims authority is GREEN (37 claims / 212 files); the
merged tree must repeat the binding gates.

The two agreed next-cut requirements are now represented in code: creating a new Commander resets
`starnet.tutorial.v1` and re-arms the tour/coachmarks/FIRST STEPS, and the save-unreachable screen
shows stable `SAVE-403` versus `SAVE-NET` diagnosis plus copyable recovery details. The existing
genesis `USE A DIFFERENT ACCOUNT` action clears a wrong StarNet account link in-app. Physical macOS
runtime proof is still owed; Windows tests and source inspection are not a substitute.

Live Windows proof used the real seeded sidecar and an isolated worktree scratch workspace. After a
process stop, the restarted app encountered an absent `station.widgets.json` plus a corrupt orphan
`.bak`, quarantined that exact backup, and served `GET /api/widgets` as HTTP 200 with an empty list.
The live UI also rendered the recovery-report and `USE A DIFFERENT ACCOUNT` surfaces. This is not the
still-owed physical macOS recovery proof.

## Every merge since v0.10.12

### Merge commits on the resulting first-parent history

| Date | Commit | Subject |
| --- | --- | --- |
| 2026-08-28 | `52b4a64a1` | bug-sweep batch 2 — UI/runtime race fixes |
| 2026-08-28 | `1deadf105` | bug-sweep batch 3 — recovery, OAuth, MCP, Gemini, and cron fixes |
| 2026-08-28 | `20a199a04` | bug-sweep batch 4 — loops, cron, checkpoints, and backup promotion |
| 2026-08-28 | `9ab3609af` | bug-sweep batch 5a — channels, processes, filesystem, decoding, and outbox progress |
| 2026-08-28 | `6a683f7f6` | bug-sweep batch 5b — deliverables, automation guards, and window-state protection |
| 2026-08-28 | `503f16141` | cron reliability sweep reconciled into the adversarial review-fix lane |
| 2026-08-28 | `6748695dd` | discovery lane pre-merge trunk synchronization |
| 2026-08-28 | `29d20006d` | cron search-stall performance fix reconciled into discovery |
| 2026-08-30 | `88aaccc84` | outcome-learning lane synchronized with the useful-trio line work |
| 2026-08-30 | `de21aec23` | KEYS wave 2 synchronized with conveyor and outcome-learning work |
| 2026-08-31 | `2688de2ca` | broad sweep and durability fixes |
| 2026-08-31 | `b2b7b87f6` | overnight persistence and recovery fixes |
| 2026-08-31 | `446745e8d` | Ollama cold starts allowed past 30 seconds |

### Nested lane-synchronization merges

| Date | Commit | Subject |
| --- | --- | --- |
| 2026-08-28 | `e047de75a` | recommendation-deadwire trunk synchronized into cron reliability |
| 2026-08-28 | `db533a324` | cron/review-fix trunk synchronized into connector catalog wave 4 |
| 2026-08-30 | `af1fdaabd` | BYOK credits fix synchronized into the LINES library lane |
| 2026-08-30 | `1cd7c6d82` | cascaded-fanout fix synchronized into recommendation consistency |
| 2026-08-30 | `37becca5e` | recommendation consistency synchronized into the escalation lane |

## Change groups

### User-facing additions

1. **Environment discovery** — scans only explicitly blessed roots; findings carry verbatim citations;
   the FOUND ON YOUR PROJECTS shelf offers explicit handoff and arm-confirmed dismissal; Night Shift can
   cite the same findings without self-granting or auto-running them.
2. **LINES library** — the shelf expanded from 4 to 19 compiled systems: Revision Loop, Triage Desk,
   Research Swarm, Second Opinion, Front Desk, Assembly Line, Code Foundry, The Gauntlet, The Crucible,
   Mission Control, The Deep Dive, Allowance Desk, Two Doors, Load Balancer, and Fire Escape join the
   original starter lines. Cascade fan-out, simulation lane fidelity, and loop-gate escalation were fixed
   while building the library.
3. **Outcome learning** — completed-run track records feed the evidence composer, Night Shift context,
   quest success priors, recommendations, and `/api/insights` through support-gated literal counts.
4. **Connector expansion** — 18 OAuth rows plus keyless OpenAI DevDocs were live-probed and added.
5. **KEYS expansion** — 23 specialized business/service entries were live-probed and added.

### High-value fixes

1. **BYOK billing:** linked stations no longer require or debit StarNet credits for user-funded provider runs.
2. **Routines/cron:** one-shot truth, leases, cancellation, retry anchors, DST/midnight gaps, bad schedule
   inputs, clock shifts, zombie settlement, and sparse-date search performance.
3. **Durability/recovery:** transactional or rollback-safe writes across saves, backups, checkpoints,
   cloud save, credentials, OAuth, roster, skills, permissions, attachments, outbox, workspace ownership,
   and process receipts.
4. **Providers/loop:** Gemini replay/usage ordering, OpenAI-compatible parallel calls and continuations,
   durable tool-result recovery, output-budget behavior, and Ollama cold starts.
5. **Channels/processes/UI:** Discord backoff, partial-delivery progress, unique outbox IDs, bounded process
   cleanup, profile teardown, draft preservation, minimized-window safety, drag release, and double-submit guards.

## Preflight status for the cut candidate

`npm run release:preflight -- --version 0.10.13`

Exact RC.2 evidence includes a byte-bound Windows installed smoke, real OpenRouter dogfood, Beginner
Run PASS, Guardian GREEN, journeys 130/130, and `qa:ready` READY. The installed-smoke schema-3
`result` field is now read correctly by preflight. RC.1 receipts are not reused; the missing full RC.2
duration is the explicit owner-directed exception recorded in `docs/NEXT.md`.

Other owed work:

- binding `test:fast` and `test:http` receipts must be earned **after** the version bump;
- hosted T0 clean-install and G1 packaged-lifecycle proofs are owed against the staged draft;
- the full RC.2 soak duration is explicitly waived for this same-night cut; RC.1 time is not credited;
- physical macOS recovery proof still requires a real-Mac pass or a separate explicit owner waiver;
- updater-key backup to two offline locations requires human attestation;
- `qa/STATUS.md` must be committed separately or stashed before tagging;
- the 212 candidate commits and the final tag must both reach origin for the train to build the intended bytes.

## Current QA evidence

The last pre-repair `qa:ready` receipt is historical only. Its passing evidence is still useful:

- ledger: 0 open P0 · 0 open P1;
- bug register: 0 open P0 · 0 open P1 · 0 open P2;
- Guardian: GREEN on its then-exact head;
- journeys: PASS, 130/130 assertions;
- claims planning authority: PASS, 37 claims / 212 files;
- website mirror: exact.

The 555 open QA findings are all P2 and do not make `qa:ready` red. They remain backlog, not proof that
the product is perfect; no PRODUCT PERFECT claim is made.

## Current public updater baseline

`npm run release:verify-host -- --expect-version 0.10.12` returned **ALL CHECKS PASSED** on
2026-08-31. The live `latest.json` is reachable, identifies `0.10.12`, contains signed entries for
`windows-x86_64`, `darwin-aarch64`, and `darwin-x86_64`, pins every asset URL to `v0.10.12`, and every
required artifact returns HTTP 200. The existing fleet feed is healthy before the `0.10.13` cut.

## Cut sequence

1. Keep the exact final candidate immutable after its claims re-lock and binding gates.
2. Stash the Guardian-owned `qa/STATUS.md` refresh before pushing; never fold it into the tag.
3. Rebuild/install the exact final candidate and repeat the byte-bound installed smoke.
4. Run a fresh full Guardian cycle and `npm run qa:ready`; stop unless it prints READY.
5. Run post-bump preflight and inspect every warning. The duration waiver is documentary, not a false
   machine PASS.
6. Require explicit resolution of physical macOS recovery proof and human attestation of two usable
   offline updater-key copies before pushing the tag.
7. Push `feat/harness-backend` and `v0.10.13` together, supervise the signed train, and inspect both
   notarized Mac legs plus signed Windows artifacts in the staged draft.
8. Run hosted T0 and G1 against the staged draft. Do not Publish unless both pass.
9. Publish, verify the source-release mirror and hosted updater feed, then run the older-client installed
   update canary.

## Intentionally not done in this preparation pass

- version pins are bumped to `0.10.13`;
- local `v0.10.13` exists but remains unpushed until the final gates and attestations;
- no push, release-train dispatch, draft, publish, website deploy, or credential action;
- no claim that `0.10.13` is release-ready;
- no reuse of pre-bump gates as the post-bump or packaged-artifact receipts.

## Post-publish record (2026-09-03)

`v0.10.13` was published as Latest on `androoAGI/starnet-releases` at 04:41Z with signed Windows and
both notarized macOS legs; hosted T0 and G1 passed against the staged draft first. Two rows in the cut
sequence above were NOT satisfied at Publish time and the record must say so:

- **Physical macOS recovery proof — WAIVED retroactively, owner-directed.** No real-Mac pass of the
  unreachable-station → START COMPLETELY FRESH / SAVE-403 / SAVE-NET path was performed; the train's
  `macos-15-intel installed-acceptance` job is a CI runner, not that check. Andrew directed the
  2026-09-03 audit's item 2 to execute, whose stated alternative to a borrowed-Mac pass was to write
  this waiver so the checklist stops lying. The waiver covers 0.10.13 only. **The physical Mac pass
  is the first MUST of the next cut** (see NEXT.md); no further cut may publish on a CI-runner Mac
  leg alone without a fresh, separately written owner waiver.
- **Updater-key two-offline-copies attestation** — still unattested at publish; owed by the owner.
