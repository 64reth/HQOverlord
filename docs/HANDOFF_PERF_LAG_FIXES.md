# HANDOFF — perf-lag fixes (2026-08-26)

## The report
Andrew: StarNet turns laggy after ~5–10 min of runtime and after minimize/restore; an app
restart clears it. Confirmed present in the SHIPPED builds — the trigger commit `57112a690`
is inside both the v0.10.10 and v0.10.11 tags, and both tags are pushed (the train fired).

## Root causes (four, all real, all fixed)
1. **Visible-canvas readback → software raster (the minimize/restore shape).** The stage
   context-loss watchdog (`stageWentBlank`) and the bake watchdog read a 1×1 `getImageData`
   from the VISIBLE stage / bake plate 4×/s. Chromium counts readbacks per canvas and after
   enough of them silently drops that canvas to CPU rasterization — app-wide lag that builds
   over minutes and resets only on relaunch.
2. **Listener leak per stage rebuild.** `wireStageInput()` (re-run by every GPU-reset
   `rebuildStage()`) bound a `document` visibilitychange + `window` focus pair with no
   removal — one leaked pair per rebuild, forever.
3. **O(n²) COMMS streaming.** `chat.js plain()` re-parsed and rebuilt the ENTIRE accumulated
   markdown paragraph on EVERY streamed token — quadratic per answer, the "gets worse the
   longer it streams" mechanism.
4. **Unpruned transcript DOM.** `HISTORY_CAP` bounds only the wire payload; the rendered
   `#chat-log` grew all session, and per-token `autoscroll()` forces a layout of the whole
   transcript — a multiplier on (3).

## The fixes (merged to trunk `f7787dcec`, ff from snapshot `776bc01c1`)
- `frontend/app/world.js` — **THE READBACK LAW**: both sentinels now blit their one pixel
  into a dedicated 1×1 `willReadFrequently` probe canvas (`readAlpha1`, `'copy'`
  compositing) and read THAT; detection semantics unchanged (a dead/zeroed source blits
  transparent). The visibilitychange/focus probe re-arm pair moved into `init()`'s
  `listenersBound` one-time block; `wireStageInput()` is now cv-only.
- `frontend/app/chat.js` — `plain()` accumulates `raw` per token but renders + autoscrolls
  at most once per animation frame (`queueProse`/`flushProse`); synchronous flush at
  `closeSeg`/`error`/`cleanTaskIntent` and on hidden tabs, so nothing is ever lost or
  reordered. `LOG_DOM_CAP = 400`: `row()` prunes the oldest transcript rows past the cap,
  only while `stick` (Commander at bottom), halting at the live `#comms-presence` card.
- **New ratchets** (regression locks): `test/canvas-loss-recovery.test.js` forbids any
  world.js `getImageData` not on `sentinelCtx|pctx|_warpCtx`; `test/stage-context-loss.test.js`
  forbids any non-`cv` `addEventListener` inside `wireStageInput`.
- `website/app` mirror synced; claims re-locked (`5a2857053`, PASS · 211 surface files).

## Proof
- Gates: `test:fast` **689/689 GREEN** in the lane worktree AND on trunk post-merge.
- Live (`dev/perf-lag-verify.mjs` — boots a seeded sidecar + mock OpenRouter + headless CDP):
  - healthy baseline: sentinel armed, 0 rebuilds, 0 bake-recovery warnings → the new probe
    path reads truthfully (no false-positive heal loop);
  - `_dbgKillStageContext()` → 1 rebuild, `deadSince 0` (cure proven by a healthy read),
    mid-frame pixel sweep repainting;
  - streamed markdown turn arrives complete + parsed (bold/link/bullets), caret gone;
  - transcript padded to 525 rows → pruned to 401 on the next real turn, newest row intact;
  - 0 console errors.

## NOT verified / open
- The multi-minute de-acceleration itself — only a long real session can feel it gone.
  **Andrew: run the station 15+ min, minimize/restore a few times, confirm.**
- **Not shipped.** Trunk only. Users get it at the next cut (**v0.10.12**) — the v0.10.11
  checklist in `docs/HANDOFF_V01011_UPDATE_READINESS.md` applies (claims re-lock is already
  done for this surface; re-earn gates at the exact cut SHA as always).
- The Explore sweep cleared everything else (all setInterval sites guarded, world.js
  collections capped/swept, spacebg/asciifx/widgets/stationui/channels clean) — no second
  wave expected, but if lag persists after this ships, profile before assuming.

## Standing laws minted (memory: `stage-heartbeat-readback-lag.md`)
- **Never `getImageData` a canvas the frame loop draws** — read through a
  `willReadFrequently` probe canvas.
- **`wireStageInput` may only bind `cv`** — document/window listeners belong in the
  one-time `listenersBound` block.
- A per-token DOM render against an accumulating string is O(n²) — coalesce per rAF.
