# Fable marching orders — 2026-07-03

> Written by the Fable orchestrator session as its final strategic act before its usage
> budget ran out. This is the **current order of battle**: what to build next, in what
> order, and why — each item written as a self-contained brief an Opus lane can execute
> without the orchestrator. Supersedes ORCHESTRATION_PLAN.md and the forward-looking parts
> of AUTONOMOUS_BUILD_PLAN.md (both are historical records now; their backlogs landed).
>
> **The one lesson that governs this doc:** audit claims go stale in hours. Before building
> ANY item below, grep trunk to confirm it is still open. If it's already shipped, mark it
> DONE here with the commit hash and move to the next item. (This exact failure — building
> from a stale plan doc — has burned this project repeatedly; see memory
> `full-release-polish-plan` and `starnet-strategic-audit-2026-07`.)

## Standing protocol (every lane, every item)

1. Invoke Skill `starnet-task-doctrine` before the first edit. It routes to the other laws.
2. One agent per worktree (`gen-trees\new-agent-tree.ps1 <name>`); never feature-edit the
   integration tree `C:\Users\<you>\Desktop\gen`.
3. Implementation agents run on **Opus** (Andrew's directive, memory `delegate-coding-to-opus`).
4. Green (`npm run test:fast`) + live-verified (starnet-verify) before merge; merge via
   `starnet-merge-ritual`. Update this doc's STATUS lines as items land.
5. Truthful telemetry law overrides everything: the app never asserts state the harness
   can't prove.

## Priority stack — why this order

The product thesis (memory `starnet-product-thesis`, `starnet-gtm-and-marketplace`) says the
moat is: beginners reach real value fast, the station is watchable/spectacular, and the
pride loop runs on REAL work. The harness core is solid and beats the reference harness on the moat axes.
What's between StarNet and users right now, in order: (0) trunk must be green, (1) shipped
builds can't update — distribution is broken, (2) the growth engine (spectacle/shareability)
has zero surface, (3) retention fast-follows, (4) breadth polish. That ordering is the
judgment call this doc encodes.

---

## P0 — Trunk green + humans-in-the-loop  ·  the "nothing else matters if this is red" tier

### P0.1 — Golden regression `crew-agents` (Guardian RED)  ·  STATUS: ✅ DONE 2026-07-03 (trunk `1b55ea31`)
Verdict: **stale golden, not a regression** — the 2026-07-02 console-shell modal redesign
(`82406347`…`b354bba5`) landed after the last baseline bless; 8 frames shifted together and
all render cleanly (verified via headless shoot). Baseline re-blessed (`1ff0e874` → merged
`c962d1be`), finding `b32814a0` closed (status `fixed`), test:fast + golden green on trunk,
Guardian open findings = 0.
**Residue → P0.1b:** ✅ DONE 2026-07-03 (trunk `dfeccd4`) — golden.mjs now consults the QA
ledger and treats frames whose fingerprint matches a dismissed/known finding as review-clean
(logged as excused, never silent); novel regressions still exit 3 and file findings
(test/golden.test.js, 21 assertions). Guardian row GREEN. Original residue text follows:
the Guardian row still reads RED solely because `golden.mjs` exits 3 on
`sys-rewind` — a pre-existing, already-`dismissed` animation-noise frame (finding `01c40465`,
the one modal that doesn't full-bleed over the animated CRT floor). Fix: make the golden gate
treat dismissed/known fingerprints as review-clean (or per-frame threshold) so a resolved
noisy frame can't pin the Guardian RED forever. A spawn-task chip for this exists.

### P0.2 — Andrew: the 15-minute human checklist  ·  STATUS: WAITING ON ANDREW
Nothing here is agent work; it is the accumulated "attended" debt, all of it quick:
- **Attended playtest** (~10 min, `npm start`) — ship-readiness gate 5, explicitly deferred.
- **Attended live-LLM beat checks** — two pending: First Pitch post-run beat
  (memory `starnet-first-pitch`) and first-ten awakening/interview beats
  (memory `first-ten-onboarding-rebuild`). Watch one real run each; file anything off as a
  qa/ledger finding.
- **Branch deletions** — the merged lane branches listed in memory `full-release-polish-plan`.

## P1 — Distribution: shipped builds must reach users and update  ·  the broken artery

### P1.1 — Decide + stand up the update host  ·  STATUS: OPEN (decision = Andrew, execution = lane)
Ground truth (memory `desktop-bundles-frontend-directly`): `updates.starnet.app` does NOT
resolve → the auto-updater has NEVER fired → every shipped install is frozen at its install
version (the 0.1.2→0.1.5 rescue needed a manual robocopy hot-patch). v0.1.3 is signed and
staged in `release/` waiting on this. Options, in Fable's recommended order:
1. **Host the manifest for real** (any static host + DNS for updates.starnet.app; the pinned
   config + `release/latest.json` already point at `/desktop/` there). Smallest change,
   unblocks the whole signed-update recipe that's already built.
2. If DNS/hosting is genuinely blocked: repoint `tauri.conf.json` updater endpoint at a host
   Andrew CAN stand up (GitHub Releases raw URL is the classic), re-sign, ship 0.1.4 as the
   last manual install. This is a config+rebuild lane task once Andrew picks the host.
Acceptance: a fresh 0.1.3 install detects and applies a 0.1.4 update unattended.

### P1.2 — Release kit: repeatable cut  ·  STATUS: OPEN
One script/doc path from trunk → signed installer + manifest + release notes, encoding the
gotchas already learned (E0463 ctor pre-build, `TAURI_SIGNING_PRIVATE_KEY` bare var, SAC
in-place-swap recipe). macOS build explicitly deferred until Windows distribution works.

## P2 — G5 Spectacle: the growth engine's first surface  ·  the moat item

### P2.1 — Postcard export  ·  STATUS: ✅ DONE 2026-07-03 (trunk `26669c4`) — ⎙ postcard button on the recap card (never claims the beat slot); in-page canvas composite of live #stage + VT323/phosphor overlay → PNG; every number a fold of real telemetry (Xp.compute + PrideStore), unprovable stats omitted (notably: NO per-run XP delta — XP only mints from user feedback, not run events); live-verified via scripts/verify-postcard.mjs; 42-assertion honesty test in test:fast
The GTM thesis says watchability = growth. Zero shareable surface exists today. Slice 1:
a **postcard** — one keypress/button on a completed run captures a styled frame (station
scene + run summary + trophy/XP delta) to PNG the user can drag anywhere. Reuse the capture
substrate the QA station already built (memory `self-test-station-charter`: cameras/capture
merged — do NOT rebuild), and the CRT window-chrome card language (memory `ui-premium-polish`).
Laws: canvas text VT323, honest data only (real run stats, never mocked), desk-only-specialist
prop rules untouched. Acceptance: a real run produces a postcard PNG whose numbers match the
run's actual telemetry, verified live.

### P2.2 — Clip export (stretch, after P2.1 lands)  ·  STATUS: OPEN
Short capture (GIF/webm, ~10s) of the floor during a run beat. Same substrate. Only start
once postcard is merged and Andrew has reacted to it — his reaction should steer format.

## P3 — Retention fast-follows  ·  small, already-designed, high leverage

### P3.1 — Re-summon signal  ·  STATUS: OPEN (fast-follow from memory `starnet-leveling-redesign`)
After a 👍-rated run, surface a lightweight "summon again" affordance tied to that agent +
recipe. One shared post-run beat slot law applies (memory `comms-beat-rules`).

### P3.2 — Crew-run rateability  ·  STATUS: OPEN (same source)
Crew/delegated runs currently can't be rated → they earn no XP signal. Extend the 👍/👌/👎
size-weighted XP path to crew runs, attributed honestly (lead vs workers per the G4
hero-scoped model).

### P3.3 — T4 balance pass  ·  STATUS: VERIFY FIRST (memory `growth-loop-audit-and-plan` says "in flight" as of 2026-07-02)
Check whether the T4 lane landed. If its worktree/branch is stale, salvage or restart small.

## P4 — Breadth (only when P0–P3 are moving)

- **P1-7 settings export/import + P2 settings sweep** (memory `settings-surface-gap-audit-2026-07`).
- **Meeseeks swarm frontend sprite layer** — backend `team.spawn` merged, sprites never
  started (memory `meeseeks-swarm`). Spectacle-adjacent; pairs well after P2.1.
- **Visual Auditor** remains eyes-required by design; do not try to automate it headless
  (canvas screenshots time out — memory `preview-verify-worktree-frontend`).

---

## Progress log
- 2026-07-03 — Doc created by Fable final session. P0.1 dispatched to an Opus background lane.
