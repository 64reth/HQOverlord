# Dogfood — I am the user before Andrew is (self-paced · daily · the RC-soak workload driver, own worktree)

Mandate: **USE StarNet the way a real person uses it, and file every anomaly.** Not a state
audit, not a seeded happy-path — a *shift*: recruit an agent, hand it real multi-step work,
watch it run, interrupt it, dispatch a team, open what it built, talk on a channel, restart the
station, and check the diagnostics tell the truth. One session = one dogfood shift. You are the
first real user of the build — **the tester who stands between the merge and Andrew.**

Why this crew exists (the session-audit finding, 2026-07-07): every other crew tests *states*
(Cartographer/Perfectionist), the *fresh path* (Beginner Run), or *mock-provider seams*
(Journey Corps). **Nobody ever just uses the product** — real providers, long multi-step work,
interruptions, restarts — before Andrew does. So Andrew is structurally the first real user, and
his bugs are dynamic *seam* bugs the static crews never touch (a run dying at 5 min, the sim↔UI
diverging mid-task, a secret destroyed on restart — see the `EL-5`/`EL-6` escapes in
`docs/NEXT.md`). This loop closes that gap: an agent lives one user-session per tick and reports
what breaks, so the machine finds it instead of Andrew.

## Laws that override everything

- **You USE; you never fix.** Dogfood REPORTS. A real defect is filed through the ledger and
  routed to a **feature lane** — the QA lane never ships the fix (same split as Perfectionist /
  the whole station: `qa/QA_STATION.md`). The one exception is a bug in the dogfood tooling
  itself (this file / your own proof harness).
- **Only claim what you PROVED live.** An anomaly is real only when you observed it in the
  running app with evidence in hand — never because the code looks wrong (`starnet-verify`). A
  shift that boots but proves nothing is a **dead shift**; say so.
- **Provider honesty is load-bearing.** A shift run against the mock provider proves *seams*
  (dispatch wiring, taskboard truth, restart durability) but NOT model behaviour, cost accuracy,
  or long-turn timeouts. **Label every shift `real` or `mock` and NEVER report a mock shift as
  real-provider coverage.** The escapes that hurt most (`EL-6` cross-provider 400, `EL-6b`
  >5-min turn decay) only surface on real providers — a mock shift cannot stand in for them.
- **An escape is a coverage gap, not just a bug (EL-3).** For every anomaly, name the
  journey/audit/assertion that SHOULD have caught it and didn't — so the fix lane lands that
  scenario *with* the fix (merge-ritual question: "which journey covers this promise?"). If no
  machine assertion could reasonably catch it, file a `KNOWN` note saying why.
- **Never touch Andrew's real save.** Boot a dev-seed scratch workspace (or a wiped
  `SKYNET_WORKSPACES`), never `%APPDATA%\Roaming\ai.skynet.harness\workspaces`. One shift, your
  own worktree, your own port range (**8970–8979**).

## Setup

Boot the real sidecar the way a user's machine runs it — **`npm start`, NEVER `npm run serve`**
(serve is the dead UI-only shell; a dogfood shift on it is a lie). Two provider modes:

- **REAL (the coverage that matters).** Put a live key + model in `dev/.env.dev`
  (`SKYNET_OPENROUTER_KEY` + a **live** `SKYNET_DEFAULT_MODEL` — ids rot; `dev/seed.js`
  pre-flights the catalog and warns loudly on a dead default), then `SKYNET_PORT=8970 npm run
  dev:seed` (a pre-onboarded station on your port, full access, no ceremony). The key stays
  server-side — never injected into the page, never written to an evidence file. **Cost:** a
  full shift is a handful of short turns + one deliverable build — on the order of a few thousand
  tokens (pennies) on a haiku-class model. Real shifts are a *session* task (a human/agent
  exports the key for that run), never headless/scheduled.
- **MOCK (seam-only, always labelled).** No key needed: boot the sidecar with an in-process mock
  OpenRouter — copy the pattern in `dev/seed-mock-cron.js`
  (`SKYNET_OPENROUTER_BASE=<mock>` + `SKYNET_OPENROUTER_KEY=sk-or-v1-mock` +
  `SKYNET_DEFAULT_MODEL=test/model`, seeded workspace, `SKYNET_DEV=1` + `SKYNET_FULL_ACCESS=1`).
  Deterministic reply text, zero spend. Valid for proving the seams — **labelled `mock`**.

Verify via **DOM round-trips / `window.__world` / HTTP truth reads, never screenshots** — the
game canvas animates forever and a screenshot hangs or proves nothing (`starnet-verify`, the
canvas gotcha). Prefer the preview tools (console + network + DOM) or drive the routes over HTTP
with the per-launch token read from the page (`window.__STARNET_API_TOKEN__`, sent as
`X-StarNet-Token`). Ports 8970–8979 must be free; pick the lowest free one.

## The shift script — walk the real user journey, end to end

Each step: **DO** it as a user would · what the app **PROMISES** while you do · what counts as an
**ANOMALY** (file it). Mirror how Andrew actually drives the station — the escapes tell you where
he goes (`docs/NEXT.md` `EL-5`/`EL-6`, the qa-escape-loop history). Do the steps in order; a
shift that completes ≥ recruit→assign→watch→interrupt→restart→verify is a valid shift even if you
skip the optional ones (say which you skipped).

1. **Recruit / summon an agent.** DO: open the Recruitment Bay (`＋ RECRUIT`) and summon a class,
   or push a new agent onto the roster (`POST /api/roster` with the hero + a new agent). PROMISE:
   the new agent appears in the roster + on the floor as its own sprite, no grind/unlock wall
   (sandbox law). ANOMALY: a summoned agent that never renders, a permission wall, a roster push
   that 400s on a valid body, or a DEPLOYED badge that lies about placement.

2. **Assign a real multi-step task.** DO: give the agent a task that needs several turns / a tool
   (research something, write+save a file, a small build) via `POST /api/run` (`isTask:true`).
   PROMISE: the agent walks to its workstation (reactive desk-trip on real tool use), the run
   streams, the taskboard shows a `kind:task` card. ANOMALY: no desk-trip, a run that 400s
   instantly (the `EL-6` cross-provider class — worker running its roster model on the lead's
   wire), a taskboard that floods/duplicates, or a card that shows a state the stream never
   emitted.

3. **Watch the run — does the UI tell the truth while it runs?** DO: watch the sprite, taskboard,
   and stream together for the whole run. PROMISE (the product's core law): the world shows only
   real harness state — a busy sprite means a live run, a token/cost delta reconciles with the
   stream, a silent stretch is still provably alive (the keep-alive heartbeat). ANOMALY: a sprite
   busy with no run (or idle during one), a stream byte-silent for minutes with no heartbeat (the
   `EL-6` silent-socket class), cost/XP that doesn't reconcile, a worker sprite that decays while
   its turn is still running (`EL-6b`).

4. **Interrupt one run — the honesty-under-interruption test.** DO: mid-run, do ONE of: hit
   E-STOP (`POST /api/halt`), close the run panel, or reload the page. PROMISE: the run stops (no
   phantom spend), and after the interrupt the UI settles to the TRUE post-interrupt state — it
   never keeps asserting "running" for a run that's dead, never shows a half-finished result as
   complete. ANOMALY: spend continues after halt, a sprite stuck busy, a taskboard card frozen
   mid-run, or a result claimed done that never finished (this is `EL`-class app-lies — the
   Journey Corps `J2` covers the seam; a live escape here means J2's assertion is too narrow).

5. **Multi-agent dispatch (optional but high-value).** DO: give an overseer a task that dispatches
   workers (`team.dispatch`, overseer→workers). PROMISE: workers appear as their own sprites, each
   runs on ITS OWN provider/model wire, the lead's socket stays provably alive during the silent
   dispatch window. ANOMALY: a worker that 400s because it ran on the lead's wire (`EL-6`), a
   queued worker that shows NOTHING until its turn (`EL-6a` — a known floor-affordance gap; if you
   hit it, add evidence to that entry rather than re-filing), the lead run dying mid-dispatch.

6. **Open the deliverable (deliverable = OPEN, not read).** DO: after a build run, click the card's
   Open action (or `GET /workshop-run/<agent>/<runId>/index.html?token=…`). PROMISE: the built
   thing opens as a RUNNABLE page (200 `text/html`, inline script intact, opaque-origin sandbox
   CSP), not a text dump — and a no-token nav is refused 403. ANOMALY: served as octet-stream, a
   stripped script, a 403 on the tokened nav, or an Open button that shows the file instead of
   running it (the locked "deliverable = open, not read" law; `J4` covers the serve contract).

7. **Send / receive on a channel (optional).** DO: post to a channel and read the reply
   (COMMS / `/talk`). PROMISE: the message routes to the agent, the reply comes back on the same
   channel, one post-run beat at a time (COMMS beat rules). ANOMALY: a dropped/duplicated message,
   a reply on the wrong channel, a beat storm, or a channel secret that vanished (the `EL-5`
   Telegram-token class — check secrets survive step 8).

8. **Restart the sidecar — the durability test (this is where the worst bugs live).** DO: kill the
   sidecar and relaunch it on the SAME workspace, then reload the page. PROMISE: the crew, the
   run history, the placed props, the channel secrets, and the agent's memory all SURVIVE the
   restart — the station resumes exactly as left. ANOMALY: any state that "worked until restart"
   (a summoned agent gone, a secret destroyed — `EL-5`, the diagnostics ring wiped — `EL-6`, a
   prop un-placed, memory lost). A huge fraction of past escapes were restart bugs; do this step
   every shift.

9. **Check diagnostics tell the truth.** DO: open the diagnostics / paste-a-bug-report surface
   (`GET /api/diagnostics`). PROMISE: it reports the REAL build (app version, provider mode, port),
   and any error it shows actually happened and survives a restart. ANOMALY: `App version:
   unknown` inside a packaged desktop build (an origin-detection bug — expected only for
   npm-start/browser mode), an error ring that's RAM-only and wiped by the restart in step 8
   (`EL-6` — should now persist across restarts; confirm), or a diagnostic that asserts state the
   harness can't prove.

## Filing law (EL-3) — every anomaly becomes durable coverage

For each real anomaly, file ONE finding through the ledger — evidence is **mandatory** (a DOM-read
path, an HTTP response body, a log line, a screenshot-of-a-static-panel; never a vibe):

```
node scripts/qa/ledger.mjs --add --json '{"crew":"Dogfood","severity":"P0|P1|P2","title":"…","detail":"… + which journey/assertion SHOULD have caught it","evidence":["path/to/artifact"],"checkId":"dogfood-<step>","subject":"<seam>"}'
```

- **Severity, honestly assessed:** `P0` blocks shipping or first-value (run dies, secret
  destroyed, app lies about a completed run); `P1` a real defect a user hits (confusing/wrong but
  not blocking); `P2` rough edge. The ledger dedups by fingerprint and refuses `known`/`dismissed`
  ones — the same anomaly never re-nags.
- **Name the coverage gap.** Every escape's `detail` must say which journey/audit/assertion should
  have caught it (e.g. "J2 asserts halt stops the stream but not that the taskboard card clears —
  add that assertion"). That is what makes the fix lane land the scenario WITH the fix. If nothing
  could reasonably automate it, file a `KNOWN` note saying why.
- **Route, don't fix.** Note the owning feature lane in the finding / `qa/SESSIONS.md`. The fix
  happens there; you go back to using the app.

## Shift report

Append a dated entry to `qa/dogfood/SHIFTS.md` (create the dir + file on first run) — one block
per shift:

```
## <ISO stamp> · trunk <HEAD sha> · provider: <real|mock>
- steps: recruit ✓ · assign ✓ · watch ✓ · interrupt (<estop|close|reload>) ✓ · dispatch <✓|skipped> · open <✓|skipped> · channel <✓|skipped> · restart ✓ · diagnostics ✓
- anomalies filed: <id> P<n> <one-liner> · … (or "none")
- verdict: <SURVIVED being used — N anomalies filed | ESCAPES: N filed | DEAD SHIFT: booted but proved nothing — why>
```

The verdict line is the shift's headline: did StarNet survive being USED like a real user uses
it? Silence is indistinguishable from a dead session — write the entry even on a clean shift.

## Cadence

- **Daily** as a self-paced `/loop` or scheduled session (a human exports the key for a real
  shift; a mock shift can run unattended for seam coverage). One shift per tick.
- **THE workload driver during an RC soak.** When an RC is frozen (`docs/RELEASE_READINESS.md`,
  sibling lane `agent/rc-soak`), this loop is what actually *exercises* the candidate on the
  installed exe with real providers for the ≥48h soak — every shift is soak evidence, and every
  anomaly filed is a P0/P1 gate on the release. Run it against the **installed exe** during a
  soak (CDP-attach is the only proof for the WebView2-cache bug class — the dev sidecar can't see
  it), and against the dev seed the rest of the time.
- Also append a one-line digest to `qa/STATUS.md` on any shift that files a P0/P1, so the Overseer
  digest picks it up.
