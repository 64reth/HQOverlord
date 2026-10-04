# StarNet release transition plan — 2026-09-05

This plan begins after `v0.10.13` and remains valid while the remaining UI lanes merge. The
candidate is not releasable until every exit criterion below is proved against one immutable
commit and, where required, the installed artifact built from that commit.

## Phase 1 — land runtime safety before UI freeze

- Merge the crash-loop containment repair: an uncaught fault immediately quiesces runs,
  schedulers, child processes, channels and connectors. The degraded process serves only the
  static recovery shell plus health/diagnostics; every other API and `/v1` request returns 503.
- Keep the workspace-owner claim while a crash loop is held. Releasing it would permit a second
  writer beside a faulted process.
- Required proof: process-fault unit coverage, real-socket crash-loop coverage, full fast gate,
  full HTTP gate and native `cargo check`.

## Phase 2 — remaining UI merge window

For each UI merge:

1. Preserve the source/website mirror when a mirrored frontend file changes.
2. Run the focused UI test plus `npm run test:fast` before merging.
3. Do not bless a screenshot merely because it changed. Capture the affected state, inspect it,
   and record whether the difference is intentional.
4. Defer the final complete golden refresh, Beginner Run, installer build and readiness verdict
   until the UI surface is frozen. Those receipts become stale after the next UI merge.
5. Keep backend/store/event changes out of a UI-only lane unless separately reviewed. The shared
   event and schema contracts remain owner-controlled and additive-only.

Before UI freeze, normalize the CRLF-heavy `frontend/app/spacebg.js` and its website mirror and
remove the extra EOF blank line in `test/voice-stream.test.js`. Do this after the visual lanes land
to avoid turning line-ending cleanup into merge conflicts.

## Phase 3 — immutable source candidate

Record one candidate SHA, then run in this order:

1. `npm run test:fast` — zero failures.
2. `npm run test:http` — zero failures/timeouts.
3. `npm run qa:customer-journeys` and `npm run qa:journeys` — complete pass.
4. `npm run qa:beginner` — exact candidate SHA.
5. `npm run shoot`, inspect every changed frame adaptive to the final UI, then run `npm run golden`.
6. `git diff --check v0.10.13..<candidate>` — zero whitespace errors.
7. `npm audit --omit=dev --audit-level=high` and native `cargo check` — green.
8. Run Guardian once with no concurrent port/build-heavy lanes. Any timeout must be reproduced or
   cleared with a second exact-SHA run; never dismiss a red cycle as merely flaky.

The fast suite now contains more than 730 asserting steps and exceeded its former ten-minute
wrapper while still progressing normally. Its wrapper budget is fifteen minutes; a timeout remains
a red gate, not a pass.

Only after those pass should the version be bumped consistently in `package.json`,
`src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`.

## Phase 4 — customer P1 closure matrix

Source simulations are corroboration, not closure. Keep each report independent:

| Report | Evidence required before closure |
| --- | --- |
| Managed Sonnet HTTP 400 | Exact supported model through the deployed relay, correlated local/relay/upstream request IDs, successful recovery on the candidate installer. |
| Mac paid onboarding/relink | Physical Apple Silicon Mac; link, reload, unlink/relink, quit and cold-start proof using the candidate installer and OS credential read-back. |
| Funded station zero warning | Service-observed affected-account balance and rendered banner captured together before/after a managed run and restart. |
| Viewport blank after idle | Candidate installer on the affected GPU/display conditions for at least the reported 10–20 minute window, with renderer recovery diagnostics. |
| Missing ONCE routine | Affected job/save receipt plus list and restart persistence; current local create/restart success is not historical recovery proof. |
| Idle/high usage | Customer run/cost ledger, provider/model and enabled background-work cadence; distinguish expected autonomy from unexplained spend. |

If exact customer evidence is unavailable, record the blocker and ship only with an explicit owner
risk decision; do not mark the report fixed.

## Phase 5 — artifact proof and rollout

1. Build the signed/notarized candidate from the immutable SHA. Record source SHA, tree hash,
   artifact hash, architecture and signing identity.
2. Upgrade an existing v0.10.13 Windows station without resetting its profile. Verify roster,
   routines, projects, connectors, settings and conversation continuity before and after restart.
3. Repeat the paid onboarding/relink path on physical Apple Silicon hardware.
4. Run the installed smoke and customer-critical journeys against the artifact, not a source server.
5. Require `npm run qa:ready` to report READY with no open P0/P1 records and exact-SHA receipts.
6. Roll out to a small canary first, retain the pre-update recovery snapshot, watch crash-loop,
   provider-error, balance and viewport telemetry, then expand only after the observation window.

## Stop-ship conditions

- Any faulted process accepts non-diagnostic work or writes.
- Any open P0/P1 finding or customer bug lacks an explicit owner disposition.
- Guardian, journeys, Beginner Run or installed smoke is red/stale/missing for the candidate SHA.
- Website mirror, version surfaces, artifact provenance or signing/notarization disagree.
- A UI golden changed without human review of the rendered frame.
