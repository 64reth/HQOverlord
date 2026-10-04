# Living War-Room — Build Plan

> The plan for turning the **Living War-Room** UI direction (prototyped in
> [`design/mockups/warroom-mockup.html`](../design/mockups/warroom-mockup.html))
> into the real, honest harness UI. Written to be **parcelled out to multiple
> agents/worktrees** — each workstream maps to one `agent/<name>` branch.
> **Read [`CLAUDE.md`](../CLAUDE.md) first; the worktree no-clobber rules are non-negotiable.**
>
> Every code reference below was verified against source on the `feat/harness-backend`
> trunk. Before acting on the worktree map, re-run the **PRE-FLIGHT** (§ below) — the live
> registry moves.

---

## North star

> The world is the soul and stays the hero on screen by default; every control
> either lives believably in that world or sits in a fixed, predictable place —
> **and no feature may promise multi-agent that the per-agent data model can't
> actually deliver.**

## The one ruthless rule (apply to every pixel)

**Does this pixel assert something the harness can't yet prove true?**
If yes → wire it to real state, or don't draw it. (This is the UI form of the
project's "truthful telemetry" constitution: real spend, real tool-activity, real
consent — no fakery.)

### Five places the mockup currently violates it (fix, don't ship)
1. **Crew dots show one global activity on every row** — `stationui.js` `crewTick()`
   (~L149) writes the same `crewStatus(act)` (L67) to every agent → a fake "instrument cluster."
2. **Single-slot approval** silently drops approvals #2–9 (invisible loss).
3. **Desk screen** cycles fake green hues; **belts** sell "task flow" that doesn't exist.
4. **N identical wanderers** dressed as live agents before per-agent run-state exists.
5. **A spend _readout_** (`#gt-cost`) masquerading as control when there is no real _cap_.

---

## Verified ground truth (the code as it actually is today)

| Claim | Evidence (verified) |
| --- | --- |
| COMMS is structurally **single-agent** | `frontend/app/chat.js` — `log`/`input` declared L8, `activeWs`/`busy` L9, `currentAbort`/`currentRunId` L11. One global `busy` gate (declared L9, enforced in `send()` at L134 `if (busy) return;`). `load()` does `log.innerHTML=''` (L33) → switching streams wipes the DOM and two runs can't coexist. **History is NOT global** — it lives per-workstream in `Workstreams` (`workstreams.js` history; `chat.js:32` reads `activeWs.history`). |
| **No off-switch** | `sidecar/index.js`: `POST /api/cancel` (L247) cancels ONE run by id. There is **no halt-all** and **no `GET /api/runs`** (router L246-256; `/api/run`, `/api/consent`, `/api/file` also exist). |
| Budget cap is **hard-coded + invisible** | `sidecar/index.js:36` — `CAPS = { … maxCostUsd: 1.00 … }` per run; no session ceiling; not user-settable. Enforced per-run in `loop.js:131` (`if (spentUsd >= maxCostUsd) return end('budget')`). Session work lives in `index.js` (CAPS L36, runOnce limits L477), **not** `loop.js`. |
| **"Full access" = silent YOLO** | `sidecar/index.js:98` `grantsBlanketByAgent`; `permissions.js:122` **adds** `'*'`, `:75` **reads** it → allows every danger class until restart, no revoke UI. |
| A consent TTL **already exists** | `sidecar/index.js:37` `CONSENT_TIMEOUT_MS = 120000`; L343 `setTimeout(() => finish('deny'), …)` already auto-denies an unanswered prompt after 120s. **Do not re-implement it** — surface it + record the auto-deny. |
| **Zero reduced-motion support** | no `prefers-reduced-motion` anywhere in the repo. |
| Consent sound is **not distinct** | `frontend/js/audio.js:212` (`memory.write`) and `:214` (`permission.prompt`) both fire the same `SFX.chime()`. The synth subscribes to `permission.prompt`, `agent.run.error`, `budget.threshold`, `deliverable` — built + event-wired, just non-distinct. |
| **No reactor gauge exists** | The reactor gauge is **mockup-only**. The real top bar shows `SPEND` via `#gt-cost` (`index.html:80`, updated `app.js:22`). Bind to `#gt-cost` — or to a NEW `#reactor` element only if the HUD owner ships one (see map). |
| **Test gate is strict** | `npm run test:fast` runs `test/lint-emits.js` (hard-fails any `emit()` of an **unregistered** event name) and `test/lint-determinism.js` (fails ambient `Date.now()`/`Math.random()` in `shared/` + `sidecar/` — use the injected clock/rng). Plan around both. |

---

## PRE-FLIGHT — reconcile with the LIVE registry (do this BEFORE spawning anything)

The biggest risk here is not design — it's **clobbering live, unmerged work**. Re-run
these every time before parcelling:

```
git worktree list
git branch --no-merged feat/harness-backend
git diff --name-only $(git merge-base feat/harness-backend agent/<x>)..agent/<x>
```

**Snapshot at time of writing** — 15 active worktrees; **unmerged into trunk:**
`agent/camera`, `agent/design-system`, `agent/onboarding`, `agent/voice`,
`agent/workpipe-b`. Verified file ownership of the ones that collide with this plan:

| Unmerged / live branch | Touches (real files) | Collides with our… |
| --- | --- | --- |
| **`agent/voice`** | `frontend/app/chat.js`, `app/app.js`, `css/app.css`, `index.html`, `app/world.js`, `sidecar/index.js` | **the GATE (chat.js!)**, shell, safety-sidecar |
| **`agent/design-system`** | `frontend/css/app.css`, `css/style.css`, `index.html` | a11y-floor, shell |
| **`agent/camera`** | `frontend/app/world.js`, `js/render.js` | shell / desk-monitor |
| **`agent/onboarding`** | `frontend/app/onboarding.js`, `app/world.js`, `js/util.js` | first-run, shell |
| **`agent/workpipe-b`** | `sidecar/index.js`, `sidecar/channels/hub.js`, `package.json` | safety-sidecar, HALT-reaches-hub |
| **`agent/audio`** (MERGED `c149c38`) | `frontend/js/audio.js` | a11y distinct-cue (coordinate, don't clobber) |
| **`agent/messaging-hub`**, **`agent/notebook-consent`** (live) | `sidecar/index.js`, `sidecar/channels/hub.js` | safety-sidecar |
| **`agent/frontend-hud`** (live) | the HUD/shell — **the natural owner of war-room UI** | use it; don't invent a parallel shell |

**Mandatory pre-flight actions:**
1. **Land or freeze the gate-file owners first.** `agent/voice` owns `chat.js`; the GATE
   refactor **cannot start** until voice is merged to trunk **or** explicitly frozen and the
   GATE rebases on top. Same for `agent/design-system` (css/index.html) before any UI re-skin,
   and `agent/camera`/`agent/onboarding` (world.js) before desk-monitor work.
2. **Prefer existing worktrees.** Do the HUD/shell/queue/deliverables UI inside
   `agent/frontend-hud`, not a new colliding name.
3. **`sidecar/index.js` is co-occupied by four** (voice, workpipe-b, messaging-hub,
   notebook-consent). The safety-sidecar work must be coordinated with the current
   occupants — one owner per wave, or serialize.
4. **`frontend/js/audio.js` is already merged** (agent/audio) — the distinct-cue change is a
   coordinated edit, not a fresh claim.

---

## File-level conflict matrix (serialize every shared file to ONE owner per wave)

| Real file | v1 owner (this plan) | Already in-flight (must reconcile) |
| --- | --- | --- |
| `frontend/app/chat.js` | **comms-channels** (the GATE) | `agent/voice` ⚠ land/freeze first |
| `frontend/app/app.js` | **frontend-hud** (wiring) | `agent/voice` |
| `frontend/app/stationui.js` | **frontend-hud** (owns `crewTick`/`crewStatus`) | — (others REQUEST hooks) |
| `frontend/app/workstreams.js` | *(Workstreams owner)* — read-only for us | — |
| `frontend/index.html` | **frontend-hud** (structural markup) | `agent/design-system`, `agent/voice` |
| `frontend/css/app.css` | **frontend-hud** (shared layout, fenced blocks) | `agent/design-system`, `agent/voice` |
| `frontend/css/style.css` | **a11y-floor** (sole owner of reduced-motion + tokens) | `agent/design-system` |
| `frontend/app/world.js` | **frontend-hud** (desk-monitor) | `agent/camera`, `agent/onboarding`, `agent/voice` |
| `frontend/js/audio.js` | **a11y-floor** (distinct cue) | `agent/audio` (MERGED) — coordinate |
| `sidecar/index.js` | **safety-sidecar** (halt/budget/grants/runs) | voice, workpipe-b, messaging-hub, notebook-consent |
| `sidecar/channels/hub.js` | **safety-sidecar** (HALT reaches hub runs) | workpipe-b, messaging-hub |
| **NEW** `frontend/app/halt.js`, `queue.js`, `deliverables.js` | safety-ui / attention-queue / deliverables | — (new files = no collision) |

**Rule:** UI workstreams that aren't the file's owner ship their JS in a **new file** and
**append only a fenced per-workstream CSS block**; they **request** DOM hooks (ids/classes)
from the owner rather than editing the owner's markup. **No two workstreams edit `index.html`
or `app.css` in the same wave.**

---

## Phase 0 — Decisions to LOCK on paper (cheap now, expensive to retrofit)

### D1 — Attention model = a CLIENT-SIDE PROJECTION over existing events (not a new envelope)
The Attention Queue / NOTIFS digest / audit are **three views of the existing distinct
events** — do **not** invent a unified `emit('attention.item', …)` envelope (it would fail
`lint-emits.js`). The client projects over what already fires:

| Existing event (registered in `shared/events.js`) | Attention type |
| --- | --- |
| `permission.prompt` `{promptId,agentId,tool,scope,argsSummary}` | approval |
| `agent.run.error` | error |
| run stop with `endReason` (`max_iters`→"say continue", `budget`, `cancelled`) | stall |
| `deliverable` `{title,kind,agentId}` | completion |
| `budget.threshold` `{scope}` | budget |

- The **client** synthesizes the queue row's transient `id`/`t` (UI-only, never emitted).
- The queue/digest/audit differ only by **time-horizon filter** (unresolved-blocking /
  recently-resolved / append-only history), over the **same** projected list.
- **Reconcile vocab to reality:** the consent decision values are
  `once | session | always | deny` (`events.js` `permission.response.decision`), **but the
  UI/sidecar currently use `full`** (`chat.js:103` `mk('Full access','full')`,
  `permissions.js:122`). This mismatch is real — see D4.

### D2 — Compose-target decoupled from camera/selection; keyboard locked
- `cameraAgentId` — who the camera looks at. `composeTargetId` — **who COMMS posts to**.
  `composeTargetId` is a **workstreamId**, *not* an agentId (multiple workstreams can share
  `agentId:'agent'`, `workstreams.js:51`).
- Selecting an agent/workstream in the rail sets **both**. **Attention jumps move only the camera.**
- **Locked keys (verify each is not intercepted in the target Windows browser tab):**
  - **Select agent:** `1`–`9` when the COMMS input is **unfocused**; `Alt+1`–`Alt+9` always.
    (**Not** `Ctrl+1..9` — those are browser tab-switch accelerators.)
  - **Jump to next attention item (any type):** `Alt+A` — **this is its only meaning**
    (the old "Alt+A = next agent" is dropped; selection is the number keys).
  - **HALT ALL (E-STOP):** **`Alt+H`** (locked, not "e.g."). Always-visible button is primary.
  - `agent/camera` (unmerged) may bind world.js keys — reconcile precedence after it lands.

### D3 — "Full access" grant must be inspectable + revocable
Per-agent grant store exists (`grantsBlanketByAgent`, `index.js:98`). Add `GET /api/grants?agent=`
+ `POST /api/revoke-grants?agent=` + a UI grant inspector (what's granted, one-click revoke).

### D4 — Additive `shared/events.js` changes land FIRST (owned by cortex-memory, additive-only)
`lint-emits.js` fails any unregistered emit, and `schema.validate()` rejects out-of-enum
values. **Before any emitting workstream starts**, the shared-contract owner lands:
1. add **`full`** to `permission.response.decision` enum (UI/sidecar already use it);
2. add **`session`** to `budget.threshold.scope` enum **iff** a session-cap event is emitted;
3. **emit `permission.response`** from sidecar `handleConsent` on human answer **and** on
   auto-deny (it's registered but emitted **nowhere** today — the audio re-arm and the audit
   resolution signal both need it);
4. any net-new event required by the safety work (e.g. a HALT broadcast), defined concretely.
Request these from the owner; **do not edit `shared/events.js`/`schema.js` in your worktree.**

---

## The GATE — `chat.js` → per-(workstream) channels  *(blocked on `agent/voice` landing)*

**Sequence STRICTLY FIRST among the per-agent-visual work.** Everything per-agent-visual is
theater until it lands.

- The channel owns **only transient run-state** — `busy`, `currentRunId`, `currentAbort`, the
  in-flight stream handle, and `pendingApproval — keyed **per-workstream**. **History stays in
  `Workstreams` — do NOT duplicate it.**
- Selecting a workstream **re-attaches** to its live channel (re-render from channel + its
  `Workstreams` history) instead of the `log.innerHTML=''` wipe (`chat.js:33`).
- Implement the **D2 compose-target** here (`composeTargetId` = workstreamId).
- **Acceptance:** two workstreams run concurrently; switching away and back leaves the first's
  stream + pending approval intact; a backgrounded run's approval stays visible/actionable;
  `test:fast` green.

---

## Parallel track A — Safety floor (refactor-INDEPENDENT; ship on today's app)

### A — E-STOP / HALT ALL (`Alt+H` + always-visible button)
- **sidecar:** `POST /api/halt` → abort **every** run.
  ⚠ **Scope trap (verified):** the `runs` Map (`index.js:47`) is populated **only** by the browser
  `/api/run` path (`handleRun` `runs.set` L314; cleaned up L317/L360). `runOnce` — the shared run
  host (L375) — **never touches `runs` itself**; the *caller* owns the abort signal (per the L368-374
  contract). The messaging hub drives `runOnce` from `sidecar/channels/hub.js` with its **own**
  AbortController, so hub/autonomous (Telegram) runs are **not** in `runs`. A `/api/halt` that iterates
  `runs` would silently miss them — coordinate with the messaging-hub owner to register **every**
  AbortController (browser + hub) in one kill-set, or Telegram runs survive the E-STOP.
- **ui (frontend-hud / safety-ui):** the `Alt+H` handler + a red **HALT ALL** control in the top
  bar (replace the mockup's `alert()`-wired `⏏ DISC`).

### B — Real, persisted budget cap + grant revoke
- **sidecar:** session ceiling in the run host (`index.js`, CAPS L36 / runOnce limits L477):
  `maxCostUsd = min(perRun, remainingSessionBudget)`; track process-wide `spentSession`;
  **refuse to START** a run that would breach it. Add `GET /api/grants` + `POST /api/revoke-grants`.
  **Decide persistence:** `spentSession` is in-memory and resets on sidecar restart (like
  `grantsBlanketByAgent`) — state whether the cap survives a crash and where it persists, so it
  doesn't conflict with §C rehydration.
- **ui:** the cap is **user-settable + persisted** (the ruthless rule demands a real cap, not a
  readout — `CAPS.maxCostUsd` is hard-coded at `index.js:36`). Bind the **`#gt-cost` SPEND
  readout** (`index.html:80`/`app.js:22`) to fraction-of-(session)-cap; amber → red band near cap
  → auto-pause-new-runs + alarm at 100%. *(If the HUD owner ships a new `#reactor` element,
  safety-ui depends on that element existing first — it is not in the real app today.)*

### C — Crash/disconnect recovery
- **sidecar:** `GET /api/runs` → server-truth list of live runs (+ pending approvals).
- **ui:** on (re)connect, **rehydrate** the queue/dots/approvals from server truth, not
  in-memory JS. Prerequisite for HALT reaching orphaned runs after a reload.

### D — Consent TTL: surface it, don't rebuild it
A TTL **already** auto-denies after `CONSENT_TIMEOUT_MS` (`index.js:37,343`). Track-A/D work =
(a) surface the countdown in the UI and (b) **emit a stream record** of the auto-deny (needs the
D4 `permission.response` emit). **Do not re-implement / double-arm the timer.**

**Acceptance:** HALT stops every run (browser **and** hub) within ~1s; a run that would breach the
session cap never starts; reload mid-run re-shows live runs; the existing TTL's auto-deny is
surfaced + recorded; **each behavior has a `test:fast` case**; `test:fast` green.

---

## Parallel track B — Honesty / accessibility floor (cheap, high-leverage)

### A — Reduced-motion + redundant cue (owner: **a11y-floor**, sole owner of `css/style.css`)
- Add a `prefers-reduced-motion` `@media` block (none exists); default heavy motion
  (flicker/scanline/klaxon strobe) **off** under it.
- The **primary** approval cue must be **static + redundant**: solid ring **+ glyph + "APPROVAL
  REQUIRED" label + agent-faces-console** — never red-strobe-alone. Demote the full-viewport
  strobe to an optional slow accent.

### B — Distinct "needs-you" sound (coordinate on already-merged `frontend/js/audio.js`)
- Give `permission.prompt` its **own** two-note klaxon (≠ `memory.write`'s `SFX.chime()`,
  `audio.js:212/214`), with a music duck. **Re-arm prereq:** re-arming after ~20s needs to know the
  prompt is still unresolved — there is **no resolution signal today** (`permission.response` is
  registered but emitted nowhere). Land the D4 `permission.response` emit first, **or** let the
  attention-queue own the re-arm. This is the enabling condition for "leave it on my second monitor."

### C — Screen-reader + keyboard
- `aria-live="assertive"` announcement of the consent string `chat.js` already builds; `aria-label`
  on the canvas; `:focus-visible` rings on every consent/crew/ws control; full keyboard operability.

---

## Parallel track C — Deliverables strip (the "practical half")

A slim, **persistent** file-chip strip reading the **live workstream deliverable list**, so outputs
survive the COMMS log wipe and aren't buried as a dim tool-row. Each chip opens `/api/file`.
⚠ **Verified gotcha:** a deliverable record (`workstreams.js:171`) holds only `{title,kind,runId,t}`
— **no `agentId`**. The `/api/file?agent=` value must read `agentId` from the **parent workstream**
(`w.agentId`), not the deliverable record. Name the host file/DOM region and reconcile its
ownership with **frontend-hud**. Refactor-independent — ship now.

---

## Post-gate — per-agent war-room features (build AFTER the gate)

Now honest, because the channels + projection exist:
- **Unified multi-slot ATTENTION QUEUE** (`frontend/app/queue.js`, new file) — the D1 client
  projection; ordered, newest-blocking-first, every type; row = agent dot + verb + inline action;
  visible cap 3 then `+N`; `Alt+A` advances to next item of any type.
- **Per-agent TRUE status** on the crew rail — drive each row from its own channel state (kill the
  global `crewStatus(act)` broadcast in `stationui.js`): working / thinking / idle / **ERROR** /
  **AWAITING-YOU**, encoded **glyph + label + color** (redundant, not hue-alone).
- **Per-agent burn indicator** + per-agent soft cap → drops a "PAUSED — over budget?" item into the queue.
- **Desk monitor shows the real current tool** (`chat.js` streams `onToolCall ev.name`): `WEB`/`FS`/`GIT`,
  amber awaiting consent, green running, dim idle. *(world.js owned by frontend-hud; reconcile with camera/onboarding.)*
- **Layout re-skin** around the **real `world.js`** (lounge/TV/novelty/real belts) — not the throwaway 320×180 canvas.
- **Keyboard triage:** `Enter`=approve / `D`=deny / `O`=open, auto-advance; `j/k` cycle **only** agents
  that need me — **without** re-targeting the compose box.

---

## CUT / explicitly NOT in v1
- ❌ **Do NOT port the mockup's cinema mode** (`#app.cinema` / `C`-keybind / hint) into the real app —
  there is no cinema code in the real app to remove; it would hide crew, queue, reactor, AND the
  E-STOP. The real second-monitor need → a *later* watch-mode that keeps **HALT + approvals pinned**.
- ❌ **Don't polish the mockup's fake canvas** — re-skin around the real World module.
- ❌ **No `emit('attention.item')` envelope / 3 separate stores** — one client projection over existing events.
- ❌ **Don't sell belts as "task flow"** / render N decorative wanderers as live agents.
- ❌ **No fast full-viewport red strobe** as the primary cue (seizure/vestibular + alarm fatigue at ~30/hr).
- ❌ **No per-agent spend chrome in the top bar** — route detail to a docked ledger; keep the top bar one calm gauge.
- ❌ **No orchestration/delegation semantics** now — scope v1 to human-fan-out; leave a `{spawnedBy,feeds}`
  seam in the channel model so belts can become real later without a third refactor.

---

## Dependency order (corrected)

1. **PRE-FLIGHT** — re-run the registry commands; land/freeze the gate-file owners
   (`agent/voice` → `chat.js`; `agent/design-system` → css/index.html; `agent/camera`+`onboarding` → world.js).
2. **Paper decisions** — D1, D2 (incl. locked keys), D3.
3. **Shared-contract owner lands D4** — the additive `shared/events.js` changes (`full` enum,
   `permission.response` emit, etc.) **before any emitting workstream** (else `lint-emits` fails).
4. **In parallel** (each on its own file/worktree per the matrix):
   - **comms-channels** (the GATE — `chat.js`, after voice lands)
   - **safety-sidecar** (`index.js` + `hub.js`, coordinated with the four occupants)
   - **a11y-floor** (`css/style.css` + coordinated `audio.js`)
   - **deliverables** (new file)
   - **frontend-hud** (shell scaffold: grid, approval hotspot shell, top-bar HALT button — *static
     scaffold only; endpoint-binding waits for safety-sidecar*)
5. **After the gate + safety endpoints land:** safety-ui endpoint-binding (`/api/halt`,`/api/grants`,
   `/api/runs`); attention-queue; true per-agent dots; per-agent spend; desk-monitor.

> Note the brief's earlier "now" labels are **priority, not "all shippable simultaneously."**
> `safety-ui` endpoint-binding is **step 5**, not parallel — it depends on safety-sidecar.

---

## Acceptance gates (every workstream)
- `npm run test:fast` fully green before merge — including **`lint-emits.js`** (no unregistered
  `emit()`) and **`lint-determinism.js`** (no ambient `Date.now()`/`Math.random()` in `shared/`+`sidecar/`
  — use the injected clock/rng; relevant to safety-sidecar's new code).
- **Each safety/behavioral workstream adds its own passing `test:fast` case** (HALT stops all incl. hub;
  session-cap refuse-to-start; TTL auto-deny surfaced). Green-before-merge regresses silently without them.
- Passes **the one ruthless rule** — no pixel asserts un-provable state.
- **Synced (rebased) onto trunk before merge** so conflicts surface in your worktree; **commit only your
  files with pathspecs** (never `git add -A`).

---

## Single biggest risk to avoid
Building the seductive war-room (queue, instrument dots, multi-slot approvals, per-agent spend) **on top
of the still-single-agent `chat.js`** — or **on top of live unmerged branches** (voice owns `chat.js`!) —
producing a UI that *looks* like it directs 10 agents but where selecting #2 wipes #1, two runs can't
coexist, a backgrounded run's spend/approval is invisible + uncancelable, the E-STOP misses Telegram runs,
and an agent silently clobbers another's in-flight file. That's not an incomplete feature — it's a
truthful-telemetry (and no-clobber) violation worse than a fake progress bar. **The gate is the gate, the
registry is the law: reconcile, sequence, then build.**
