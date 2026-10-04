# World and interface merge readiness — September 6, 2026

Branch: `agent/world-visual-audit-0904`. Tested source candidate:
`03f098895e8a428954dc6f555ecb0f945e6f1ada`, including trunk
`948557c628407539854e8f8347eb38964a46d61b`. Prepared in the isolated worktree;
not merged into integration and not an installed-build or release-readiness claim.

## Reconciliation

- Retained the updated Commander achievement progression inside the refined header.
- Combined session attention with the newer category filters and grouped automation history.
  Attention mode keeps every pending session individually reachable across categories and archives.
- Preserved the newer Extensions interface and scoped styling from trunk.
- Removed the suspended pendant render pass and obsolete `hang` lamp metadata. Room light
  sources, light pools, interior masks, shadows, and wall-mounted fixtures remain.
- Regenerated website mirrors and source verification fingerprints. No changes to shared contracts.

## Verification

- Final candidate: full fast list, **723 steps passed**, exit 0. Ran through the repository's
  timeout wrapper with a 20-minute allowance: `npm run test:fast:raw`.
- HTTP gate: **100 steps passed**, exit 0, on `cf1b995da37f8e60596b28c337afc8446d4ec88d`.
  The subsequent sync changed only the Extensions frontend, CSS, their mirrors, and the
  source verification ledger; `sidecar` and `shared` are unchanged between that candidate
  and the final source candidate.
- Live disposable-server probes: header instruments **34**, session attention **33**,
  prop abilities **36**, conveyor setup **46** — **149 checks passed**, no runtime exceptions.
  These ran before the final Extensions-only sync. Reloaded and visually inspected the
  final candidate in the in-app browser; station, header, rail, and COMMS rendered online.
- Live custom-world capture: **74 light sources**, **144 props**, active light canvas,
  no browser exceptions, and no suspended pendant hardware in the command-room close-up.
  The saved station matches its pre-restart backup. Demo runs with `dev/seed.js --keep`.
- Clean merge-tree check against the recorded trunk; trunk is an ancestor of the candidate.

Local ignored evidence: `.worldshots/merge-readiness/` contains `current-fast.log`,
`current-fast-result.json`, `http-final.log`, `gates-result.json`, `world-proof.json`,
and `station-without-pendants.png`. Individual live reports are in
`.worldshots/{header-instruments,session-attention,prop-abilities,workflow-setup}/report.json`.

Preview: `http://127.0.0.1:9177/` in this worktree. No provider run or paid-model behavior is
claimed by these UI checks. Integration must still perform its serialized merge and gate.

## Subsequent session-filter correction

User review removed the CHATS category. Source commit `1834b3ae0` now offers only ALL and
AUTOMATED, makes AUTOMATED strictly automation-only, and falls back to ALL for a saved retired
CHATS preference. Verification fingerprint commit: `cd71e5ac5`.

This correction passed the full `npm run test:fast` gate (**723 steps**, exit 0) and the updated
session-attention live probe (**36 checks**, zero runtime exceptions). The live custom preview
also confirmed AUTOMATED excludes ordinary sessions and ALL restores them. Evidence is in
`.worldshots/merge-readiness/session-filter-{fast,live}.log` and the corresponding result JSON
files. No backend code changed, so the earlier HTTP receipt remains applicable.

## Integration completed

Merged into `feat/harness-backend` at `fb22656bed4ceb905650af760800de4f0d897f74`.
The final version includes the Google sign-in and release-audit repairs from current trunk,
plus the user's final session-spacing correction: 2px list gaps, no stacked vertical margins,
and 5px vertical row padding. The compact list was visually verified in the custom live preview.

The frozen combined source `351c50ccc` passed **724/724** fast steps before integration;
the merged commit passed **724/724** again on trunk. The full HTTP suite passed **101/101**
on `5ecf07507`, whose backend bytes are identical to the merged version. The updated session
live probe passed **36 checks** with no runtime exceptions after the spacing adjustment.
Only documentation changed between the frozen source and its integration candidate.

Receipts: `.worldshots/merge-readiness/frozen-world-fast.log`, `integrated-world-fast.log`,
`merge-candidate-http.log`, their result JSON files, and `merge-spacing-live.log`.
Unrelated integration-tree QA notes and the Rooms handoff were preserved. The preview worktree
is retained for the custom station at `http://127.0.0.1:9177/`. This is source integration;
no installed release or publication is claimed.
