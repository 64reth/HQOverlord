# GATE — per-workstream COMMS channels (handoff)

Branch: `agent/comms-channels`. This is the v1 GATE from [WARROOM_BUILD_PLAN.md](WARROOM_BUILD_PLAN.md) —
the chat.js single-agent refactor that everything per-agent depends on. **Slices 1 + 2 done.**

## What landed on this branch

### Slice 1 — the per-workstream model
- **`frontend/app/channels.js`** — a pure, DOM-free, UMD model (sibling of `workstreams.js`) that owns
  **per-workstream transient run-state**: `busy`, `runId`, in-flight `acc`, `tools[]`, live `pending` consent.
  Keyed by **workstreamId** (NOT agentId — many workstreams share `agentId:'agent'`). History is NOT
  duplicated here; it stays in `Workstreams`. Tracks `composeTargetId`, decoupled from camera/selection.
- **`frontend/app/chat.js`** keeps all run-state in `Channels`; `send()` gates per-stream;
  `permissionRow(p, ws)` routes consent to that stream's runId; **`abort()` cancels EVERY in-flight run**
  (fixed a latent DISCONNECT bug that only killed one).
- **`frontend/index.html`** loads `channels.js` before `chat.js`.
- **`test/channels.test.js`** (in `test:fast`) — 37 assertions locking the model.

### Slice 2 — switching streams mid-run actually works end-to-end
- **Lifted the "can't switch while busy" guards** so you can switch/open/assign streams during a run:
  - `frontend/app/app.js` — `switchWorkstream()` and `newWorkstream()` (removed `if (Chat.isBusy()) return`).
  - `frontend/app/stationui.js` — `openStream()` and `assignTask()` (same).
- **Live token re-bind on switch** — `chat.js` now keeps a module-level `activeLiveRow` (the streaming row
  for the DISPLAYED stream) that `replayChannel()` **rebinds** when you switch *to* a still-running stream,
  so new tokens flow into the re-rendered row. Every DOM/World write in the run is gated by **`isActiveWs(ws)`**
  so a backgrounded run never writes into the displayed stream's log or moves the world view.

> ⚠ **Cross-file note for frontend-hud:** slice 2 edited `app.js` + `stationui.js` (the switch guards) here on
> `agent/comms-channels`, because lifting them is the gate's defining behavior. They are tiny, surgical removals —
> **rebase onto this branch, don't re-do them.** The conflict matrix still holds for all OTHER `app.js`/`stationui.js` work.

## Verified
- `node test/channels.test.js` → 37 assertions OK; **full `npm run test:fast` green** (incl. lint-emits, lint-determinism).
- `node --check` on chat.js / app.js / stationui.js; **browser boot clean** (no console errors).
- **Browser model-free smoke (slice 1):** two workstreams hold concurrent isolated run-state (separate acc/runId/pending; ending one leaves the other busy).
- **Browser DOM smoke (slice 2):** displaying a mid-run stream re-renders history + tool line + partial reply **with a live caret** + pending approval **with all 4 consent buttons**; compose target set to the displayed stream.
- No `shared/events.js` change — the gate is additive (model + DOM only).

## NOT yet done
- **Live multi-run streaming with a real key** — concurrent runs actually streaming tokens into background
  channels, and switching mid-stream to watch one resume, needs a BYOK model key to exercise end-to-end. The
  structure is proven model-free + DOM-level; this is the live confirmation.
- **(Out of scope for the gate, tracked elsewhere)** the war-room surfaces that now become honest on top of this:
  multi-slot attention queue, true per-agent crew dots, per-agent spend. See WARROOM_BUILD_PLAN.md.

## Contract notes
- `composeTargetId` is a **workstreamId**, decoupled from camera/selection (war-room D2).
- The live `AbortController` stays in chat.js (`aborters` Map) — not serializable, so it can't live in the pure
  model; `Channels` holds the `runId` for `Harness.cancel`.
- `isActiveWs(ws)` is the single guard that keeps a backgrounded run from writing into the displayed stream.
