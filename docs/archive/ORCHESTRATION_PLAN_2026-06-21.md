# Skynet — Orchestration Plan (finish & polish before new features)

> Generated 2026-06-21 by the orchestrator session. Goal: land the 17 unmerged branches and
> polish what's already merged, using parallel Claude Code sessions **without collisions**.
> Mandate from Andrew: **finish/polish everything current before adding any new features.**

## Operating model (read first)

- **One session = one worktree = one branch.** Never run two sessions in the same folder.
  - Create:  `C:\Users\<you>\gen-trees\new-agent-tree.ps1 <name>`  → makes `C:\Users\<you>\gen-trees\<name>` on branch `agent/<name>`.
  - Sync:    `C:\Users\<you>\gen-trees\sync-agent-tree.ps1 <name>`  (rebase onto trunk before merge).
  - Remove:  `C:\Users\<you>\gen-trees\remove-agent-tree.ps1 <name> -DeleteBranch`.
  - Integration tree (trunk `feat/harness-backend`) = `C:\Users\<you>\Desktop\gen`. Do NOT feature-edit it directly.
- **Trunk is the serialization point.** Land **one branch into trunk at a time.** After each land,
  every other active lane runs `sync-agent-tree` (rebase) to absorb it. This turns the god-file
  overlap into small, resolvable rebases instead of a giant pile-up.
- **Green-before-merge.** `npm run test:fast` must pass in the worktree, AND the feature must be
  **verified live** (`npm start` → http://127.0.0.1:8787) before it lands. No "done" without watching it.
- **The full product is `npm start` (:8787), not `npm run serve`.**

## Collision map (which files force coordination)

| File | # branches | Implication |
| --- | --- | --- |
| `frontend/app/stationui.js` | 8 | The biggest hotspot — frontend lanes touching it must land sequentially. |
| `frontend/app/app.js` | 8 | Same. |
| `frontend/app/world.js` | 6 | Shared by recruit/camera/floor/workpipe. |
| `sidecar/index.js` | 5 | All backend lanes (api-hardening, oauth-telegram, cron-picker, floor-routes) touch it → sequence them. |
| `frontend/index.html`, `css/app.css`, `css/style.css` | 4–5 | UI lanes overlap here. |

**Takeaway:** truly-parallel work = lanes with *disjoint* files. The frontend UI branches are NOT
disjoint, so they go through a sequential queue. Backend branches share `sidecar/index.js`, so they
also sequence. Isolated lanes (Tauri/ship, skills) can run anytime alongside everything.

---

## TIER 0 — Triage first (do before spinning up feature lanes)

These are decisions, not builds. Several branches are duplicates/superseded — landing both would conflict.

| Decision | Resolution (confirmed 2026-06-21) |
| --- | --- |
| `recruit-fix` vs `recruitment-bay` | ✅ **RESOLVED — use `recruit-fix`.** `recruitment-bay` is a git *ancestor* of `recruit-fix` (fully contained). **Retire `recruitment-bay`** — zero loss. |
| `tutorial` vs `beginner-ux` | ✅ **RESOLVED — onboarding lane = `beginner-ux`.** `tutorial` is a git *ancestor* of `beginner-ux` (beginner-ux = all tutorial commits + "TERMINAL is real via WORKBENCH" + "prop→power legible/honest"). **Drop `tutorial` standalone** — zero loss. |
| `ui-polish` vs `design-system` | ✅ **Use `ui-polish`** (newer CRT-hardware look, 3 commits). `design-system` is divergent (not an ancestor) — an old single commit (type/spacing/color tokens + "earn the glow"). Frontend session: glance at design-system's diff, graft any useful tokens, **then** retire it. NOT a blind delete. |
| `cleanup` (31 files, spans sidecar core + tests + docs) | **Do NOT land wholesale.** Cherry-pick safe, still-relevant hunks or retire. High regression risk. |
| `cortex-memory` | Touches the **owned contract** `shared/events.js` (additive event). Verify it isn't already in trunk; if needed, apply via the contract-owner rules (additive only). |
| `camera` (world.js + render.js), `workpipe-b` (routing splitter) | Small deltas. Confirm not already superseded in trunk, then land late (after world.js settles). |

> **Baseline:** trunk `feat/harness-backend` @ `a177178` is **green** (`npm run test:fast` — all ~70 suites pass, lints OK) as of 2026-06-21. Start all lanes from here.

---

## TIER 1 — Parallel-safe lanes (start these NOW, simultaneously)

These touch disjoint domains and won't collide with each other or with the frontend queue.

### Lane: SHIP  (branch `agent/ship-rail`) — packaging/Tauri, fully isolated
- Files: `src-tauri/*`, `scripts/prepare-node.mjs`, `package.json`, `SHIP_CHECKLIST.md`, `.gitignore`.
- State: **unfinished** — one commit is tagged `[NEEDS BUILD-TEST]` (Node bundling never verified on a clean machine).
- Done = Node bundles, app launches on a machine with **no system Node**, fetch-timeout works, checklist green.

### Lane: SKILLS  (branch `agent/threejs-skill`) — `skills/` only, fully isolated
- 96 files vendored. **Decision first:** does this belong in-repo? If yes, land as-is; if not, trim/drop.
- Done = decision made + (landed cleanly OR retired with a note).

### Lane: BACKEND  (sequential within the lane) — `sidecar/*` + tests
- Order (all share `sidecar/index.js`, so one at a time, re-sync between):
  1. `agent/api-hardening` — launch-token + origin restriction (has tests; resolve trunk conflict).
  2. `agent/oauth-telegram` — Telegram channel for Codex OAuth.
  3. `agent/cron-agent-picker` — let cron use OAuth providers.
- Done per branch = conflict resolved, `test:fast` green, live-verified.

---

## TIER 2 — Frontend queue (sequential, ONE at a time, re-sync between)

All touch `stationui.js` / `app.js` / `index.html` / css. Land in this order:
1. `agent/ui-polish` (CRT hardware look; graft tokens from `design-system` then retire it).
2. `agent/beginner-ux` (onboarding + prop→power legibility; already contains `tutorial`).
3. `agent/recruit-fix` (retire `recruitment-bay`).
4. `agent/chat-resize` (chat panel sizing; keep the agent message readable at COMMS bottom).
5. `agent/floor-routes-inapp` (in-app work shows on the conveyor floor — kills a real "app lies" gap). Note: also touches `sidecar/index.js`, coordinate with BACKEND lane.
6. `agent/camera` (wheel-zoom/pan), `agent/workpipe-b` (routing splitter) — small, last.

---

## TIER 3 — Live polish pass (Axis-2 debt in already-merged features)

Separate from the branches: trunk itself has polish debt (the app "lies" in places per the 06-17 audit).
A dedicated session does a **feature-by-feature live walkthrough** (`npm start`), cataloging what's rough,
fake, or half-wired, and files/fixes them. Through-line: "make the one real loop visible, shrink what lies."

---

## Suggested concurrency (today)

Run up to **4 sessions in parallel** safely:
- **S1 = SHIP** (isolated)
- **S2 = SKILLS decision** (isolated)
- **S3 = BACKEND** (works its 3 branches in order)
- **S4 = FRONTEND queue** (works its branches in order)
- (**S5 = LIVE POLISH** optional, read-mostly until it picks targets)

The orchestrator session (this one) holds TIER 0 triage, keeps this plan updated, and is the **only**
one that merges branches into trunk (the serialization point), re-syncing the others after each land.

## Per-merge protocol (every branch)
1. `sync-agent-tree <name>` (rebase onto current trunk) → resolve conflicts in the worktree.
2. Finish/verify the feature; run `npm run test:fast` (must be green).
3. `npm start` → verify the feature live at :8787.
4. Orchestrator merges to trunk, runs the gate again on trunk, pushes.
5. All other lanes `sync-agent-tree` to absorb it.
