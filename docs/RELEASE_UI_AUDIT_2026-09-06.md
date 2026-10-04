# September 6 merge stability audit

Audited integration snapshot: `d107e5ef2` on `feat/harness-backend`.
Isolated repair branch: `agent/release-ui-audit-0906`.
Frozen repair candidate: `4f338ad8d65961602fdcecf2dd4399bc9a3c5dca`.

## Authorized integration — completed September 6

The owner subsequently authorized merging these repairs. The branch merged current integration
`b8f8e8dd655a79d0f6b638a3c1d0d2087b8776d0`, including Google sign-in and simplified Abilities.
Only generated QA records conflicted: the bug index was regenerated and the current claims
inventory/verdicts were preserved while refreshing source fingerprints.

Integration fast-forwarded from that snapshot to the exact verified candidate
`f4baf0d2038b3e8b668959634e8e13fac6d53c85`:

- Full fast gate: 724/724 before merge and 724/724 after merge, both exit 0.
- Full live journeys: 130/130, exit 0, `fullSuite:true`, zero soft failures, same candidate SHA.
- Real seeded app: export/change/import restored ANDROMEDA, HIGH lighting, 130% text and inbox
  rows; sidecar restart and reload retained them. Merged extension editors opened and cancelled
  with focus restored; catalog sign-in filter worked. No uncaught JavaScript exceptions.
- Existing integration-tree QA notes and Rooms handoff were hash-verified unchanged by the merge.

Local receipts: `premerge-fast.log`, `premerge-live.log`, `premerge-journeys.log`,
`postmerge-fast.log`, their `.exit` files, and `merge-snapshot.json`, under
`.bugloops/release-ui-audit-0906/`. The follow-up receipt commit changes documentation only.
The integration delta contains frontend/QA repairs, so no full HTTP suite was owed or claimed.
Seven P1 findings remain open, including incomplete Workshop output. This integration does not
certify release readiness, installed-desktop behavior, or production Google sign-in. No push,
installer rebuild, publication, or deployment was performed. The original audit below is historical.

## Findings

1. **P1, open: incomplete Workshop output can still be reported as built.** The full
   live journey suite returned `reason:built` for a web tool whose manifest contained
   only `README.md`; its HTML entrypoint was missing. `validateWorkshopManifest`
   silently removes missing members while retaining the complete artifact's title,
   summary, and instructions. The focused repeat produced the HTML but timed out
   writing README, demonstrating that a single passing entrypoint check is insufficient.
   This filtering dates to July 3, not the latest visual merges.
   Record: `qa/bugs/097269b5-workshop-reports-a-completed-web-tool-when-its-e.md`.

2. **P1, source fixed: a passing focused journey could satisfy release readiness.**
   After a full-suite failure, `--only J4` wrote a 13/13 passing canonical receipt;
   `qa:ready` accepted its journey component. Commits `b45e6ab8d` and `042394b7d` record whether
   the full suite ran and requires explicit boolean full-suite proof in the reader.
   Old unscoped receipts require a new complete run. The actual live after-fix
   `--only J6` result passed 6/6 and was correctly rejected by readiness.
   Record: `qa/bugs/3d9dce85-filtered-journey-run-can-replace-the-full-releas.md`.

3. **P2, source fixed: station backups silently lose appearance choices.** The
   export omitted backdrop, text size, and session-row preferences. A real export
   of ANDROMEDA followed by switching to VOID and importing reported success but
   kept VOID. Commit `336919446` includes all three fields in the existing browser
   settings section and synchronizes the website mirror. After repair, real export,
   changed preferences, import, and a sidecar restart retained ANDROMEDA, HIGH room
   lighting, 130% text, and INBOX rows. The omission predates the latest backdrop
   redesign. Record: `qa/bugs/f5a90439-station-backup-omits-backdrop-text-size-and-sess.md`.

No newly introduced regression was confirmed in the latest recruitment, lighting,
wall, or backdrop changes within the tested interactions. This is a bounded audit,
not proof that every merged surface is defect-free.

## Live verification

- Real seeded frontend and sidecar, isolated ports 9186/9188, repository CDP harness.
- Recruitment: distinct proposed names, created roster identity, reload retention,
  overlong-name refusal, duplicate warning/second confirmation, and zero uncaught
  exceptions in the identity journey: all 12 checks passed.
- Recruitment at 1440, 1024, 820, 768, 640 and 390 CSS-pixel widths: tested roster and
  dossier states, available narrow-screen back control, and no visible control outside
  the viewport. These are geometry checks, not hardware or visual-quality certification.
- Opened the twelve dock terminal surfaces and checked visible controls for native
  white/grey paint signatures: none found. Panel opening measurements taken under
  concurrent host load are not presented as performance benchmarks.
- Room lighting buttons mapped to actual renderer ambient values LOW .82, MEDIUM .72,
  HIGH .62. Backdrop switching exercised THE BELT, VOID and ANDROMEDA.
- Full core journey run: 121/122 assertions passed, failed on the missing HTML file.
  Interruption, reload-during-run, repeated sends, task-board truth and slash dispatch
  checks passed. A focused J4 repeat passed 13/13 but still lost a supporting file;
  it is not evidence that the complete-build defect is repaired.
- Backup repair: `settings-p1-ui.test.js` 70 assertions; release receipt repair:
  `qa-ready.test.js` 118 assertions. Both regressions were demonstrated failing before
  their respective source edits.

## Validation receipts

Frozen candidate `4f338ad8d65961602fdcecf2dd4399bc9a3c5dca`:

    npm run test:fast    -> run-fast-tests: OK — 723 step(s) green; exit 0
    npm run qa:journeys  -> JOURNEYS PASS — 130/130 assertions passed; exit 0
    npm run qa:ready     -> NOT READY — 5 reasons; exit 1

The saved live journey receipt carries the exact candidate SHA, `fullSuite:true`,
`result:pass`, `passed:130`, `total:130`, and `softFails:0`.
Final local evidence: `verified-fast.log`, `verified-journeys.log`,
`verified-ready.log`, and `verified-exits.json` in the audit artifact directory.

The readiness reasons are seven open P1 bug records; no Guardian receipt in this
isolated worktree; journey SHA differing from the newer integration head `948557c62`;
no Beginner Run receipt; and no installed-exe smoke receipt. The absence of local
receipts is not proof those checks failed elsewhere, and a branch pass is not a
release-candidate pass.

Initial setup lacked the worktree's dependency tree; a node_modules junction to the
existing installed dependencies resolved that. An LSP test failed during concurrent
work and passed in isolation and in the subsequent full run. The initial complete
fast run passed 723/723, but final receipts below are the authority for the frozen
repair candidate because some edits were made during that earlier run.

## Release limits and handoff

The bug register retains seven open P1 records: the new incomplete-deliverable finding
and six existing customer reports involving paid onboarding, zero-credit warnings,
Sonnet HTTP 400, blank viewport after idle, unexplained idle usage, and a missing ONCE
routine. Source fixes, installed verification and customer recovery remain separate.

No installed Windows or Mac candidate, signed installer, production provider account,
long idle/sleep-wake soak, or customer recovery was verified. The backup flow used the
real local app with no provider calls; task journeys used local provider mocks.
No full HTTP suite was required for these frontend/QA repairs, and none is claimed.
No merge, push, publication, or deployment was performed; the integration tree was
left to the owner's ongoing merges.

Evidence files live in this worktree's ignored `.bugloops/release-ui-audit-0906/`.
The tracked bug records preserve the essential before/after observations independently
of those local logs. Recheck any merges that land after the audited integration SHA.

During final validation, integration advanced to `948557c62` (Extensions simplification).
Its production delta from the audited snapshot is in `frontend/app/windows/connectors.js`
and `frontend/css/app.css`. That additional diff was reviewed for form wiring, existing
create/allow/revoke endpoints, read-failure handling and inline deletion confirmation.
It was not merged into this frozen repair candidate or exercised live in this audit;
the final combined release must verify it. No regression is claimed from that read alone.
