# StarNet → ref-parity FINISH Loop (G1 computer/browser · G2 MCP stdio · G4 cron · G5 fs patch · G6 spend)

> The durable brain for the self-paced parity-finish + reliability loop. Source: the 2026-06-23
> StarNet-vs-the reference harness audit (verified file:line recon + adversarial critique). Scope = the five
> ON-MOAT gaps where the reference harness excels and StarNet lacks or lies: **G1** computer/browser use,
> **G2** MCP stdio transport, **G4** cron 100%-reliability, **G5** fs multi-hunk patch, **G6**
> spend/model honesty. **Discord / gap #3 is INTENTIONALLY EXCLUDED — held off by the user; do
> not touch channels.** Defining theme: most of this is PORT-WITH-PROOF — copy the reference harness's exact
> grounding/atomicity/lock invariants, but make every "it works" claim a TEST or a LIVE CHECK,
> never a single anecdotal pass. A single success is an existence proof, not reliability.

## Operating protocol (obeyed every iteration)

1. **Work in the worktree, never the integration tree.** ALL editing/committing happens in
   `C:\Users\<you>\gen-trees\parity-finish` on branch `agent/parity-finish` (already created via
   `gen-trees\new-agent-tree.ps1 parity-finish`). The integration tree (trunk
   `feat/harness-backend`) is touched ONLY to merge. Never edit
   another agent's worktree or `agent/*` branch.
2. **Green before merge.** `npm run test:fast` must pass FULLY in the worktree before any merge
   (CLAUDE.md rule 5). For shell/route/channel-touching items (G2 stdio spawn, any new
   `/api/*` route, the cron toggle route) ALSO run `npm run test:http`.
3. **Watched before DONE.** Any loop/UI/tool-affecting item gets a live `npm start` check on a
   FREE port (don't collide with :8787 if it's in use) — boot clean, exercise the surface, read
   the result back. Capture the transcript. A headless test alone does NOT satisfy a
   tool/loop/UI item (StarNet's recurring "fake-done / app-lies" failure mode).
4. **One revertable commit per item** (a tight series is ok). Conventional commits, each ending
   with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Commit only YOUR files with
   explicit pathspecs — NEVER `git add -A` / `git add .`.
5. **Polish gate before advancing** — self-review the diff, fix real findings, re-gate.
6. **Shared contract additive-only.** `shared/events.js` and `shared/schema.js` are
   MEMORY-CORTEX-owned (live worktree `C:\Users\<you>\gen-trees\memory-cortex`, branch
   `agent/memory-cortex`). New events/enum-widenings/fields are ADDITIVE only and must be
   **REQUESTED** from that owner with the exact name + payload shape, merged to trunk FIRST,
   then synced and consumed — NEVER self-edited, renamed, or removed. `git log
   feat/harness-backend..agent/parity-finish -- shared/events.js shared/schema.js` MUST stay
   empty. **Batch ALL additive requests (G1 + G4 + G6) into ONE round-trip** to the owner.
7. **`loop.replay` byte-identical.** Any `loop.js` change (none expected in this lane, but if
   touched) must keep `loop.replay` byte-identical — assert it.
8. **Sync before merge** (`gen-trees\sync-agent-tree.ps1 parity-finish`) so conflicts surface in
   YOUR worktree, not on trunk. Rebase in the SAME session as the merge (high cadence: 5+
   merges/hour from hermes-parity/crew-sentience/state-integrity at peak).
9. **Board-check the hot files before editing.** From the integration tree run
   `node scripts/board.mjs --files <path>` before editing AND again immediately before merge.
   MANDATORY for the revival-risk files: `sidecar/index.js`, `sidecar/capability/registry.js`,
   `sidecar/runstore.js`, `sidecar/insights.js` (all `agent/hermes-parity`, touched 3–4h ago);
   the live frontend lanes **`agent/workforce-zones` in `frontend/app/world.js`** and
   **`agent/onboarding-remaster` in `frontend/app/app.js`/`voice.js`** (also
   `agent/crew-sentience` in world.js, `agent/state-integrity` in app.js). PREFER NOT to touch
   `world.js` at all — it is the most-contended frontend file.
10. **No infinite walls.** After a REAL fix attempt fails the gate, set the item BLOCKED with
    the concrete reason and move to the next INDEPENDENT item, surfacing it loudly. Never
    fake-green; never weaken a test to pass; never hand-pick a cooperative page/window and call
    a reliability item done.

> **Red-before-green (applies to EVERY new test in this lane):** each new acceptance test must
> be shown to FAIL on the pre-fix tree and PASS after — capture both states in the Progress Log.
> A test that passes against both old and new code is vacuous and does not count toward DONE.

> **Attended verification gates.** A few acceptance criteria require a live display the autonomous
> loop cannot honestly drive: **G1.1 RELIABILITY** (≥9/10 live browser runs) and **G1.2
> REAL-ACTION PROOF + BACKGROUND CO-WORK** (live desktop action, real-cursor-unchanged). For these:
> build the feature and prove EVERY headless criterion green, then mark the live-only criterion
> `ATTENDED` (NOT BLOCKED-failed, NOT DONE) with a one-line repro for Andrew to run. An `ATTENDED`
> criterion never counts toward DONE and is never fake-greened — the goal is DONE only once Andrew
> confirms the live check. The loop continues to the next item rather than walling.

## Per-iteration algorithm
1. Read this file. Pick the first item not DONE / not BLOCKED, in the **autonomy-first order
   G4 → G2 → G5 → G6 → G1** (in listed sub-item order). Rationale: G4/G2/G5/G6 are fully verifiable
   headlessly (injected clock / injected spawn / a Playwright page stub / fold tests) plus a local
   `npm start` smoke, so the loop can drive them to perfect standard UNATTENDED; **G1 is sequenced
   LAST** because its perfect-standard bar includes live-display reliability (≥9/10 live browser
   runs; real desktop action with cursor-unchanged) that an autonomous loop cannot self-certify —
   see **Attended verification gates** above. The loop still BUILDS G1 and proves every headless
   criterion; only its live-reliability criteria wait for Andrew. (G4 also leads because cron is
   the user's most-crucial goal and is 100% deterministically testable.)
2. Advance ONE coherent step: TODO → write tests-first (red-before-green) → implement + gate →
   POLISH self-review → VERIFY live + merge.
3. Update the item's STATUS + Notes; append a dated Progress Log line.
4. Goal complete → run a phase polish pass (full gate + live smoke of that goal's surfaces) →
   advance.
5. All goals DONE → write `LOOP COMPLETE` to the Progress Log and STOP (do not reschedule).

> **Baseline:** worktree `agent/parity-finish` cut from trunk `feat/harness-backend` @ `b452465`;
> `npm run test:fast` confirmed **GREEN** in the fresh worktree (2026-06-23, all ~80 suites + the
> emit/determinism lints, zero failures) before the first edit. This is the red-before-green
> reference tree.

---

## GOAL G1 — Computer use + browser automation (two surfaces)  ·  STATUS: TODO
> PARITY TARGET: the reference harness ships TWO surfaces (desktop `computer_use` + `browser`); StarNet has
> NEITHER (no such builtin under `sidecar/tools/builtin/` — only fs/image/notebook/orchestration/
> recall/shell/skills/spotify/todo/verify/web). **RECONCILED DESIGN (the two recon reports
> contradicted each other — this is the single source of truth):** file names = `browser.js` +
> `computer.js` (NOT `computer_use.js`); adopt report-1's tool/grounding port (the detailed
> the reference harness parity) with report-2's capability framing — a NEW capability key **`remote`** gated
> `execute + consent`, mirroring `shell.js` so it inherits the autonomous EXEC LOCKOUT at
> `permissions.js:92` for free. **Build `browser.js` FIRST** (native Node / Playwright, low
> risk), then `computer.js`. The frontend capability-OBJECT surfacing (`world.js`/`worldmodel.js`
> `remote_rig`) is **DEFERRED to a separate follow-on lane** — do NOT touch `world.js` here; the
> tool must be reachable via registry + capgate WITHOUT any world-object.

### G1.1 — `browser.js` builtin (Playwright, ariaSnapshot + @ref grounding)  ·  STATUS: TODO
One-line task: add a `browser` builtin wrapping Playwright-for-Node (bundled Chromium), action
family `{navigate, snapshot, click, type, scroll, back, press, console, dialog, get_text,
vision}` matching the reference harness `browser_tool.py:2418-3200`; grounding via a per-session text aria
snapshot with stable `@e1..` refs rebuilt on every snapshot.
- **Acceptance (PERFECT STANDARD):**
  - SURFACE (headless, `test/browser.test.js`, Playwright page stub): each action exists and
    behaves — `navigate` settles before returning; `snapshot` returns aria text + `@e1..` refs;
    `click(ref)`; `type(ref,text)` does clear-then-fill (`locator.fill('')` then `fill(text)`);
    `scroll`; `back`; `press`; `console`; `dialog`; `get_text`. Asserted action-by-action.
  - GROUNDING + STALE (headless): a `@ref` used AFTER a newer snapshot returns an EXPLICIT stale
    error and never silently re-resolves to a different element (the reference harness `element_token`
    invariant, `backend.py:27-33`). Per-session ref→Locator map keyed by `agent+task` id (no
    global map → no cross-agent ref bleed across StarNet's 7–10 agents).
  - SETTLE (headless, fake timers): `navigate` waits for DOM + network settle (networkidle OR a
    quiet-timer, hard-capped ~5s) before returning the first snapshot; at least one LIVE run
    exercises a LAZY/async-rendered element to prove the settle-wait actually waits.
  - SAFETY (headless): `navigate` blocks SSRF/private+IMDS on the URL AND on every redirect hop,
    and blocks secret-in-URL — REUSE `web.js`'s existing guards (parity
    `browser_tool.py:2429-2563`). Asserted with malicious URLs + a redirect chain.
  - DIALOG (live or integration): a page firing `window.confirm` surfaces a PENDING dialog inside
    the next `snapshot` output and is answerable via the `dialog` action (native Playwright
    `page.on('dialog')`, parity `browser_supervisor.py` + `browser_dialog`).
  - LAZY-INSTALL DEGRADATION (headless): with Chromium NOT installed, the app still BOOTS and
    `npm run test:fast` passes — the tool registers but reports a graceful "browser engine not
    installed" tool-absent state (mirror the reference harness's one-time `install` step; keep the ~150MB
    Chromium out of the base download).
  - RELIABILITY (LIVE, captured transcript — NOT a single pass): a FIXED multi-step task
    (navigate → snapshot → click ref → type → submit via press → read result from next snapshot)
    succeeds **≥9/10 consecutive runs** on real bundled Chromium with ZERO manual coordinate
    fallback (ref grounding only). The transcript artifact is saved and referenced. A stub-only
    PR is rejected; the live run must be proven by a non-mockable signal (real navigation
    timing).
- **Files:** `sidecar/tools/builtin/browser.js` (NEW, low collision — follow `web.js` UMD +
  `makeXTools(deps)` factory, reuse its SSRF/secret guards); `sidecar/tools/registry.js` (edit,
  med — additive `register()` only, no dispatch reshape); `sidecar/capability/registry.js`
  (edit, HIGH — `agent/hermes-parity` H4.2 territory, board-check + rebase same-session; add the
  `remote` cap row additively); `package.json` (edit, HIGH — add `playwright` dep + append ONE
  test invocation to the single-line `test:fast` string; see coordination); `test/browser.test.js`
  (NEW, low).
- **Notes:** Build before G1.2. `requiresConsent:true`. Events `browser.navigate` /
  `browser.action` / `browser.dialog` / `browser.blocked` are ADDITIVE — request from
  memory-cortex in the ONE batch, land in trunk first, then emit (emitting before the validator
  knows them fails). Do NOT emit any event until it's in trunk.

### G1.2 — `computer.js` builtin (desktop OS control, Windows-first)  ·  STATUS: TODO
One-line task: add a single action-discriminated `computer` builtin matching the reference harness's exact enum
`{capture, click, double_click, right_click, middle_click, drag, scroll, type, key, set_value,
wait, list_apps, focus_app}` with modes `som|vision|ax`, element-index-first grounding,
`capture_after` verification, `max_elements` cap. Transport: cua-driver-over-MCP first (inherit
the reference harness's SOM/AX/element_token grounding on the stable Win32 path) with a nut.js coordinate-only
fallback so the tool degrades instead of failing to load.
- **Acceptance (PERFECT STANDARD):**
  - SCHEMA PARITY (headless, `test/computer.test.js`): the action enum is EXACTLY the reference harness'
    (`schema.py:34-48`) with modes `som|vision|ax` and an element-index-first grounding param —
    asserted field-by-field.
  - SAFETY (headless): hard-blocks destructive key combos (win+L, cmd+shift+backspace, force-quit/
    logout, etc.) and blocked type patterns (`curl|bash`, `sudo rm -rf`, fork bomb) REGARDLESS of
    approval (parity `tool.py:90-132`). Asserted that approval does NOT override the blocklist. A
    partial port that drops the blocklist is WORSE than no tool — BLOCKED, not shipped.
  - CONSENT WIRING (headless, via registry dispatch): every MUTATING action (click/double_click/
    right_click/middle_click/drag/scroll/type/key/set_value/focus_app) is DENIED when consent is
    absent and proceeds on approve_once/approve_session; `capture`/`wait`/`list_apps` are free
    (parity `tool.py:80-86,291-316`).
  - EXEC LOCKOUT (headless — the critical security test): an AUTONOMOUS run CANNOT drive
    `computer.js` (or `browser.js`) without explicit consent — the `remote` cap inherits the
    `permissions.js:92` autonomous deny. Asserted by an exec-lockout test that DRIVES the gate,
    not a code read.
  - CAPTURE/VERIFY (headless): `capture_after=true` returns a verification re-capture on success
    and is SKIPPED on failure (so a clean screenshot can't fool the model, parity
    `tool.py:836-871`); `max_elements` cap truncates dense captures with `total/truncated`
    surfaced.
  - REAL-ACTION PROOF (LIVE, Windows, captured): `focus_app`/`list_apps` opens a real app;
    `capture(mode='som')` returns numbered elements over a REAL window; click-by-element-index
    lands on the right control across **3 runs on ≥2 distinct controls**, each verified by a
    `capture_after` diff showing a REAL AX/pixel state change attributable to the action (a no-op
    backend that returns ok without injecting input does NOT pass).
  - BACKGROUND CO-WORK (LIVE, positive assertion): the user's REAL cursor X/Y is read BEFORE and
    AFTER a click and asserted UNCHANGED, and focus is not stolen (parity `schema.py:19-21,191-198`).
    Not-testing cursor position does NOT satisfy this — it must be a positive before===after
    assertion.
- **Files:** `sidecar/tools/builtin/computer.js` (NEW, low); `sidecar/tools/registry.js` (edit,
  med — additive); `sidecar/capability/registry.js` (edit, HIGH — `remote` cap reused from G1.1);
  `sidecar/permissions.js` (edit, HIGH — exec-spine-owned/security-critical; new scope ADDITIVE
  and must honor the autonomous exec-lockout; coordinate with exec-spine rather than changing
  semantics); `package.json` (edit, HIGH — optional `@nut-tree-fork/nut-js` dep + one test
  append); `test/computer.test.js` (NEW, low).
- **Notes:** cua-driver is a third-party Rust binary (per-OS install; macOS SkyLight SPIs break
  on OS updates). Prefer the stable Windows Win32 path; treat cua-driver as optional/auto-installed
  with a nut.js coordinate fallback. Events `computer.capture` / `computer.action` /
  `computer.blocked` ADDITIVE — same batched request. Riskiest surface → consent-default, hard
  blocklist non-negotiable.

---

## GOAL G2 — MCP stdio transport  ·  STATUS: TODO
> Today the StarNet MCP client is HTTP-only (`makeTransport: makeHttpTransport`,
> `index.js:647-650`/`:58`). The seam is `makeTransport` in `manager.js:56-64`; the contract is
> `client.js:19-22` — `send(message)->Promise`, optional `onMessage(cb)`, optional `close()`.
> A new `makeStdioTransport` only needs that 3-method duplex shape; `client.js`, `translate.js`,
> and the manager projection are reused VERBATIM. Framing = newline-delimited JSON-RPC (one
> message per line, NOT LSP Content-Length). A stdio server runs an ARBITRARY local command, so
> it needs MORE than the HTTP URL guard: a spawn-time command allowlist + the existing
> per-connector consent/enable gate.

### G2.1 — `transport.stdio.js` (newline-framed JSON-RPC over a child process)  ·  STATUS: TODO
One-line task: add `sidecar/mcp/transport.stdio.js` exporting `makeStdioTransport(deps)` with
the same `{send, onMessage, close}` duplex shape, spawn injected for testability; reuse
`client.js`/`translate.js` unchanged.
- **Acceptance (PERFECT STANDARD):**
  - STUB ECHO over REAL stdio (`test/mcp.stdio.test.js`): a real inline Node child speaking
    newline-delimited JSON-RPC, driven through `makeMcpClient` + `makeStdioTransport`, asserts
    `initialize()` returns serverInfo AND a `notifications/initialized` line was written;
    `listTools()` paginates across 2 pages via `nextCursor`; `callTool()` returns content and an
    `isError:true` result THROWS through `translate.js` `run()` (`translate.js:99-101`). At least
    ONE test spawns a REAL `child_process` (not just a fake duplex stream).
  - FRAMING: one stdout chunk with TWO concatenated JSON lines → two delivered messages; a
    message split ACROSS two chunks is buffered and delivered once whole; a non-JSON log line on
    stdout is SKIPPED without crashing routing (parity `parseSse` tolerance,
    `transport.http.js:51`); stderr never reaches `onMsg`.
  - LIFECYCLE/KILL/CRASH: (a) ENOENT command → `send()` rejects promptly via `failTo`, transport
    closed, no hang; (b) child crashes mid-request → that pending promise rejects with an
    'exited' error, NOT a timeout; (c) `close()`/E-STOP tree-kills (assert `child.kill` +
    `taskkill /T` on win / SIGKILL-the-group on posix) and is idempotent; (d) the client request
    timeout (`client.js:93-95`) still fires if the child accepts the line but never replies.
  - WINDOWS .cmd (the single biggest portability trap): `npx`/`uvx` are `.cmd` shims — a test
    asserts `npx.cmd` is resolved and spawned with `shell:false` and UN-MANGLED argv (NOT
    `shell:true`, which would weaken the allowlist by turning args into a shell string).
  - ALLOWLIST GATE (incl. flag-injection): a command NOT on the allowlist NEVER spawns (assert
    the injected fake spawn was not called) and every `send` fails 'not permitted'; the npx
    package spec is validated with an npx-AWARE parser — `command='npx'
    args=['--package','evil','@modelcontextprotocol/server-x']` is REJECTED with NO spawn
    (rejecting `--package`/`-p`/`--registry`/URL/tarball/git specs; default-deny unknown flags),
    while `npx @modelcontextprotocol/server-*` passes.
  - SAME DISPATCH BOUNDARY: a stdio connector's tools, projected via
    `manager.toolDefsForObjects` and dispatched through the REAL registry, are capability-gated
    (`mcp:<conn>`), consent-gated for mutating tools, and `network:true` — byte-identical
    projection to an HTTP connector.
  - ENV REDACTION (defense against silent secret leak): `manager.summary()` for a stdio
    connector NEVER includes `env` or its secret values (only `hasEnv`); ASSERT no env value
    appears in the `/api/connectors` HTTP RESPONSE body AND in any emitted bus event for a stdio
    connector — not just `summary()`.
  - REGRESSION: the existing function-form `makeTransport` still works after `manager.js` accepts
    fn-or-map (`mcp.transport.test.js` unchanged); `lint-determinism.js` green (clock/spawn
    injected, no `Date.now`/`Math.random`).
- **Files:** `sidecar/mcp/transport.stdio.js` (NEW, low — beside `transport.http.js`);
  `sidecar/mcp/manager.js` (edit, med — connectors-lane; `makeTransport` accepts fn-or-map,
  record gains `command/args/env/cwd/transport`, `summary()` redacts env; coordinate with the mcp
  lane); `sidecar/index.js` (edit, HIGH — touch ONLY: import near `:58`, manager construction
  `:647-650`, `/api/connectors` upsert `:1082-1099`, `handleHalt` `:1919-1924`; minimal
  pathspec-scoped); `test/mcp.stdio.test.js` (NEW, low); `package.json` (edit, HIGH — append
  `&& node test/mcp.stdio.test.js` right after `mcp.transport.test` on the single-line `test:fast`).
- **Notes:** E-STOP MUST reap stdio children — wire `connectors.close()` into `handleHalt`
  alongside `shellBg.killAll()`, and on shutdown, or a runaway stdio server's spend/CPU survives
  E-STOP. Reap the process GROUP (npx spawns a node grandchild) or an orphan leaks. NO new events
  needed (translate.js emits the frozen `agent.tool_call`/`tool_result`). Run `test:http` (route
  touched).

---

## GOAL G4 — Cron 100% reliability (the critical one)  ·  STATUS: DONE (all 6 items)
> PARITY TARGET: the reference harness cron guarantees tz/DST-correct next-fire, at-most-once across crash
> (advance-before-run), no-backlog catch-up, cross-process exactly-once (two file locks),
> atomic+durable persistence, recurring-never-silently-disabled. StarNet's determinism split
> (pure cron-math + injected clock) is already AHEAD on testability and matches most of this.
> FIVE gaps remain. Preserve the architecture; close the gaps; keep all new math PURE (injected
> clock; `Intl.DateTimeFormat` with an explicit timeZone is pure given ms and is NOT banned by
> `lint-determinism.js` — confirm + a focused test).

### G4.1 — Timezone / DST correctness (highest value)  ·  STATUS: DONE
One-line task: add an optional IANA tz to cron schedules; match on local wall-clock via
`Intl.DateTimeFormat` (replacing `getUTCHours/getUTCMinutes`, `cron.js:154-167`) so `0 9 * * *`
fires 09:00 LOCAL and shifts across DST; default tz = host tz captured once at boot (injected
constant); add the offset-drift repair branch (parity `jobs.py:1364-1385`).
- **Acceptance (PERFECT STANDARD — the strict deterministic-clock DST checklist):**
  - SPRING/FALL next-fire (`test/cron.dst.test.js`, injected clock, pure): `0 9 * * *`
    tz=`America/New_York` across 2026-03-08 spring-forward and 2026-11-01 fall-back yields
    instants EXACTLY 09:00 local each side (offset −05:00 before / −04:00 after in spring); the
    two day-lengths differ by the correct 23h/25h.
  - NONEXISTENT local time (the hardest case): `30 2 * * *` on 2026-03-08 (02:00→03:00 skipped)
    fires EXACTLY ONCE at the post-transition instant (03:30) — documented policy, tested, never
    silently skipped or double-fired.
  - AMBIGUOUS local time: `30 1 * * *` on 2026-11-01 (01:30 occurs twice) fires EXACTLY ONCE
    (first occurrence), never twice.
  - A tz TYPO fails parse (400) — it must NOT silently fall back to UTC (that re-introduces the
    lie).
  - LIVE: `/api/cron/preview` returns the local-time string for a tz schedule (e.g.
    "next: 9:00 AM EDT").
- **Files:** `sidecar/cron.js` (edit, med — additive tz param, default UTC preserves current
  behavior, no signature break, stays determinism-lint clean); `sidecar/index.js` (edit, HIGH —
  host-tz constant near `:170`, tz in preview at `:1287-1303`); `frontend/app/stationui.js`
  (edit, med — tz in the `buildRoutines` preview `:1234-1390`); `test/cron.dst.test.js` (NEW,
  low); `package.json` (edit, med — append test).
- **Notes:** Document the nonexistent/ambiguous policy in the `cron.js` header. Event additive:
  `cron.skipped` reason `tz-recompute`, `cron.fire` optional `tz` — batched request to
  memory-cortex.
- **DONE (2026-06-23).** Optional IANA `tz` added to cron schedules, additive + back-compat (default
  UTC = byte-identical old behavior; no signature break). Local wall-clock matching via a PURE
  `Intl.DateTimeFormat(en-US,{timeZone})` minute-scan (lint-determinism stays GREEN — no
  `Date.now`/`new Date()`/`Math.random` added; the only `new Date(ms)` is the lint-allowed
  arg-form fallback in `localDow`). Host tz captured ONCE at boot as the injected `CRON_HOST_TZ`
  constant (override `SKYNET_CRON_TZ`; invalid → UTC) and threaded as `defaultTz` into the driver's
  `planTick` + the preview route — the cron-math never reads the ambient clock. A tz TYPO fails
  parse (parseSchedule → null → 400 with a clear message); NO silent UTC fallback.
  - **DST policy (documented in the `cron.js` header + tested):** NONEXISTENT spring-forward local
    time fires EXACTLY ONCE at the post-transition equivalent (02:30 → 03:30 local), via the
    offset-drift repair branch that detects the forward gap. AMBIGUOUS fall-back local time fires
    EXACTLY ONCE at the FIRST occurrence, via a repeat-band suppressor that drops the doubled hour.
  - **Verified:** `test/cron.dst.test.js` (NEW, 29 assertions) — RED before the fix (22 failures on
    the unmodified tree), GREEN after; spring `0 9 * * *` NY = 23h day (14:00Z→13:00Z), fall = 25h
    (13:00Z→14:00Z). Full `npm run test:fast` GREEN (incl. cron/cron.tick/cron-store regressions +
    lint-emits + lint-determinism). `npm run test:http` GREEN (cron.api.test extended with the tz
    preview + typo-400 assertions). Year-long + southern-hemisphere (Sydney) walk confirmed
    365 fires, zero wrong-local / zero dupes / zero skips. LIVE smoke on a free port (:8842,
    SKYNET_CRON_TZ=America/New_York): `/api/cron/preview` returns `tz` + `localNext` (e.g.
    "Wed, Jun 24, 9:00 AM EDT"); tz-less uses host tz; explicit tz:UTC preserves 09:00Z; a typo'd
    tz → HTTP 400.
  - **Files:** `sidecar/cron.js` (tz-aware match + DST repair, header policy), `sidecar/index.js`
    (`CRON_HOST_TZ` const + tz-aware preview returning `tz`/`localNext`, `parseCronScheduleOr400`
    tz-arg + reject), `sidecar/cron-driver.js` (inject + thread `defaultTz` into `planTick`),
    `frontend/app/stationui.js` (preview shows local time + tz tag), `test/cron.dst.test.js` (NEW),
    `test/cron.api.test.js` (extended), `package.json` (append cron.dst test).
  - **Coordination/event note (NOT emitted this iteration — for the batched memory-cortex request):**
    `cron.fire` optional `tz` field and a `cron.skipped` reason `tz-recompute` would let the HUD show
    a fire's resolved zone / a DST recompute; built the tz logic WITHOUT new events as instructed.
    No `shared/events.js`/`shared/schema.js` edits (`git log feat/harness-backend.. -- shared/*` empty).

### G4.2 — Durable + atomic persistence (no double-fire on crash)  ·  STATUS: DONE
One-line task: make `saveCronJobs` (`index.js:665-668`) fsync the temp file BEFORE rename
(currently temp-write→rename with NO fsync — a crash in the advance-before-run window can lose
the rename / leave a zero-length file → double-fire), matching the ledger idiom
(`index.js:209-215`); per-pid+random tmp suffix; best-effort POSIX dir-fsync.
- **Acceptance (PERFECT STANDARD):**
  - ATOMIC (`test/cron.durability.test.js`): spy/mock fs on the ACTUAL `saveCronJobs`
    implementation (not a re-implementation) and assert `fsyncSync` precedes `renameSync`; a
    stale leftover `.tmp` does NOT corrupt load — `loadCronJobs` returns the last good envelope
    (fail-closed, `cron-store.js:204-210`); no zero-length jobs file ever observed.
  - CRASH-AT-FIRE-BOUNDARY (no double-fire across restart): `applyTick` fires an interval job
    (persists the ADVANCED `nextRunAt` via `setJobs` BEFORE launch), then WITHOUT settling the
    run a NEW driver over the SAME persisted store at the same `now` → `fire.length === 0`; the
    on-disk (post-fsync) `jobs.json` round-trips to the advanced `nextRunAt`.
- **Files:** `sidecar/index.js` (edit, HIGH — confine to the `saveCronJobs` block);
  `test/cron.durability.test.js` (NEW, low); `package.json` (edit, med — append test).
- **Notes:** Fail-closed. Single-file `writeFile` is the common atomic case.
- **DONE (2026-06-23, commit c2e284e..HEAD this lane).** `saveCronJobs` is now crash-SAFE: temp→**fsync**→rename
  instead of temp→rename. The durable-write primitive was FACTORED OUT into a new importable module
  `sidecar/durable-write.js` (`writeFileDurable({fs,path}, file, data)`) so the test exercises the ACTUAL
  implementation, not a re-implementation — `index.js` self-boots an HTTP server and cannot be `require`d by a unit
  test, so its closure-private `saveCronJobs` was un-testable in isolation; the helper is the testable seam.
  `saveCronJobs` now just delegates to it. The helper mirrors `savestore.js:writeAtomic` + the ledger/runs append
  idiom (`index.js:224-230`): open(tmp,'w')→writeSync→**fsyncSync BEFORE renameSync**→close, per-PID+random tmp
  suffix (`<file>.<pid>.<6-byte-hex>.tmp`) so concurrent writers / a CRUD save racing an advance never collide on
  the temp name, then a **best-effort POSIX directory fsync** after rename (open(dirname,'r')→fsync) wrapped so it
  NEVER throws on Windows (EISDIR/EPERM swallowed). fsync is capability-guarded — an in-memory test fs lacking
  `fsyncSync` degrades to `writeFileSync`→rename (still atomic). Happy-path behavior is identical to the old
  temp+rename (versioned envelope, atomic replace); the throw-on-failure contract the CRUD routes rely on is
  preserved (only the dir-fsync is swallowed). The nonce rng is INJECTED (`randomTmpId?`) defaulting to lazy
  `node:crypto.randomBytes` — no `Date.now`/`new Date()`/`Math.random` literal, so lint-determinism stays GREEN
  (74 files scanned, OK) even though the new module is in the scanned `sidecar/` root.
  - **loadCronJobs fail-closed — confirmed, no hardening needed.** `loadCronJobs` (`index.js`) reads ONLY the real
    `CRON_FILE` path and hands the string to `cronStore.loadEnvelope`, which JSON-parses inside try/catch and
    returns the last good `{version,jobs}` (or empty) on garbage/truncation/non-array (`cron-store.js:204-210`). A
    leftover `.tmp` is NEVER read by the load path (it only ever reads the canonical name), so a stale/partial
    `.tmp` cannot corrupt load. Tested all three: stale leftover `.tmp` beside a good file → good envelope (1 job);
    truncated real jobs file → empty (no half-record); non-array `jobs` → empty.
  - **Verified RED→GREEN** (`test/cron.durability.test.js`, NEW, 31 assertions). RED captured against a non-durable
    stub (plain temp+rename) with the corrected fs spy: **6 failures** — fsync absent, fsync-before-rename absent,
    no per-pid/random suffix, no POSIX dir-fsync (EXIT 1). GREEN after the real helper: `OK (31 assertions)` (EXIT 0).
    The 5 cases: (1) ATOMIC — an ordered fs-call spy over the REAL helper asserts `fsyncSync(tmpFd)` PRECEDES
    `renameSync`, the fsync targets the temp fd, the rename moves `*.tmp`→real path, and the real file is never
    observable zero-length; (2) per-pid+random suffix → two writes pick DISTINCT temp names both carrying the pid;
    (3) a throwing dir-fsync (simulated Windows EISDIR) does NOT fail the write; (4) FAIL-CLOSED LOAD — the three
    cases above; (5) CRASH-AT-FIRE-BOUNDARY — the REAL cron driver fires a due interval job, persists the ADVANCED
    `nextRunAt` through the actual durable write to a real file BEFORE the (never-settling) run, then a NEW driver
    over the SAME on-disk store at the SAME `now` fires ZERO (`r2.fired===0`), and the post-fsync envelope
    round-trips to the advanced `nextRunAt` (exactly one period out). Full `npm run test:fast` GREEN (EXIT 0, incl.
    the unchanged cron/cron-store/cron.tick/cron.dst suites — no regressions — + lint-emits + lint-determinism).
    `npm run test:http` GREEN (EXIT 0): `cron.api.test` (56 assertions) exercises the real cron CRUD routes →
    `saveCronJobs` → `writeFileDurable` on real `node:fs` end-to-end, confirming the happy path is byte-identical
    to callers. No route added; no `shared/events.js`/`shared/schema.js` edit; no new event emitted.
  - **Files:** `sidecar/durable-write.js` (NEW — the durable-write primitive), `sidecar/index.js` (`saveCronJobs`
    delegates to it + header comment), `test/cron.durability.test.js` (NEW), `package.json` (append the test after
    `cron.dst`).

### G4.3 — Cross-process / reentrancy exactly-once lock  ·  STATUS: DONE
One-line task: add (a) an in-process `tickInFlight` reentrancy guard in `cron-driver.applyTick`
and (b) a cross-process advisory lock (`WORKSPACES/cron.lock`) wrapping `applyTick` AND every
CRUD `saveCronJobs`/`setJobs` write, so two sidecars / a boot-reconcile racing the first tick /
a CRUD save racing an advance cannot double-fire or clobber (parity `.tick.lock` +
`.jobs.lock`). Make `setJobs` re-read-modify-write UNDER the lock (fixes the last-write-wins
mirror clobber).
- **Acceptance (PERFECT STANDARD):**
  - NAIVE double-tick: two back-to-back `applyTick` at the same instant produce a SINGLE
    `cron.fire`.
  - STALE-RECLAIM RACE (the bug the lock exists to prevent — TOCTOU): reclaim must be ATOMIC (a
    single atomic rename to a holder-stamped name, OR O_EXCL re-create after unlink with
    pid+nonce written then read-back-verified); the loser no-ops. Test: construct a STALE lock
    (old mtime), run TWO `applyTick` passes that BOTH attempt reclaim at the same `now`, assert
    exactly ONE `cron.fire` total. An in-process-only test does NOT satisfy this.
  - CRUD serialization: every `cronJobs=` assignment / CRUD write routes through the lock (audit
    `index.js:1235-1269`) — a concurrent CRUD save cannot clobber an advance.
- **Files:** `sidecar/cron-driver.js` (edit, low — `tickInFlight`); `sidecar/index.js` (edit,
  HIGH — `cron.lock` around `applyTick` `:1010-1011` + all CRUD saves; coordinate the
  E-STOP/halt block with G2's `connectors.close` as ONE halt-block change); `package.json`
  (edit, med). 
- **Notes:** Windows has no flock — use the portable O_EXCL+pid+nonce+read-back path with a
  `maxRunMs`-based stale break (mirror the existing lease reclaim) so a crashed holder never
  wedges cron forever. Avoid a new dep unless package policy allows.
- **DONE (2026-06-23, this lane after d45da9f).** Cron now fires EXACTLY ONCE across re-entrancy,
  two sidecars, a boot-reconcile racing the first tick, and a CRUD save racing an advance — three
  layers, all headless-proven RED→GREEN, no new dep, determinism-lint still GREEN.
  - **(a) In-process reentrancy guard** — a `tickInFlight` flag wraps the WHOLE `applyTick`
    (`cron-driver.js`): a re-entrant tick at the same instant returns `{fired:0,reentered:true}` and
    NEVER walks the plan/advance/fire-loop. Set on entry, cleared in a `finally` so a thrown
    plan/emit can't wedge the flag. (The existing lease already suppressed a duplicate *fire*, so the
    test asserts the guard's DISTINCT signal — `reentered:true` + ZERO second `cron.tick` — not a
    vacuous fired-count.)
  - **(b) Cross-process advisory lock** — NEW importable module `sidecar/cron-lock.js`
    (`makeCronLock({fs,path,lockfile,now,maxRunMs,pid?,nonce?}) -> {withLock,release,_internals}`),
    the testable seam (same pattern as `durable-write.js`). Portable **O_EXCL** (`open(lockfile,'wx')`)
    write `pid:nonce` → **READ-BACK-VERIFY** it's byte-for-byte ours (no flock — Windows can't). A
    `maxRunMs` **stale break** (mtime vs injected `now`) reclaims a crashed holder; a LIVE holder is
    respected (no premature reclaim). **ATOMIC RECLAIM (the TOCTOU fix):** the single mutual-exclusion
    step is `renameSync(lockfile -> lockfile.<pid>.<nonce>.reclaim)` — exactly ONE racer can move the
    ORIGINAL stale inode; every other racer's rename of that same source gets ENOENT and **no-ops**.
    Only the rename winner then O_EXCL-creates the fresh lock. **Re-entrant within one process**
    (depth-counted) so `applyTick(lock) -> setJobs -> saveCronJobs(lock)` nests without dropping the
    lock mid-tick; `release` only unlinks at depth 0 and only if the file still carries OUR stamp.
    Determinism-clean: `now`+`nonce`+`pid` injected (nonce defaults to lazy `node:crypto`), NO
    `Date.now`/`new Date()`/`Math.random` literal.
  - **(c) Lock wraps applyTick AND every CRUD write; setJobs/CRUD re-read-modify-write under the lock**
    (`index.js`): boot reconcile + every timer tick are `cronLock.withLock(() => applyTick(...))` (two
    sidecars / boot-vs-timer can't both fire — the non-holder no-ops). A new `withCronWrite(mutate)`
    helper does the **re-read-from-disk → apply mutate → durable save UNDER the lock** for all four
    CRUD sites (create/update+pause-resume/remove/run-now markRun) — fixing the last-write-wins
    clobber where a CRUD save on a STALE in-memory snapshot reverts an advance (→ double-fire). The
    driver's `setJobs` also persists under the lock (re-entrant nested in-tick; a bounded ~50ms spin +
    local-save fallback for the rare settle-after-tick cross-process contention so a run outcome is
    never silently lost). E-STOP `handleHalt` adds a standalone `cronLock.release()` (additive — G2
    will add `connectors.close` to the SAME block) so an E-STOP mid-tick never wedges the next tick.
  - **Verified RED→GREEN** (`test/cron.lock.test.js`, NEW, 27 assertions; each property shown to FAIL
    on a deliberately-broken tree then PASS): (1) reentrancy — RED with the `tickInFlight` guard
    disabled (`reentered` absent), GREEN with; (2) STALE-RECLAIM RACE — two distinct holders (pid:nonce
    101:AAA / 202:BBB) BOTH pass the stale check then BOTH attempt the atomic claim → RED with a
    non-atomic check-then-unlink-then-write claim (both "win", A=true B=true), GREEN with the atomic
    rename (exactly one moves the original, the loser ENOENTs); (3) end-to-end stale-reclaim via two
    real driver passes over one due store → exactly ONE `cron.fire` total; (4) CRUD serialization — a
    tick advances+persists under the lock, then a CRUD add done as re-read-modify-write under the lock
    keeps BOTH the advanced job and the new job (a control proves a naive stale-snapshot save WOULD
    revert the advance); (5) fresh-lock-not-reclaimed; (6) re-entrant nested withLock holds the lock
    through the inner release. Module-not-found was the initial RED before the file existed.
  - **Gates:** full `npm run test:fast` GREEN (EXIT 0 — no regressions to cron/cron.tick/cron-store/
    cron.dst/cron.durability; lint-emits + lint-determinism GREEN, 75 files scanned incl. the new
    `cron-lock.js`). `npm run test:http` GREEN (EXIT 0 — cron.api 56 assertions drive the real CRUD
    routes → `withCronWrite` → lock → durable save end-to-end on real `node:fs`). **LIVE smoke**
    (`npm start`, free port :8849/:8850, `SKYNET_CRON_ENABLED=1`, temp WORKSPACES): app boots clean,
    boot reconcile runs UNDER the lock (years-late routine → `cron.skipped reason "caught-up"`,
    no backlog burst), a due routine is planned+fired through the lock to the capability gate, the
    advance-before-run nextRunAt is persisted under the lock, and the lockfile is released cleanly
    between ticks (no wedge).
  - **Files:** `sidecar/cron-lock.js` (NEW — the advisory lock primitive), `sidecar/cron-driver.js`
    (`tickInFlight` reentrancy guard, `applyTick`→`applyTickInner` split), `sidecar/index.js`
    (`makeCronLock` import + construct + `withCronWrite` + lock-wrapped applyTick/setJobs + 4 CRUD
    sites + halt release), `test/cron.lock.test.js` (NEW), `package.json` (append cron.lock after
    cron.durability). No `shared/events.js`/`shared/schema.js` edit; no NEW event (the lock is
    internal). `git log feat/harness-backend..agent/parity-finish -- shared/*` stays empty.

### G4.4 — Retry proof + global concurrency cap  ·  STATUS: DONE
One-line task: add `SKYNET_CRON_MAX_PARALLEL` (default 4); in `applyTick`, if firing would
exceed the cap, DEFER the extra due jobs to the next tick (emit `cron.skipped` reason
`at-capacity`) WITHOUT advancing their `nextRunAt` (so they stay due); prove the existing
transient-retry path end-to-end.
- **Acceptance (PERFECT STANDARD):**
  - CAP: with `SKYNET_CRON_MAX_PARALLEL=1` and 3 jobs due, exactly 1 fires and 2 emit
    `cron.skipped` reason `at-capacity` and remain due next tick.
  - TRANSIENT RETRY (injected `runOnce` returning transient:true once then ok): assert backoff
    `nextRunAt`, `retryCount++`, NO `lastRunAt` advance, then success — proven, not assumed.
  - CATCH-UP UNCHANGED: a 10m-interval job 200s-late (<grace) fires exactly ONE catch-up; 83m-late
    (>>grace) fast-forwards + emits `cron.skipped` `caught-up` and fires ZERO (keep
    `cron.tick.test.js:158-178` / `cron.test.js:108-129` green after the lock/tz changes).
- **Files:** `sidecar/cron-driver.js` (edit, low — at-capacity deferral); `sidecar/cron-store.js`
  (edit, low); existing `test/cron.tick.test.js`/`cron.test.js` (extend). 
- **Notes:** Event additive: `cron.skipped` reason `at-capacity`, `cron.tick` optional `deferred`
  int — batched request.
- **DONE (2026-06-23, this lane commit 686c46c).** Global concurrency cap + transient-retry proof. The
  BEHAVIOR is proven and live; the at-capacity/deferred EMIT is PENDING the memory-cortex events batch (see
  the Pending events batch section) — proven via the return value instead this iteration.
  - **CAP (new behavior, RED→GREEN):** `SKYNET_CRON_MAX_PARALLEL` (default 4) is injected into the driver as
    `maxParallel` — NOT read from `process.env` in the pure `cron-driver.js`; threaded exactly like
    `maxRunMs`/`defaultTz` so the driver stays determinism-clean (lint-determinism GREEN over the 75 scanned
    `sidecar/` files; no `Date.now`/`Math.random`/`new Date()` added). In `applyTickInner`, BEFORE the
    advance-before-run write, `plan.fire` is partitioned by available slots = `maxParallel - leases.size`
    (currently-in-flight cron runs): each non-leased candidate reserves a slot in plan order; once slots are
    exhausted the remaining due jobs are DEFERRED. A deferred job is (a) NOT advanced — step 3 skips it via a
    `deferredSet`, so its `nextRunAt` stays put and it remains DUE; (b) NOT fired — step 5 skips it; (c)
    reported via the APPLYTICK RETURN VALUE: `{ fired, skipped, planned, deferred:[jobId,…] }`. An
    already-leased job is neither attempted nor deferred (it advances + reports `already-running` exactly as
    before). The deferred set drains `maxParallel` at a time over successive ticks as slots free — a burst of
    simultaneously-due routines never floods the run host / spend all at once.
  - **TRANSIENT RETRY (existing path, VERIFIED end-to-end, not rebuilt):** drove the real driver fire→settle
    loop with an injected `runOnce` that emits `agent.run.error{transient:true}` once then succeeds. The
    driver's sink books `state.transient`; `finishFire`→`cronStore.markRun` applies the EXISTING transient
    backoff: `nextRunAt = now + backoffMs (90s)`, `retryCount` 0→1, `lastRunAt` stays null (occurrence NOT
    finalized), `state:'error'` but `enabled` stays true (recurring never silently disabled). On the
    backed-off fire it succeeds → `retryCount` resets to 0, `lastRunAt` stamped, `lastStatus:'ok'`. All
    asserted, not assumed.
  - **CATCH-UP REGRESSION (unchanged):** the existing `cron.tick.test.js` cases 5/6 (10m-interval 200s-late
    `<grace` fires exactly ONE catch-up; ~83m-late `>>grace` fast-forwards + `caught-up` + fires ZERO) and
    `cron.test.js` cases 8/9 stay GREEN after the cap change.
  - **Return-shape note:** `applyTick` now ALWAYS returns a `deferred` array (`[]` when nothing deferred),
    including the reentrancy-guard early return. The 4 existing exact-equality `A.eq(summary,{…})` assertions
    in `cron.tick.test.js` were updated to include `deferred:[]` (reflecting the genuinely-new always-present
    field — counts unchanged, not a weakening). The `cron.tick` EMIT shape is UNCHANGED (`{fired,skipped,
    planned}`) — the `deferred` field is return-value-only this iteration (the emit field is pending the batch).
  - **Verified RED→GREEN** (`test/cron.tick.test.js`, extended to 89 assertions). RED on the pre-fix tree:
    `cap=1 -> exactly one fires — expected 1, got 3` (no cap), `summary.deferred is an array` (undefined →
    TypeError) — captured. GREEN after: `cron.tick: OK (89 assertions)`. Cases: (1) CAP=1 with 3 due → 1
    fires, `summary.deferred.length===2`, both deferred keep their old `nextRunAt` (still due), next tick
    fires 0 more while the run is in-flight; (2) CAP=2 headroom → 2 fire / 1 deferred, after the leases
    release the deferred job fires on the next tick and only THEN advances (deferral is a HOLD, not a drop);
    (3) transient-then-ok retry as above. Full `npm run test:fast` GREEN (EXIT 0 — no cron/cron-store/
    cron.tick/cron.dst/cron.durability/cron.lock regressions; lint-emits + lint-determinism GREEN). `npm run
    test:http` GREEN (EXIT 0 — the real sidecar boots and constructs the driver with the new `maxParallel`
    dep; cron.api 56 assertions). LIVE boot smoke (`SKYNET_CRON_ENABLED=1 SKYNET_CRON_MAX_PARALLEL=1`, free
    port :8861): boots clean, boot reconcile runs under the lock (stale routine → `caught-up`, no burst),
    tick armed, no errors — the new env var integrates without breaking boot.
  - **Files:** `sidecar/cron-driver.js` (inject `maxParallel`; cap partition + conditional advance + deferral
    in `applyTickInner`; `deferred` in both return paths), `sidecar/index.js` (`CRON_MAX_PARALLEL` env const
    + thread `maxParallel` into `makeCronDriver`), `test/cron.tick.test.js` (extend: cap + headroom + transient
    retry cases; `maxParallel` in the `setup` helper; `deferred:[]` on the 4 exact-eq return assertions). NOT
    `cron-store.js` (the transient path already existed — VERIFIED, not edited). NOT `package.json` (both test
    files already in `test:fast`). No `shared/events.js`/`shared/schema.js` edit; no NEW event emitted.
    `git log feat/harness-backend..agent/parity-finish -- shared/*` stays empty.

### G4.5 — One-shot fire-claim idempotency (explicit, tested policy)  ·  STATUS: DONE
One-line task: stamp a `fireClaim`/`lastFireAttemptAt` on a one-shot at fire time
(advance-before-run analog); `planTick` treats a one-shot with a FRESH claim (< `maxRunMs`,
no settlement) as not-due so a crash-restart inside the run window does NOT re-fire, while a
zombie past the ceiling does (analog of `claim_job_for_fire`, `jobs.py:1226-1271`).
- **Acceptance (PERFECT STANDARD):**
  - IN-FLIGHT vs SETTLED (the correctness hole the critique flagged): `markRun` CLEARS/supersedes
    `fireClaim` on settlement (success OR terminal failure) so the not-due guard ONLY suppresses
    re-fire while ACTUALLY in-flight. Test: a one-shot fires, the run returns transient-FAILURE
    inside the window → the NEXT `applyTick` re-arms via backoff (NOT suppressed by a stale
    fireClaim).
  - CRASH-IN-WINDOW: a one-shot fired, claim fresh, crash-restart inside the window → not
    re-fired; a zombie past `maxRunMs` IS reclaimed.
- **Files:** `sidecar/cron-store.js` (edit, low — additive `fireClaim` in `makeJob`/`markRun`);
  `test/cron.durability.test.js` or a sibling (extend). 
- **Notes:** Document the chosen at-most-once-within-window policy in the `cron.js` header.
- **DONE (2026-06-23, commit 7201d32).** A one-shot now fires AT MOST ONCE within its run window even across a
  crash-restart. Recurring jobs are protected by advance-before-run (persist the advanced `nextRunAt` before
  launch); a one-shot has no next fire to advance, so it gets the analog — a FIRE-CLAIM stamped + persisted
  BEFORE launch and cleared on settlement.
  - **`cron-store.js`** — `makeJob` gains the additive `fireClaim`/`lastFireAttemptAt` fields (both `null` on a
    fresh job; cron records are PLAIN internal objects, NOT governed by `shared/schema.js` — confirmed by grep —
    so this is a pure additive field, no memory-cortex request). NEW pure reducer `claimOnceFire(jobs, id, {now})`
    stamps `fireClaim = now` (the fire-instant ms) + `lastFireAttemptAt = iso(now)`. **`markRun` CLEARS `fireClaim`
    on EVERY settlement** — success, terminal failure, AND transient failure (set before both return paths) — so
    the not-due guard suppresses re-fire ONLY while the run is genuinely in flight. Stays determinism-clean (no
    `Date.now`/`new Date()`/`Math.random`; `now` injected).
  - **`cron.js` `planTick`** — a one-shot carrying a FRESH claim (`0 <= now-fireClaim < maxRunMs`, no `lastRunAt`)
    is treated as NOT due → no re-fire (a crash-restart INSIDE the window does not double-fire). A ZOMBIE claim
    (`age >= maxRunMs`, a crashed holder) falls through and re-fires (reclaim). `maxRunMs` injected via `opts`
    (default 8min). The SETTLED guard (`lastRunAt` set → ineligible) is unchanged. **The critic case:** a
    transient failure clears the claim and re-arms via the existing backoff `nextRunAt` — it is NOT suppressed by
    a stale claim (claim cleared + `lastRunAt` still null → fires at the backoff time). Policy documented in the
    `cron.js` header next to the G4.1 DST policy note.
  - **`cron-driver.js`** — threads `maxRunMs` into `planTick`; in the advance-before-run write (step 3) it also
    stamps the one-shot fire-claim via `cronStore.claimOnceFire` and persists it in the SAME `setJobs` (so the
    claim lands under the G4.3 cron-lock + G4.2 durable write, before launch). A deferred (G4.4 cap) or
    already-leased one-shot is NOT claimed this tick. A no-capability one-shot still gets a claim → a bounded
    ~`maxRunMs` backoff (not per-tick hammering), recovered by the zombie reclaim — intentional + documented.
    No `index.js` edit needed: `applyTick` (boot reconcile + timer) is the sole fire path and already persists via
    `setJobs` under the lock; the `/api/cron/preview` route is display-only.
  - **Verified RED→GREEN** (`test/cron.oneshot.test.js`, NEW, 51 assertions). RED on the unmodified tree: **13
    failures** — `fireClaim`/`lastFireAttemptAt` undefined, a fresh-claimed one-shot RE-FIRES inside the window
    (the bug), `markRun` does not clear the claim (real exit 1). GREEN after: `OK (51 assertions)`. Cases: (0)
    makeJob fields null; (1) planTick PURE — unclaimed-due fires, fresh-claim suppressed, zombie-claim reclaimed,
    settled never re-fires; (2) CRASH-IN-WINDOW end-to-end via the REAL driver + durable persistence — claim
    persisted before the never-settling run, a NEW driver over the same on-disk store INSIDE the window fires
    ZERO, a NEW driver PAST the ceiling re-fires (zombie); (3) IN-FLIGHT vs SETTLED at the reducer — `markRun`
    clears the claim for transient / terminal-success / terminal-failure, and the transient case re-arms via
    backoff; (4) end-to-end transient re-arm through the driver (fire → transient settle clears claim → re-fire
    at the backoff time → success finalizes); (4b) no-capability bounded-backoff + zombie recovery; (5)
    interval-job REGRESSION unaffected. Full `npm run test:fast` GREEN (EXIT 0 — no cron/cron.tick/cron.dst/
    cron.durability/cron.lock regressions; lint-emits + lint-determinism GREEN, 75 files). `npm run test:http`
    GREEN (EXIT 0 — cron.api 56 assertions round-trip the additive fields through the real CRUD routes). **LIVE
    boot smoke** (`SKYNET_CRON_ENABLED=1`, free port :8847, temp WORKSPACES): boots clean — "cron enabled — 1
    routine(s); running boot reconcile", "cron tick armed (60s)", no errors.
  - **Files:** `sidecar/cron-store.js` (fields + `claimOnceFire` + `markRun` clear + header), `sidecar/cron.js`
    (`planTick` claim guard + header policy), `sidecar/cron-driver.js` (thread `maxRunMs` + stamp claim in the
    advance-before-run write), `test/cron.oneshot.test.js` (NEW), `package.json` (append the test after
    `cron.lock`). No `shared/events.js`/`shared/schema.js` edit (`git log feat/harness-backend..agent/parity-finish
    -- shared/*` stays empty); no NEW event emitted (the claim is internal job state, not an event).

### G4.6 — Honest disabled-state + one-click enable  ·  STATUS: DONE
One-line task: when the scheduler is OFF, show a one-click ENABLE control that arms the timer
WITHOUT a manual env edit + restart (prefer a persisted app-data `cronArmed` flag the boot block
ORs with `SKYNET_CRON_ENABLED`, NOT runtime `process.env` mutation), then re-render
"● scheduler armed".
- **Acceptance (PERFECT STANDARD):**
  - INERT-WHEN-OFF invariant (must not regress): for a user who never enables cron, the off-state
    stays fully inert — the "byte-identical browser path when off" guarantee holds (assert no
    timer armed, no behavior change). A toggle that arms must not change the off-path.
  - LIVE: toggle ENABLE in the running app → a due job fires within ONE tick; UI flips
    `○ scheduler is OFF` (`stationui.js:1301`) → `● scheduler armed`; `GET /api/cron` reflects
    `enabled`.
- **Files:** `frontend/app/stationui.js` (edit, med — `buildRoutines`, one-click enable + honest
  badge); `sidecar/index.js` (edit, HIGH — boot block reads the persisted flag; new toggle route
  → run `test:http`). 
- **Notes:** A persisted `cronArmed` flag OR'd at boot is cleaner than mutating `process.env` and
  preserves the documented boot-frozen gate semantics.
- **DONE (2026-06-23, commit cfa45b4).** The scheduler can now be enabled with ONE click in the UI —
  no env edit, no restart — while staying fully INERT for a user who never enables it. **G4 (all 6
  items) is COMPLETE.**
  - **Persisted arm flag** — `WORKSPACES/cron.armed.json` (`{version:1, armed:bool}`), written through the
    G4.2 `writeFileDurable` helper (durable temp→fsync→rename, protected sibling of the fs jail like
    `cron.jobs.json`); `loadCronArmed()` is FAIL-CLOSED (missing/corrupt/non-boolean → false, so an unreadable
    flag never silently arms). The boot block computes the initial armed state as
    `cronArmed = CRON_ENABLED || loadCronArmed()` — the env var still wins (boot-frozen master switch), the
    persisted flag adds the runtime path. **`process.env` is NEVER mutated at runtime** (the anti-pattern the
    plan calls out): the persisted file is the durable record, an in-memory `cronArmed` bool the live state.
  - **Runtime arm/disarm** — the boot arming was refactored into idempotent `armCron()` (run ONE immediate
    reconcile UNDER the G4.3 cross-process lock — catching up missed fires at-most-once-within-grace, no
    backlog — then arm the interval; no-op if a timer already runs) / `disarmCron()` (clear the interval). New
    privileged route **`POST /api/cron/arm {enabled:bool}`** persists the flag durably FIRST, sets the live
    `cronArmed`, then `armCron()`/`disarmCron()` so a due job fires within ONE tick of enabling with NO restart
    and disabling stops the timer immediately. **Guarded by the SAME `x-starnet-token` gate as the cron CRUD
    routes** — `rejectBadApiToken` runs before dispatch for every `/api/*` POST except
    `/api/session|/api/key|/api/save`, so a cross-site browser call can't arm the autonomous scheduler (NOT a
    weaker hand-rolled guard). The frontend `fetch` is already token-hardened (`harness.js` monkey-patch
    auto-injects `X-StarNet-Token`), so no UI token plumbing was needed.
  - **GET /api/cron `enabled`** now reports the live `cronArmed` (was boot-frozen `CRON_ENABLED`) so the panel
    reflects a runtime arm/disarm immediately. The cron.api.test `enabled:false` assertion still holds (cron
    off → `cronArmed` false).
  - **Honest UI** (`stationui.js` `buildRoutines.refresh`) — OFF shows a RED `○ scheduling is OFF — routines
    will NOT fire.` badge + a one-click `▶ ENABLE SCHEDULING` button (posts the arm route, then re-renders from
    the authoritative GET); ON shows `● scheduler armed` + a `⏸ DISABLE SCHEDULING` control. Replaced the old
    dim "set SKYNET_CRON_ENABLED=1" hint (which told the user to edit env + restart — the lie this closes).
  - **INERT-WHEN-OFF preserved (the must-not-regress invariant):** no env var + no `cron.armed.json` →
    `cronArmed=false` → `if (cronArmed) armCron()` no-ops → no timer armed, the off-path is byte-identical for
    a user who never enables cron. Asserted directly (no "cron tick armed" / no `[cron] cron.tick` log over a
    multi-tick window with cron off).
  - **Verified RED→GREEN** (`test/cron.arm.test.js`, NEW, 25 assertions, in `test:http`). RED on the pre-fix
    tree (stashed `index.js`): `POST /api/cron/arm -> 404`, `enabled` never flips, no `cron.armed.json`
    persisted (exit 1); the inert-when-off + token-guard 403 assertions PASSED even pre-fix (the invariants
    that must not regress — and don't). GREEN after: `OK (25 assertions)`. Cases: (1) INERT-WHEN-OFF — boot OFF
    → `enabled:false`, no flag file, no timer armed, a due routine never ticks over a multi-tick window;
    (2) TOKEN GUARD — arm without `X-StarNet-Token` → 403, enabled unchanged; (3) RUNTIME ARM — arm flips
    `enabled:true`, persists `armed:true`, and the LIVE timer ticks a DUE one-shot within one tick (the
    non-mockable `[cron] cron.tick` signal — no key → no-capability path → zero spend); (4) RUNTIME DISARM —
    flips off, persists `armed:false`, no further ticks run; (5) ARM-AT-BOOT — a persisted `armed:true` arms
    the scheduler at boot (enabled:true + "cron tick armed") with NO `SKYNET_CRON_ENABLED`. Full `npm run
    test:fast` GREEN (EXIT 0 — no cron-suite/lint regressions, lint-determinism/lint-emits GREEN over 75
    files; `index.js` is the lint-exempt composition root). `npm run test:http` GREEN (EXIT 0 — cron.api 56
    assertions unchanged + cron.arm 25). **LIVE-WATCHED** (`npm start`, free port :8873, temp WORKSPACES,
    cron OFF): boot prints no "cron tick armed" (inert); `GET /api/cron` → `enabled:false`; the served
    `stationui.js` carries the new OFF-badge + ENABLE control; arm route → `{ok:true,enabled:true}`, GET flips
    `enabled:true`, the boot-reconcile ticks the due past one-shot within one tick
    (`[cron] cron.tick {fired:0,skipped:1,planned:1}` + `cron.skipped no-capability` — zero spend),
    `cron.armed.json` = `{"version":1,"armed":true}`; disarm → `enabled:false`, `cron tick DISARMED`,
    `armed:false`; a bad body (no `enabled`) → 400; arm without token → 403. The honest OFF badge + ENABLE
    button also rendered in a real Chromium DOM.
  - **Files:** `sidecar/index.js` (persisted `cronArmed` store + `armCron`/`disarmCron` + boot-OR + `POST
    /api/cron/arm` route + GET reports live `cronArmed`), `frontend/app/stationui.js` (`buildRoutines` honest
    OFF/ON badge + one-click enable/disable), `test/cron.arm.test.js` (NEW), `package.json` (append
    `cron.arm.test` to `test:http`). No `shared/events.js`/`shared/schema.js` edit
    (`git log feat/harness-backend..agent/parity-finish -- shared/*` stays empty); no new event emitted (the
    arm state in `GET /api/cron` is sufficient — no `cron.armed` telemetry event was added or emitted).

---

## GOAL G5 — fs multi-hunk patch (V4A, validate-then-apply, atomic)  ·  STATUS: TODO
> PARITY TARGET: the reference harness's V4A patch tool — multi-hunk, two-phase (validate ALL before any write),
> all-or-nothing, with a fuzzy matcher (`fuzzy_match.py`). StarNet's `fs.edit`
> (`fs.js:137-158`) is a single global `split().join()` find/replace — no hunks, no context, no
> fuzz, no atomicity. **DECISION: ADD a NEW `fs.patch` tool; do NOT overload `fs.edit`** (its
> `{path,find,replace}` schema + "replace every occurrence" semantics are load-bearing for
> existing callers/tests; overloading risks regressing the simple path and confusing tool-choice).
> Mirrors the reference harness keeping `patch_replace` separate from V4A.

### G5.1 — `patchparse.js` + `fuzzymatch.js` (V4A parser + strategy ladder)  ·  STATUS: TODO
One-line task: port `parse_v4a_patch` (the exact V4A format: `*** Begin/End Patch`,
`*** Update/Add/Delete/Move File:`, `@@ context @@`, ` `/`-`/`+` prefixes) into a new
`patchparse.js`, and a pure-Node `fuzzy_find_and_replace` subset (exact → line_trimmed →
whitespace_normalized → indentation_flexible → block_anchor) with the uniqueness guard and
reindent-on-non-exact into `fuzzymatch.js`. Both UMD-shaped like `fs.js`.
- **Acceptance (PERFECT STANDARD):**
  - MALFORMED rejection (`test/fs.patch.test.js`): no `*** Update File:` header / UPDATE with
    zero hunks / MOVE without `-> dst` → clear error, returns (never throws), writes NOTHING.
  - WHITESPACE/FUZZY tolerance: a hunk with 2-space-vs-4-space drift still applies via the ladder
    AND the written result keeps the FILE's indentation (reindent), not the patch's; the
    uniqueness guard errors "provide more context" when >1 match and not replaceAll.
- **Files:** `sidecar/tools/builtin/patchparse.js` (NEW, low); `sidecar/tools/builtin/fuzzymatch.js`
  (NEW, low); `test/fs.patch.test.js` (NEW, low).
- **Notes:** Defer unicode/escape-drift strategies (noted parity gap — they salvage LLM
  serialization artifacts; fail-closed is safer than silent corruption). Keep the reference harness's conservative
  thresholds (0.50 unique / 0.70 multi).

### G5.2 — `fs.patch` tool (jailed, two-phase, buffer-then-flush atomic)  ·  STATUS: TODO
One-line task: add `fs.patch` (`capability:'cabinet'`, `scope:'write'`, `requiresConsent:true`,
schema `{patch:string}`) to `makeFsTools` + the register list (`fs.js:319-323`); jail every op
path AND MOVE dst via `resolveInside` (`fs.js:46`); PHASE-1 validate all hunks in order against a
simulated buffer (no writes); PHASE-2 apply to in-memory buffers, enforce `WRITE_BYTES`
(`fs.js:36`), buffer ALL results, then flush (abort before the first `writeFile` if any step
fails).
- **Acceptance (PERFECT STANDARD):**
  - MULTI-HUNK: a patch touching TWO hunks in one file applies BOTH (read-back proves both
    edits).
  - ATOMIC ROLLBACK: a patch whose first hunk matches but second does NOT leaves the file
    BYTE-IDENTICAL to before (read-back equals original) and returns an error — no partial
    writes.
  - JAIL: a `../escape` / absolute / drive-letter path is rejected BEFORE any I/O (file
    untouched) — reuses `resolveInside`.
  - `fs.edit` UNCHANGED: existing `test/fs.jail.test.js:64-72` still passes (schema + semantics
    preserved).
- **Files:** `sidecar/tools/builtin/fs.js` (edit, med — add `patchTool` + register `:319-323` +
  expose `{parsePatch, fuzzyFind}` on `_internals` `:321`; additive, `fs.edit` untouched;
  board-check — `agent/hermes-parity` fs.search v2 territory, 27h); `test/fs.patch.test.js`
  (extend); `package.json` (edit, med — append test).
- **Notes:** No git in the jail (the reference harness leans on git for phase-2 recovery); buffer-then-flush is
  the honest atomicity primitive. Multi-file mid-flush is a theoretical partial-write window
  (no cross-file fsync transaction) — acceptable for a workspace jail, single-file patches fully
  atomic; note it. NO new events.

---

## GOAL G6 — Spend + model honesty  ·  STATUS: TODO
> Two lies. (A) `/api/insights` shows `(unknown)` models because the Codex path lets the provider
> silently substitute `DEFAULT_MODEL` while `runStore.record` books the empty `o.model`
> (`index.js:1869`/`1519`). (B) A live ~900k-token run renders `$0` because Codex-OAuth is
> UNMETERED (`priceOf()→null`, `normalizeUsage` hardcodes `cost:0`, `codex.js:362,381`) and a
> cold OpenRouter catalog prices $0 — both rendered as a misleading $0 instead of "unmetered" or
> the real cost. **Coordinate with `agent/hermes-parity` (runstore.js/insights.js = its H3.3
> territory, 4h) — board-check + rebase same-session.**

### G6.1 — Book a real model + consistent usd on EVERY path  ·  STATUS: TODO
One-line task: in `runOnce` compute an `effectiveModel` (trim `o.model`; else Codex
`DEFAULT_MODEL`; else `SKYNET_DEFAULT_MODEL`; prefer `result.model` if the loop surfaces it) and
book THAT; compute `effectiveUsd` ONCE upstream of BOTH `ledger.record` (`index.js:1864`) and
`runStore.record` (`:1869`) with the cold-catalog backfill (re-resolve `priceOf` when usd===0 &&
tokens>0 && no usage.cost && a price now resolves) so the two writes get IDENTICAL values.
- **Acceptance (PERFECT STANDARD):**
  - REAL MODEL EVERY PATH: an index-level test that a Codex run with `o.model=''` RECORDS
    `DEFAULT_MODEL` (asserts the `runOnce` record call, not just insights folding); a runstore
    round-trip shows non-empty `model` for browser/channel/cron/delegated paths.
  - NO `(unknown)`: `test/insights.test.js` byModel for rows with real slugs shows those slugs and
    ZERO `(unknown)` entries (given non-empty models).
  - LEDGER↔RUNSTORE↔INSIGHTS CONSISTENCY (double-book guard): a cold-catalog run with tokens>0,
    usd===0 at first, `priceOf` resolving post-warm records a NON-zero usd, and the ledger pool
    delta === the runStore row usd === insights byModel usd for that run (computed ONCE upstream;
    backfill overwrites ONLY when usd===0 && no usage.cost — never double-adds onto a correct
    usage.cost).
- **Files:** `sidecar/index.js` (edit, HIGH — minimal additive diff localized to `runOnce`'s
  finally record block `:1860-1875`); `sidecar/runstore.js` (edit, med — backstop only, real fix
  upstream); `test/runstore.test.js` (extend); `test/insights.test.js` (extend); `package.json`
  (edit, med).
- **Notes:** `(unknown)` stays ONLY as a last resort and should disappear for live runs.

### G6.2 — Render Codex-OAuth as "unmetered", split aggregates honestly  ·  STATUS: TODO
One-line task: persist an additive `unmetered` flag on the run record (true when `usingCodex`);
in `insights.js foldInsights` exclude unmetered $0 from ALL usd aggregates while still counting
runs/tokens, and label the row "subscription / unmetered".
- **Acceptance (PERFECT STANDARD — consistent across ALL five aggregates):**
  - LABELING: a Codex-OAuth run (`unmetered:true`, usd:0, tokens>0) is labeled
    "subscription / unmetered" (or carries `unmetered:true`) and is NOT summed into metered
    `totalUsd` as a real $0 (`test/insights.test.js` + `test/runstore.test.js` round-trip).
  - PER-AGGREGATE CONSISTENCY (the new-lie guard): for a MIXED metered+unmetered row set, assert
    each of `totalUsd`, `byModel.usd`, `byAgent.usd` (`:45`), `overTime.usd` (`:55`) EXCLUDES
    unmetered $; and `avgUsdPerRun` (`:66`) divides metered USD by the METERED run count (NOT
    `totalRuns`) — or is relabeled. Unmetered rows contribute to run COUNTS and token totals
    everywhere, to USD nowhere.
- **Files:** `sidecar/runstore.js` (edit, med — additive `unmetered` field; row shape governed by
  cortex-memory → request the additive field); `sidecar/insights.js` (edit, HIGH — fold split,
  coordinate with hermes-parity); `test/insights.test.js` / `test/runstore.test.js` (extend).
- **Notes:** Event/field additive — `unmetered` requested in the batch if the row shape is
  schema-governed. `runstore.js`/`insights.js` are not under `shared/` so editable, but announce
  the field.

---

## Cross-goal ordering + coordination

**Recommended lane:** `agent/parity-finish` (one lane for ALL of G1/G2/G4/G5/G6 — do NOT split G1
into two lanes; the two G1 recon reports contradicted on tool/file/capability and would
double-register).

**Serialization + dependency constraints:**
1. **Events batch first.** ALL additive `shared/events.js` requests — G1 (`browser.*`/
   `computer.*`), G4 (`cron.skipped` reasons `at-capacity`+`tz-recompute`, `cron.tick.deferred`,
   `cron.fire.tz`), G6 (`unmetered` field if governed) — go in ONE request to `agent/memory-cortex`,
   merge to trunk FIRST, then sync + consume. Emitting an un-widened enum/event fails the
   validator. G2 needs no events.
2. **`package.json test:fast` is a single 2727-char line edited by G1 (≤2 tests), G2 (1), G4 (≥2),
   G5 (1), G6 (test edits) → guaranteed serial rebase conflicts.** Either serialize the appends
   through ONE coordinating commit per merge, OR refactor `test:fast` to a multi-line manifest
   FIRST (coordinate that refactor before any append; if done, it lands first and every item
   rebases onto it).
3. **`sidecar/index.js` region ownership.** G1 (registration), G2 (import + manager `:647-650` +
   `/api/connectors :1082-1099` + `handleHalt :1919-1924`), G4 (`saveCronJobs :665-668` +
   `cron.lock` + host-tz + MAX_PARALLEL + boot-flag), G6 (`runOnce` finally `:1860-1875`) touch
   DIFFERENT regions — assign non-overlapping line-regions up front, land as separate small
   pathspec commits. **G2's `handleHalt` (`connectors.close`) and G4's halt edit are ONE
   coordinated halt-block change.**
4. **G4 lock atomicity is indivisible.** The `cron.lock` must wrap `applyTick` AND every CRUD
   `saveCronJobs`/`setJobs` in the SAME change — partial adoption leaves the clobber bug. Cannot
   split across merges.
5. **G6 usd is computed ONCE** upstream of both `ledger.record` and `runStore.record` — the two
   calls cannot be edited in independent commits or they book different usd.
6. **Within G1: `browser.js` lands green BEFORE `computer.js`** (native-Node/low-risk first;
   computer depends on external cua-driver/nut.js). The `remote` cap + exec-lockout wiring in
   `permissions.js`/`capability/registry.js` must be in place before EITHER tool is reachable on
   an autonomous surface.
7. **G1 frontend capability-OBJECT surfacing is a SEPARATE later lane**, AFTER the backend tools
   land green — it serializes against `agent/crew-sentience` (world.js, 50m) and
   `agent/workstation-ui` (build.js/propsprites.js). It must NOT be bundled into this lane's merge.

**Board-check protocol:** before EVERY edit session and again immediately before each merge, from
the integration tree run `node scripts/board.mjs --files <substr>` for each hot target. MANDATORY
files (revival-risk): `sidecar/index.js`, `sidecar/capability/registry.js`, `sidecar/runstore.js`,
`sidecar/insights.js` (hermes-parity, 3–4h — explicitly coordinate before touching its actively-
iterated files), `sidecar/permissions.js` (exec-spine), `sidecar/mcp/manager.js` (mcp lane),
`frontend/app/world.js` (crew-sentience/workforce-zones/state-integrity — PREFER not touching;
route presentation through props instead), `frontend/app/app.js` (state-integrity/onboarding-
remaster), `frontend/app/stationui.js`. The three NEW backend files (`browser.js`, `computer.js`,
`transport.stdio.js`) are verified free of existing owners but RE-check at merge in case another
lane adds the same path. `board.mjs` only sees uncommitted/ahead-of-trunk state — combine with
`git log -1 -- <file>` recency for the full picture. Keep the lane SHORT, land NEW files first,
merge in small increments.

### Pending events batch (to agent/memory-cortex)

> ADDITIVE-only `shared/events.js`/`shared/schema.js` requests accumulated by this lane. They are
> NOT self-edited (CLAUDE.md/plan rule 6) — they go to the memory-cortex owner in ONE batched
> round-trip, merge to trunk FIRST, then this lane syncs and starts emitting them. Until then the
> corresponding behavior is proven via return values/state, never by emitting an un-widened
> enum/field (which would fail `validate()` at the bus boundary and `test/lint-emits.js`). Each item
> below is back-compat: a NEW enum value or a NEW optional field, never a rename/removal.

- **`cron.fire` — add optional `tz` field** (string). _Source: G4.1._ Lets the HUD show a fire's
  resolved IANA zone. Current `cron.fire` = `obj(['jobId','runId'], { jobId, runId, scheduledFor })`
  → add `tz: str` (optional). NOT emitted yet.
- **`cron.skipped` — widen `reason` enum with `tz-recompute`.** _Source: G4.1._ Marks a DST-driven
  next-fire recompute. Current enum =
  `['already-running','disabled','caught-up','no-capability','stale-lock-reclaimed']`. NOT emitted yet.
- **`cron.skipped` — widen `reason` enum with `at-capacity`.** _Source: G4.4._ Marks a due job DEFERRED
  because the live in-flight cron-run count is at `SKYNET_CRON_MAX_PARALLEL`. Same enum as above. The
  reason is currently ENUM-GOVERNED, so emitting `at-capacity` today would fail the validator/lint —
  the deferral is reported via the `applyTick` return value (`{…, deferred:[jobId,…]}`) until this
  widening lands. NOT emitted yet.
- **`cron.tick` — add optional `deferred` field** (int). _Source: G4.4._ The per-tick count of
  at-capacity deferrals, for the war-room pulse. Current `cron.tick` =
  `obj(['fired','skipped'], { fired, skipped, planned })` → add `deferred: int` (optional). The driver
  computes it but keeps it off the EMIT (return-value only) until this lands. NOT emitted yet.

## Progress Log
- _(the loop appends one dated line per iteration here)_
- 2026-06-23 — **G4.1 Timezone/DST correctness: DONE.** Added optional IANA `tz` to cron schedules;
  local wall-clock matching via a pure `Intl.DateTimeFormat` minute-scan with an offset-drift repair
  branch (spring-forward NONEXISTENT → fire once at the post-transition equivalent; fall-back
  AMBIGUOUS → fire once at the first occurrence). Host tz captured once at boot (`CRON_HOST_TZ`,
  injected `defaultTz`); tz typo → 400 (no silent UTC fallback); default UTC keeps old behavior
  byte-identical. RED→GREEN proven (`test/cron.dst.test.js`, 22 fails pre-fix → 29 pass post-fix);
  full `test:fast` + `test:http` GREEN; lint-determinism/lint-emits GREEN; live `/api/cron/preview`
  smoke returns `tz`+`localNext` ("9:00 AM EDT"). No shared-contract edits; no new events emitted
  (noted `cron.fire.tz` / `cron.skipped:tz-recompute` for the later batch). Next: **G4.2** (durable +
  atomic cron persistence — fsync-before-rename in `saveCronJobs`).
- 2026-06-23 — **G4.2 Durable + atomic cron persistence: DONE.** `saveCronJobs` is now crash-SAFE —
  temp→**fsync→rename** instead of temp→rename, so a crash in the advance-before-run window can no longer
  lose the rename or leave a zero-length jobs file (→ double-fire). Factored the durable-write primitive into
  a NEW importable module `sidecar/durable-write.js` (`writeFileDurable({fs,path}, file, data)`) so the test
  exercises the ACTUAL code path (index.js self-boots a server and can't be required); `saveCronJobs`
  delegates to it. Mirrors `savestore.js:writeAtomic`+the ledger append idiom: open(tmp,'w')→writeSync→
  fsyncSync(tmpFd) **before** renameSync→close, per-PID+random tmp suffix (no concurrent-writer collision),
  best-effort POSIX dir-fsync after rename (Windows-safe, swallowed). fsync capability-guarded (in-memory fs
  degrades to writeFileSync→rename, still atomic); nonce rng INJECTED defaulting to lazy `node:crypto` →
  lint-determinism stays GREEN. Confirmed `loadCronJobs`/`loadEnvelope` already fail-closed (reads only the
  real path; a stale `.tmp`/truncated/non-array → last good or empty; no hardening needed). RED→GREEN proven
  (`test/cron.durability.test.js`, NEW, 31 assertions: 6 fails vs a non-durable stub → `OK (31)`); cases =
  fsync-precedes-rename via an ordered fs spy over the REAL helper, no zero-length window, per-pid suffix,
  Windows dir-fsync swallow, fail-closed load, and CRASH-AT-FIRE-BOUNDARY (driver advances+persists durably,
  then a fresh driver over the same on-disk store at the same `now` fires ZERO; envelope round-trips to the
  advanced nextRunAt). Full `npm run test:fast` GREEN (EXIT 0, no cron/cron.tick/cron-store/cron.dst
  regressions, lint-determinism/lint-emits GREEN); `npm run test:http` GREEN (cron.api 56 assertions exercise
  the real CRUD routes → durable save end-to-end). No route added; no `shared/*` edits; no new event emitted.
  Next: **G4.3** (cross-process / reentrancy exactly-once lock — `tickInFlight` + `WORKSPACES/cron.lock`).
- 2026-06-23 — **G4.3 Cross-process / reentrancy exactly-once lock: DONE.** Cron now fires EXACTLY ONCE across
  (a) in-process re-entrancy — a `tickInFlight` guard wraps the whole `applyTick` (re-entrant tick → no-op,
  `reentered:true`); (b) two sidecars / boot-reconcile-racing-the-timer — a NEW portable advisory lock
  `sidecar/cron-lock.js` (O_EXCL `pid:nonce` + read-back-verify, no flock; `maxRunMs` stale break;
  **ATOMIC stale reclaim = a single `renameSync` of the original stale inode, the loser ENOENTs and no-ops** —
  the TOCTOU fix; re-entrant depth-counted so applyTick→setJobs→saveCronJobs nests); (c) a CRUD save racing an
  advance — `withCronWrite(mutate)` does a re-read-from-disk → apply → durable-save UNDER the lock for all four
  CRUD sites + the lock wraps boot reconcile + every timer tick + the driver's `setJobs`, killing the
  last-write-wins clobber that reverted an advance (→ double-fire). E-STOP `handleHalt` gets a standalone
  additive `cronLock.release()` (G2 will add `connectors.close` to the same block). RED→GREEN proven per
  property (`test/cron.lock.test.js`, NEW, 27 assertions: reentrancy-guard-off RED; non-atomic-reclaim RED with
  both holders winning A=true/B=true; CRUD-clobber control). Full `test:fast` GREEN (EXIT 0, no cron-suite
  regressions, lint-determinism GREEN over 75 files incl. the new module); `test:http` GREEN (EXIT 0, cron.api
  56 assertions through the real CRUD routes → lock → durable save). LIVE `npm start` smoke (cron enabled, free
  port): boots clean, reconcile + ticks run under the lock, advance persisted, lockfile released between ticks.
  No `shared/*` edit; no new event. Next: **G4.4** (retry proof + global concurrency cap — `SKYNET_CRON_MAX_PARALLEL`).
- 2026-06-23 — **G4.4 Retry proof + global concurrency cap: DONE (commit 686c46c).** Added
  `SKYNET_CRON_MAX_PARALLEL` (default 4), INJECTED into the cron driver as `maxParallel` (not read from
  `process.env` in the pure `cron-driver.js` — threaded like `maxRunMs`/`defaultTz`, so lint-determinism stays
  GREEN). In `applyTickInner`, when the due set would push the live in-flight cron-run count (`leases.size`)
  over the cap, the extra due jobs are DEFERRED to the next tick WITHOUT advancing their `nextRunAt` (they stay
  DUE and drain `maxParallel` at a time over successive ticks). The deferral is OBSERVABLE via the `applyTick`
  RETURN VALUE — `{ fired, skipped, planned, deferred:[jobId,…] }` — so it is testable without a new event; the
  additive at-capacity EMIT (`cron.skipped` reason `at-capacity` + a `cron.tick.deferred` int) is PENDING the
  memory-cortex events batch because the `reason` enum is governed (emitting it would fail the validator /
  lint-emits). Also PROVED the EXISTING transient-retry path end-to-end through the real driver fire→settle
  loop (verified, not rebuilt): transient-once-then-ok → `nextRunAt` backs off (now+90s), `retryCount` 0→1, no
  `lastRunAt` advance, stays enabled; the backed-off retry then succeeds → `retryCount` resets, `lastRunAt`
  stamped, `lastStatus:'ok'`. Catch-up regressions (within-grace fires one; beyond-grace fast-forwards zero)
  kept GREEN. RED→GREEN proven (`test/cron.tick.test.js`, extended to 89 assertions: pre-fix RED `cap=1 →
  expected 1 got 3` + `summary.deferred` undefined; post-fix `OK (89)`). Full `npm run test:fast` GREEN (EXIT 0,
  no cron-suite regressions, lint-emits + lint-determinism GREEN); `npm run test:http` GREEN (EXIT 0, the real
  sidecar boots + constructs the driver with the new dep, cron.api 56 assertions). LIVE boot smoke
  (`SKYNET_CRON_ENABLED=1 SKYNET_CRON_MAX_PARALLEL=1`, free port :8861): boots clean, reconcile under the lock,
  tick armed, no errors. No `shared/events.js`/`shared/schema.js` edit; no NEW event emitted (added the 4
  items to the Pending events batch section). Files: `sidecar/cron-driver.js`, `sidecar/index.js`,
  `test/cron.tick.test.js`. Next: **G4.5** (one-shot fire-claim idempotency).
- 2026-06-23 — **G4.5 One-shot fire-claim idempotency: DONE (commit 7201d32).** A one-shot (non-recurring) routine
  now fires AT MOST ONCE within its run window even across a crash-restart. The advance-before-run trick has no
  analog for a one-shot (no next fire to advance), so it gets a FIRE-CLAIM: the driver stamps `fireClaim` (=
  fire-instant ms) + `lastFireAttemptAt` via the new `cronStore.claimOnceFire` reducer and persists it in the SAME
  advance-before-run write (under the G4.3 lock + G4.2 durable write), BEFORE launch. `planTick` then treats a
  one-shot with a FRESH claim (`age < maxRunMs`, no `lastRunAt`) as NOT due — a crash-restart inside the window
  does not re-fire — while a ZOMBIE claim (`age >= maxRunMs`) is reclaimed and re-fires. **Critic case handled:**
  `markRun` CLEARS `fireClaim` on EVERY settlement (success / terminal failure / transient failure), so the guard
  suppresses re-fire ONLY while in flight; a transient-failed one-shot clears its claim and re-arms via the normal
  backoff `nextRunAt` (NOT suppressed by a stale claim). Policy documented in the `cron.js` header next to the DST
  note. Additive-only: `fireClaim`/`lastFireAttemptAt` are plain internal record fields — cron records are NOT
  governed by `shared/schema.js` (grep-confirmed), so no memory-cortex request; no new event (internal job state).
  RED→GREEN proven (`test/cron.oneshot.test.js`, NEW, 51 assertions: 13 fails on the unmodified tree — fields
  absent, fresh claim re-fires, markRun doesn't clear — → `OK (51)`); cases cover pure-planTick fresh/zombie/
  settled suppression, CRASH-IN-WINDOW + zombie reclaim end-to-end via the real driver + durable persistence,
  in-flight-vs-settled claim-clear for transient/terminal-success/terminal-failure, end-to-end transient re-arm
  through the driver, no-capability bounded-backoff, and an interval-job regression. Full `test:fast` GREEN (EXIT 0,
  no cron-suite regressions, lint-determinism/lint-emits GREEN); `test:http` GREEN (cron.api 56 assertions
  round-trip the additive fields); LIVE boot smoke (cron enabled, free port :8847) boots clean. No `shared/*` edit.
  Next: **G4.6** (honest disabled-state + one-click enable).
- 2026-06-23 — **G4.6 Honest disabled-state + one-click enable: DONE (commit cfa45b4). G4 (all 6 items) COMPLETE.**
  The cron scheduler was INERT unless `SKYNET_CRON_ENABLED` was set at boot, so a user could create routines that
  SILENTLY never fire (the "app lies" trap) with no in-app way to enable. Added a PERSISTED `cronArmed` flag
  (`WORKSPACES/cron.armed.json`, written via the G4.2 `writeFileDurable` helper, load fail-closed) that the boot
  block ORs with the env var (`cronArmed = CRON_ENABLED || loadCronArmed()`) — `process.env` is NEVER mutated at
  runtime (the persisted file is the durable record, an in-memory bool the live state). New privileged route
  **`POST /api/cron/arm {enabled:bool}`** persists the flag durably FIRST, sets the live `cronArmed`, then actually
  arms/disarms the live timer NOW via idempotent `armCron()` (one immediate reconcile under the G4.3 lock + arm the
  interval) / `disarmCron()` (clear it) — so a due job fires within ONE tick of enabling with NO restart. Guarded by
  the SAME `x-starnet-token` gate as the cron CRUD routes (`rejectBadApiToken` before dispatch), not a weaker
  hand-rolled guard. `GET /api/cron enabled` now reports the live `cronArmed` (reflects a runtime arm/disarm
  immediately). UI (`stationui buildRoutines`): OFF shows a red "scheduling is OFF — routines will NOT fire" badge +
  one-click ENABLE SCHEDULING; ON shows armed + DISABLE. INERT-WHEN-OFF preserved (no env + no flag → cronArmed=false
  → boot no-ops → byte-identical off-path). RED→GREEN proven (`test/cron.arm.test.js`, NEW, 25 assertions in
  `test:http`: pre-fix RED — arm route 404s, enabled never flips, no flag persisted; the inert-when-off + token-guard
  403 assertions passed even pre-fix → don't regress; GREEN after `OK (25)`). Cases: inert-when-off, runtime
  arm/disarm flip+persist+live-tick, arm-at-boot from the persisted flag with no env var, token-guard 403, bad-body
  400. Full `npm run test:fast` GREEN (EXIT 0, no regressions, lint-determinism/lint-emits GREEN); `npm run test:http`
  GREEN (EXIT 0, cron.api 56 + cron.arm 25). LIVE-WATCHED (`npm start`, free port :8873, cron OFF): boot inert (no
  "cron tick armed"), GET enabled:false, served UI carries the OFF badge + ENABLE control; arm route → enabled:true,
  the due past one-shot ticks within one tick (`[cron] cron.tick` + no-capability, zero spend), `cron.armed.json`
  persists armed:true; disarm → enabled:false + "cron tick DISARMED" + armed:false; honest OFF badge + ENABLE button
  also rendered in a real Chromium DOM. No `shared/events.js`/`shared/schema.js` edit; no new event emitted (the arm
  state in `GET /api/cron` is sufficient). **G4 cron 100%-reliability is now fully closed (G4.1 tz/DST · G4.2 durable
  persistence · G4.3 exactly-once lock · G4.4 cap+retry · G4.5 one-shot fire-claim · G4.6 honest enable).** Next per
  the autonomy-first order: **G2.1** (MCP stdio transport — `sidecar/mcp/transport.stdio.js`).
