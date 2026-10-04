# Field Manual refresh — 2026-09-06

Owner request: replace the outdated, confusing manual with something closer to a
classic video-game handbook. Lane: `agent/field-manual-0906`, based on `824bdfcea`.

The in-app SYSTEM → FIELD MANUAL now has seven numbered chapters: First Mission,
Controls, Crew, Gear, Lines, Progress, and Help. It teaches a small first job,
shows the work cycle and station menus, supplies REFIT keycaps and practice
exercises, and links directly to the appropriate existing panels. Navigation
keeps keyboard focus and accessible selected state aligned. Layout adapts to
narrow panels. The optional quick tour remains available.

Content follows the current source: eight equipment capability families including
images and Spotify; click-machine-to-machine belt creation; LAYOUTS on key 9;
shared equipment; model ownership; COMMS sessions versus planned board tasks;
per-agent voice settings; goals versus completed plans; and host-wide Full Power.
Sample crates are explicitly distinguished from real completed jobs. The website
app mirror was regenerated using `npm run sync:website` (three changed files).

## Verification

- `node --check` passed for the changed tutorial and the live proof script.
- `field-manual-accessibility.test.js`: 3 assertions passed.
- `permissions.test.js`: 76 assertions passed, including corrected Full Power copy expectations.
- `website-app-sync.test.js`: 8 assertions passed.
- `node dev/field-manual-proof.mjs`: passed against the real seeded sidecar on :9216.
  All seven chapter selections, accessible state, focus retention, Tab navigation,
  previous/next navigation, nine destination shortcuts, and quick-tour replay passed.
  Every chapter fit 360px and 600px panel widths without horizontal overflow.
  No native-white manual buttons, browser warnings, or exceptions were observed.
- Receipt and screenshot: `dev/.scratch-workspace/manual-proof/receipt.json` and
  `first-mission.png` in the retained worktree. Re-run with `MANUAL_PORT` if needed.
- `npm run test:fast`: all 725 steps green, exit 0. Log: `dev/field-manual-fast.log`.

Additional directly invoked check: `onboarding-legibility.test.js` reports one
pre-existing failure, expecting the old TASKS subtitle "planned work — queued,
active & shipped". The unchanged integration tree reproduces the same failure.
Its remaining 53 assertions pass. That test is not in `test/fast.list`.

This is source-app UI proof. The preview uses a keyless dev seed; no provider job,
installed executable, public website deployment, or release readiness is claimed.

## Integration

Merged into `feat/harness-backend` as `7ea95ab5b`; the combined release-surface
inventory was re-locked in `fb71dd838` after a concurrent catalog-header lane
advanced trunk. The final merged tree passed `npm run test:fast`: 725/725 steps,
exit 0. Existing uncommitted `qa/STATUS.md` and Rooms handoff content remained
outside both commits. No installed-app or public-deployment verification was run.
