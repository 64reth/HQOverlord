# Update state-safety audit — 2026-07-06 (post "missing agents" incident)

Scope: **what happens on the user's machine when an update lands** — can new code meet old data
(or old code meet new data) and corrupt, drop, or misrepresent the user's world/settings/builds?
Companion to `docs/UPDATE_PIPELINE_AUDIT_2026-07-06.md` (which covered trunk→installed delivery;
its release-train items are largely SHIPPED — gate job, draft-only staging, multi-platform
manifest, tag/version gate all verified in `.github/workflows/release-train.yml` today).

Trigger: the 2026-07-06 incident — after the 0.2.4 install, the WebView2 **code cache executed
stale pre-7/5 frontend bytecode against current data**: agents vanished from the world sim and
COMMS selection fell back to the overseer while the crew manifest stayed correct. No data was
lost; the UI ran old code. Full forensics in auto-memory `desktop-bundles-frontend-directly`.

Everything below was re-proven against trunk code tonight (not docs). File:line refs included.

---

## The invariant we are enforcing

> **An update may change code, never state.** After any upgrade (or downgrade), every byte of
> user state — world save, agents, station build, workstreams, settings, routines, memory —
> must be byte-preserved or losslessly migrated, and the UI must never render state through
> stale code. If an incompatibility exists, the app must SAY so, not guess.

---

## P0 — must fix before wide release (each has caused or can cause the incident class)

### P0.1 — WebView2 serves stale compiled frontend after update  **[CAUSED TONIGHT'S INCIDENT]**
- Seam: `src-tauri/src/main.rs:1175-1186` (webview creation) — no cache purge, no version marker,
  no cache-mode config anywhere (`tauri.conf.json` has no webview cache settings).
- Failure: WebView2 caches the exe-embedded frontend (Cache / `Code Cache/js` under
  `%LOCALAPPDATA%\ai.skynet.harness\EBWebView`) and never revalidates `tauri.localhost` assets.
  After an exe swap, V8 can run OLD bytecode against NEW data → "impossible" UI states
  (missing agents, identity merges), invisible hot-patches (UI froze at 6/28 for a week).
- Fix: on startup BEFORE window creation, compare app version to a stored marker; on change,
  purge `EBWebView\Default\{Cache, Code Cache, GPUCache, Dawn*Cache}` — PRESERVE Local
  Storage/IndexedDB/cookies (the world save lives in Local Storage `starnet.save`).
- Status: **task chip already spawned** (worktree lane).

### P0.2 — Durable-mirror sync fails silently; stale mirror = latent data loss
- Seam: `frontend/app/cloudsave.js:43` — `flush()` swallows every POST failure
  (`catch(() => false)`), clears `pending`, no retry, no telemetry, no UI surface. The
  `save-dot` implies "saved" regardless.
- Failure: if pushes fail for days (auth change, port change, sidecar down), localStorage keeps
  the app alive so nobody notices — until the ONE day the webview profile is lost (uninstall
  with data checkbox, profile corruption, machine migration) and `reconcile()` restores a
  days-old world. This exact staleness existed on Andrew's machine (a secondary root's mirror
  frozen at 7/3 while the app ran to 7/6).
- Fix: track lastPushOkAt; retry with backoff instead of dropping `pending`; surface staleness
  honestly (save-dot state + a warning when mirror age > N hours). This is a truthful-telemetry
  law issue: the UI currently asserts durability the harness can't prove.

### P0.3 — No forward-version guard: a downgraded app silently "adopts" newer saves
- Seams: `frontend/app/save.js:52-53` — `migrate()` stamps ANY doc `version = CURRENT` even when
  `doc.version > CURRENT` (no rejection, no warning); `frontend/app/cloudsave.js:84-86` —
  reconcile adopts a newer REMOTE by raw `setItem`, and if `Save.load()` throws, returns the
  **unmigrated** doc to the boot path.
- Failure: user updates v6 → rolls back to v5 (or a stale cached frontend reads a v6 save, i.e.
  P0.1 interplay): v6-only fields ride along unread, doc gets re-stamped v5, and on re-upgrade
  the hybrid doc can break v6 assumptions. Silent contamination, brutal to debug.
- Fix: `Save.load()` must refuse `doc.version > CURRENT` (leave the stored doc UNTOUCHED, show
  an honest "save was written by a newer StarNet — update the app" gate); reconcile must
  re-validate after adoption and never hand back an unmigrated doc. Add the same check to
  `backup.js` import (`validate()` at backup.js:99-104 ignores backup version today).

---

## P1 — real corruption/identity vectors, fix in the same hardening sprint

### P1.1 — Roster store: last-write-wins + reshape-on-save drops fields
- Seams: `sidecar/index.js:701-707` (`saveAgentRoster()` rebuilds each record from a FIXED field
  list — any field a newer version added is silently dropped when older code re-saves);
  `sidecar/index.js:3981-4003` (`handleRoster` replaces the whole store; strict validation
  rejects empty/malformed — good — but there is NO updatedAt anti-clobber like savestore has at
  `savestore.js:168`, so a stale tab/frontend can legally clobber a newer roster).
- Fix: envelope the roster `{ version, updatedAt, agents }`, refuse regressions (mirror the
  savestore pattern), and preserve unknown per-agent fields on re-save (spread prior record).

### P1.2 — Missing agent id ⇒ silent impersonation by the overseer  **[the "merged with ULTRON" lie]**
- Seams: `frontend/app/app.js:361` (`focusAgent`: `agents.get(id) || agents.get('agent')`);
  `sidecar/index.js:892-919` (`cronIdentityFor` returns null → `cronSystemFor`/`cronModelFor`
  silently fall back to station persona/default model, zero logging);
  `sidecar/index.js:4279` (runOnce roster lookup silently nulls).
- Failure: any roster/registry gap makes a specialist ANSWER AS THE OVERSEER — no error, no log.
  Users read this as "my agents were never real." Direct violation of the truthful-telemetry law.
- Fix: never silently rebind identity. Log loudly, and surface an honest state ("agent <id>
  unknown to the harness — roster out of sync") in COMMS/run output instead of impersonating.

### P1.3 — Update installs kill the app with no save flush
- Seam: `src-tauri/src/main.rs:1053-1093` (`starnet_update_install` → download_and_install →
  NSIS `CheckIfAppIsRunning` terminates the app); `frontend/app/updates.js` install flow never
  flushes `CloudSave.pending` or waits for the beacon.
- Failure: the last ~1.2s debounce window of world changes (and any in-flight sidecar write) is
  lost on every in-app update.
- Fix: before invoking install: `await CloudSave.flush()` (+ push roster), give the sidecar a
  drain moment, THEN install. Cheap and closes the window.

### P1.4 — No automated "update preserves state" proof
- Today nothing exercises the actual user journey: install vN, build a station, update to vN+1,
  assert world/settings/roster byte-identical. All tonight's classes (P0.1-P1.3) would be caught
  by ONE such harness. Existing tests cover pieces (`test/desktop-workspace-migration.test.js`,
  `save.test.js`, `updatecore.test.js`) but not the end-to-end parity.
- Fix: add an update state-parity gate: seed a workspace + localStorage fixture, run OLD
  frontend/sidecar → capture state snapshot → boot NEW code on the same state → deep-diff.
  Run in `test:fast` for the store layer + a CDP-driven variant in the release train.

### P1.5 — Unreproducible release binaries can reach users
- Evidence: `StarNet_0.2.3/0.2.4_x64-setup.exe` were built tonight from the integration tree
  with the version bumped-then-reverted — no tag, no commit (only v0.2.0-v0.2.2 exist). The
  release train's tag/version gate (`release-train.yml:262-279`) is solid but only guards the
  CI path; locally-built installers bypass everything, and the exe embeds whatever the working
  tree held.
- Fix: build.rs stamps `git describe --dirty` + commit into the exe (shown in diagnostics/About;
  train verifies the stamp matches the tag). POLICY: user-facing installs come ONLY from
  published train releases — local builds are dev-only.

---

## P2 — debt that makes future updates dangerous (schedule, don't drop)

- **P2.1 Workspace-root schemaVersion stamp** — still unimplemented (was item 15 of the
  pipeline audit). Stores are individually `version: 1` (roster/savestore/cron/channels) but
  memory-store payloads via `durable-store.js` are versionless and there is no root marker to
  key a multi-store migration on. Stamp `<workspaces>/.schema-version.json` at boot.
- **P2.2 Event contract is convention-only** — `shared/events.js` says FROZEN, but
  `shared/schema.js:53` only enforces `additionalProperties:false` when a schema opts in (none
  do), and no test fails on a renamed/removed field. Add a contract-snapshot test (additive-only
  gate) so a rename in shared/ breaks CI, not users. (Owner: cortex-memory workstream.)
- **P2.3 localStorage feature stores have versioned KEY NAMES but no internal shape guards** —
  ~15 `starnet.*.v1` stores parse-or-null with no `_version` field; a shape change would
  silently mis-read old data. Adopt a tiny shared load helper (`_version` + tolerant defaults).
- **P2.4 Cron jobs / allowlist reshape-on-write drops unknown fields** (same class as P1.1,
  lower blast radius): `cron-store.js` re-emits known fields only.
- **P2.5 Uninstaller "Delete app data" checkbox** deletes BOTH `%APPDATA%` and `%LOCALAPPDATA%`
  `ai.skynet.harness` (installer.nsi:2992-3008) = world save + webview profile. Unchecked by
  default and update-mode never deletes (solid), but the label should spell out "deletes your
  station, agents and history" — one careless click is total loss. Consider auto-exporting a
  `starnet-backup` file to Desktop before honoring it.
- **P2.6 Legacy dual data roots** — the TRUE root is `%APPDATA%\ai.skynet.harness\workspaces`
  (Rust shell passes it; `startup.log` proves). Stale hot-patch-era roots
  (`%LOCALAPPDATA%\StarNet\workspaces`) still exist on dev machines and confuse forensics;
  migration is copy-if-missing (`main.rs:360-397`, safe), but drop a `MOVED.txt` marker into
  legacy roots after migration so nobody (human or agent) reads stale state as truth again.

## What is already SOLID (verified tonight — do not rebuild)

- Release train: test gate before build; signing hard-required per platform; multi-platform
  `latest.json` assembled + verified pre-publish; DRAFT-only staging (human publish click);
  tag ↔ version mismatch hard-fails. (`release-train.yml:36-405`)
- NSIS: update mode NEVER deletes data (`$UpdateMode <> 1` gate); data-delete checkbox opt-in.
- Workspaces migration: one-shot copy-if-missing per boot, never overwrites existing files;
  single canonical root passed to the sidecar via env (`main.rs:360-397,615,1131-1134`).
- Frontend save: lossless v1→v5 migration ladder + one-time pre-migrate backup
  (`save.js:14-61`); corrupt JSON → null → first-run path never clobbers the stored raw doc;
  `skynet.*`→`starnet.*` rename migration is idempotent and keeps old keys as rollback.
- Sidecar durable writes: `.bak` snapshot before overwrite, temp+fsync+atomic rename,
  refuse-to-mutate-unreadable, per-key mutex (`durable-store.js:49-175`); savestore updatedAt
  anti-clobber (`savestore.js:145-171`); roster POST strict-validated against empty-wipe;
  boot sweeps are additive/dedup-only and logged.
- Single-instance plugin; sidecar respawn watchdog gated by a shutting-down flag.

## Execution

Lanes staged as task chips (each = one worktree agent, merge via starnet-merge-ritual,
`npm run test:fast` green before merge):

1. **P0.1** webview cache purge on version change (chip spawned earlier tonight).
2. **P0.2** mirror-sync truth: retry + staleness telemetry + honest save-dot.
3. **P0.3** forward-version guards (save.js + cloudsave reconcile + backup import).
4. **P1.1 + P1.2** roster integrity & identity honesty (envelope/anti-clobber/field
   preservation + kill every silent overseer fallback).
5. **P1.3 + P1.4** update flow: pre-install flush + update state-parity gate.
6. **P1.5 + P2.1 + P2.2** provenance stamp + workspace schemaVersion + event-contract gate.

Non-code (Andrew): keep publishing ONLY via the train (never hand out locally-built setups);
the updater-key offline backup from the pipeline audit still stands.
