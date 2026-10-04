# Visual-Auditor loop (L6) — the 24/7 "SEE the rendered game and fix incoherence" loop

**Why this exists:** the game UI *is* the product, and every prior audit was text-based
(DOM/API/source) because `preview_screenshot` and `chrome --virtual-time-budget` both hang
on StarNet's always-animating canvas. Visual incoherence (overlap, clash, off-center,
unpolished, layers that don't complement) is invisible to text checks. `scripts/uishoot.mjs`
is the unlock: it drives headless Chrome over CDP and captures on a **fixed wall-clock wait**.

**Andrew's mandate:** he must NOT be the one who finds UI problems. This loop finds + fixes them.

---

## ▶ LAUNCH THIS LOOP (one command, dedicated local session)

Open a new Claude Code session **in this repo** (`C:\Users\<you>\Desktop\gen`) and run:

```
/loop  Run one Visual-Auditor cycle per scripts/VISUAL_AUDITOR.md: shoot every UI state
       against current trunk, READ each PNG, catalog incoherence (overlap / off-center /
       clash / disconnected / unpolished / untruthful), fix small cross-cutting issues in
       the live-polish worktree + re-shoot to confirm, route bigger ones to UI-SHELL or
       WORLD-GAME in SESSIONS.md. Self-pace; compare each run against the last to catch
       regressions a freshly-merged branch introduced.
```

No interval → the model self-paces (one cycle, judge, fix/route, then next). It needs the
**local app + vision**, so it must run on Andrew's machine — NOT a cloud routine. This is the
sibling of the **Overseer+** loop (L1, git/board) which runs in the orchestrator session.

---

## One cycle (what each loop iteration does)

1. **Capture every state** (auto-boots a SEEDED, pre-onboarded sidecar if none is up, so it
   lands on the live floor — NOT the title screen — and waits until it's verifiably in-game
   before shooting):
   ```
   SKYNET_SHOT_PORT=8930 SKYNET_SHOT_DIR=.uishots-trunk npm run shoot
   ```
   Output → `.uishots-trunk/*.png` (ingame, crew-*, work-*, build-*, sys-*) **plus a
   `manifest.json`** recording which selector opened each panel, frame sizes, the active screen,
   and any page console errors/exceptions. Exits NONZERO if a panel failed to open or the boot
   never reached the floor (CI/loop-grade). ~40s full sweep. The same engine backs the legacy
   `node scripts/uishoot.mjs --boot` (kept as an alias). One panel: `npm run shoot -- --only ingame`.
   (Pick a free `SKYNET_SHOT_PORT`/`SKYNET_CDP_PORT` so you don't collide with a dev sidecar
   another loop already booted.) Interactive/transition coverage:
   `node scripts/uiplay.mjs`, `node scripts/uiresidue.mjs`, `node scripts/uisummon.mjs`.

   > **Why seeded:** a raw `SKYNET_DEV=1 sidecar` has no agent → the page sits on the title
   > screen (`dev=false`), useless for UI testing. `npm run shoot` materializes the golden agent
   > fixture so the frontend auto-resumes onto the floor. A cold sidecar's *first* page load can
   > still flash the title screen transiently, so the shooter polls `window.__SKYNET_DEV__` +
   > `#screen-game.active` (reloading if needed) before capturing. Panels are driven by STABLE
   > `id`/`[data-term]` selectors (re-derived from `index.html`/`navdock.js`), not drifting text.

2. **Triage with golden diffing — read ONLY what changed (don't re-judge every frame each cycle):**
   ```
   npm run golden        # captures + diffs every state vs scripts/goldens.json
   ```
   - **Exit 0 (GOLDEN PASS)** → no frame moved beyond the animation-noise floor; there is nothing
     new to look at. Skip straight to the behavioral audit (step 3). This is the unattended path.
   - **Exit 3 (CHANGED)** → read ONLY the flagged frames listed in `.uigolden/golden-report.json`
     (a newly-merged branch changed them). Judge each against the incoherence rubric:
     - **Overlap** — panels/layers stacking so content is buried or competes.
     - **Off-center / dead space** — a lone panel shoved to a corner; >40% empty.
     - **Clash** — two paradigms fighting (translucent floating box next to a full-bleed
       overlay), inconsistent panel widths/chrome, bright live floor bleeding through text.
     - **Disconnected** — a panel that ignores its neighbors (COMMS lit + undimmed beside a modal).
     - **Unpolished** — truncation, misalignment, default/placeholder styling, jagged spacing.
     - **Truthfulness** — does any panel claim state the harness can't prove?
   - If a flagged change is a legitimate, coherent improvement → **re-bless** (`npm run golden:bless`)
     so it becomes the new baseline. If it's a regression → file + fix (step 4).

3. **Behavioral + truthfulness audit (auto, no eyeballing):**
   ```
   npm run audit         # PASS/FAIL: in-zone idle · gaze-only awareness · summon · place-prop=cap · HUD truthful
   ```
   Nonzero exit = a real behavioral/telemetry regression; the failing frame is in `.uiaudit/`.

4. **File + fix.** Append concrete findings to `SESSIONS.md` (state name + what's wrong + owning
   dept). Fix small/cross-cutting issues directly in the **live-polish** worktree and **re-verify**
   (`npm run golden` / `npm run audit` must go green — a verbal "fixed" counts for zero). Route
   larger structural fixes to UI-SHELL (panels/CSS) or WORLD-GAME (floor/canvas). Then **re-run**
   next cycle — golden diffing makes parallel-agent breakage (a recurring failure mode) visible.

## Baseline (known good — regression tripwires)
- **VA-1 FIXED + re-confirmed on trunk `a37b0e0`/`927b2fe` (pass 2, 06-22):** every `#terms`
  panel **centers when single** under a **deepened focus scrim**. If a future shot shows a
  `#terms` panel back in the top-left corner with a bright floor behind it → that fix regressed.
- Full-screen overlays (RECRUITMENT BAY incl. recruit/recipes/familiarity tabs, REFIT MODE)
  are the intended full-bleed paradigm — coherent.
- **Open residuals (routed, not yet fixed):** **VA-6** centered-modal sizing inconsistent
  (one modal-shell sizing authority → UI-SHELL); **VA-3** live floor animates behind text
  panels (freeze/blur canvas behind a modal → WORLD-GAME). See SESSIONS.md VISUAL-AUDIT pass 2.

## Coverage map
`scripts/COHERENCE_MATRIX.md` — every gamification layer × 3 overlap dimensions (V visual-
stacking / F functional-conflict / T transition-residue). Still to drive: place-a-prop (refit
canvas drag via CDP Input), a tool-using run with approval prompts + tool-logs, onboarding/
awakening (boot WITHOUT SKYNET_DEV), voice toggles, conveyor TEST belts, HUD/XP. Pairs with a
single UI design authority (VA-2) so new features pick the centered-modal OR full-bleed
paradigm instead of inventing a third.
