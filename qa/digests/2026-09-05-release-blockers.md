# Release-blocker follow-through — 2026-09-05

Lane: `agent/release-blockers-0905`, isolated from trunk `94bff3a5f` while the owner finishes merges.
This is a source/seeded-browser verification receipt, not release or customer-recovery certification.

## Repairs

- Reproduced `J1/assigned-card-active` failing because its heading check still required `ACTIVE`.
  The production board correctly said `IN PROGRESS / REVIEW`. The assertion now checks that heading,
  the workstream's internal `active` lane, the card's running chip, and `Channels.isBusy` together.
  Before: J1+J6 45/46. After: the complete journey suite 130/130, including J6 idle behavior.
- Reviewed all 16 captured screens against the merged UI and refreshed `scripts/goldens.json`.
  No comparison threshold or finding suppression was changed.
- Repeat capture exposed a notification-fixture race: an empty store has no `.nf-list`, so the
  old driver silently skipped its fixture and alternated between empty and populated layouts.
  The driver now seeds a notification through the real API in its disposable browser profile
  before opening the panel, and fails explicitly if the list is absent. The executable regression
  checks empty/populated stores and refuses a broken renderer. Focused golden test: 38 assertions.

## Local behavior evidence

- Final code gate: `npm run test:fast` completed **721/721**, exit 0 (`fast-final.log`).
  The initial gate also completed 721/721; the final run includes the notification-fixture repair.
- Final `npm run golden` equivalent (`node scripts/golden.mjs`, isolated ports) passed all
  16 states with zero suppressions. Maximum signature difference was 0.31 against the unchanged
  1.5 threshold (`golden-verified.log`). All captures opened successfully and reported zero
  browser console messages/exceptions. Syntax, diff whitespace, and bug-register validation passed.
- Connectors/ABILITIES opened and settled in the focused capture and subsequent full captures.
  The original `f373c745` receipt was a layout-settle timeout, not a missing panel.
- The formerly failing `f72f7a1a` idle-bay assertion passed in the focused and complete live journeys.
  Neither ignored integration finding was edited from this worktree; the integration QA owner can
  reconcile them against fresh exact-candidate receipts after merging.
- Customer campaign: `npm run qa:customer-journeys` completed 26/26 suites, exit 0.
- `dev/email-support-live-proof.mjs` passed real INBOX create/readback, scheduling-off, stale-arm,
  lost-acknowledgement, missing-row and duplicate checks. After stopping the seed sidecar and restarting
  with `node dev/seed.js --keep`, exactly one `EMAIL ONCE PERSISTENCE` routine remained visible in
  Active Routines, with `runsLine:true` and `schedule.kind:once`.
- On that seeded station, three `_dbgLoseCanvases()` injections advanced the recovery count from
  0 to 3 and restored opaque cached pixels. `_dbgKillStageContext()` advanced stage rebuilds from
  0 to 1 and restored the visible frame. An independent 32x32 probe canvas saw 941–942 non-dark
  pixels out of 1024; the source drawing canvas was not read back directly. No uncaught browser
  exceptions occurred. This simulates loss effects; it is not a physical GPU reset or a 20-minute
  reproduction of the customer's affected station.
- Beginner Run passed the six-step UI-only path in 116181 ms. Its scope ends at the first real
  model boundary, not at a fabricated deliverable. It ran on the lane's `94bff3a5f` source snapshot.

Raw local logs are in this worktree: `journey-before.log`, `journey-after.log`,
`connectors-before.log`, `customer-gate.log`, `routine-before-restart.log`,
`routine-after-restart.log`, `canvas-live.log`, `beginner-gate.log`, and `golden-*.log`.
Browser captures are in `.uigolden/`; these ignored artifacts are not portable release stamps.

## Still required

The six customer P1 records remain open. These local passes do not establish their exact cause:

| Report | Evidence still needed |
| --- | --- |
| Managed Sonnet HTTP 400 | Production relay trace/error for the affected request and exact installer retest. `flyctl auth whoami` still reports no access token on this host. |
| Mac paid onboarding/relink | Physical Apple Silicon Mac, exact installer, account link/reload/recovery/restart receipt. Issue #2 is closed but has no reporter recovery confirmation. |
| Funded station zero-credit banner | Authoritative affected-account balance and UI/provider state captured together, then recovery/restart. |
| Blank viewport after 10–20 minutes | Affected installer, display scale/window dimensions, actual station, and renderer/GPU diagnostics. |
| Missing ONCE routine | Affected job id and save/list/restart diagnostics; the current local path passes. |
| Idle/high usage | Customer run ledger, provider/model, enabled background work, and expected cadence. No customer-specific billing defect has been established. |

After remaining merges, run Guardian and Beginner Run against the immutable final source,
build/install that candidate, and rerun installed smoke plus affected customer paths. A lane-green
receipt cannot replace `npm run qa:ready`; the six open P1 reports still block that verdict.
No production account, cloud deployment, support message, or public release was changed.

## Integration receipt

Merged into `feat/harness-backend` as `62770b1a9` from `94bff3a5f`, with an identical tracked
tree to the verified lane. Post-merge `npm run test:fast`: **721/721**, exit 0. Existing QA status
and Rooms handoff edits were preserved. Raw logs and screenshots were archived under
`.bugloops/release-blockers-0905-merge/` in the integration checkout before worktree cleanup.
