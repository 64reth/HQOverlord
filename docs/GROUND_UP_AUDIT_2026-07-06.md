# StarNet ground-up audit — 2026-07-06

Six parallel read-only audits (backend, frontend, event seams, desktop/release, tests/docs,
security/first-run) grounded against current trunk `feat/harness-backend`, not plan docs.
Top claims re-verified by hand before landing here. Findings that failed cross-check are
listed at the bottom so nobody re-chases them.

Gate status at audit time: `npm run test:fast` — **green, 251 steps.**

Priority tiers: **P0** = correctness/data-safety/security or ship-blocker. **P1** = truthful-telemetry
or real user-visible bug. **P2** = polish/hygiene. Each item: what, where, why it matters, fix.

---

## P0 — fix before the next release

### 0.1 Workspace "migration" resurrects deleted user data every boot
- **Where:** `src-tauri/src/main.rs:385-397`, called unconditionally at `:1131`; `copy_missing_dir` `:360`.
- **What:** `migrate_workspace_data` runs on *every* startup with no done-marker. `copy_missing_dir`
  copies any file present in a legacy root (incl. `%LOCALAPPDATA%\StarNet\workspaces`, a real stale
  secondary on Andrew's machine) but missing in the live root.
- **Why it matters:** User deletes an agent / dismisses a prospect / prunes a session → file gone from
  the live root → next launch silently copies the stale legacy copy back → deleted state resurrects.
  Data-safety violation; also file-level merge of old+new store fragments is a corruption vector.
- **Fix:** Write a `.migrated` marker (or version-stamp) into the live root after first successful
  migration and skip thereafter; OR only migrate when the live root is empty (fresh install). Verified:
  no marker exists today.

### 0.2 Sidecar-spawn failure = permanently dead app, no retry, no error dialog
- **Where:** `src-tauri/src/main.rs:1161` (`let _ = spawn_sidecar` discards Err), window built
  unconditionally `:1175`, guardian only respawns when `guard` is `Some` `:727`; PATH fallback to bare
  `"node"` `:605`.
- **What:** If the first spawn returns `Err` (bundled node blocked by AV/SmartScreen, or "spawned but
  never listened" — `wait_for_port` 25s timeout also returns into the discarded result), `state.sidecar`
  stays `None` and the watchdog loops forever doing nothing.
- **Why it matters:** First-run beginner sees the frontend paint, then every `/api/*` fetch fails —
  broken screen, no retry, no native dialog, only `startup.log`. Worst possible first impression.
- **Fix:** On spawn/port-wait failure, show a native error dialog with the log path and a Retry, and let
  the guardian respawn even from the `None` state (bounded retries). The `:663-690` retry loop only
  covers Windows error-32 file locks today.

### 0.3 Agent-built workshop deliverables can steal the API token (same-origin, no sandbox)
- **Where:** `sidecar/index.js:3852` (`serveWorkshopRun` sets no CSP), token injected token-free into
  index.html at `:6405`, static routes need no token (`serveStatic` `:6397`).
- **What:** Deliverables are served as executable HTML on `http://127.0.0.1:8787`. Once opened, inline
  scripts run same-origin and can `fetch('/')` → read `window.__STARNET_API_TOKEN__` → call any `/api/*`
  route (self-approve consent, write files via `/api/workshop/decide`, dump config). `/api/file` defends
  the identical files with `CSP: sandbox` + octet-stream; `/workshop-run/` does not.
- **Why it matters:** A prompt-injected workshop shift → Commander clicks "Open it" → full harness
  compromise. This is the one confirmed *critical* security item.
- **Fix (needs a small product decision):** Add `Content-Security-Policy: sandbox allow-scripts` (no
  `allow-same-origin`) to `serveWorkshopRun` responses so deliverables run isolated, OR serve them from a
  distinct token-less origin/port. Sandbox without `allow-same-origin` keeps interactivity but cuts the
  page off from the app's cookies/token/API. Confirm this doesn't break legit interactive deliverables.

### 0.4 `agent.tool_call` double-emit corrupts the recruiter work-signal
- **Where:** `frontend/app/chat.js:3892` re-emits `U.bus.emit('agent.tool_call', { name })`; the full
  event already arrived via `frontend/app/harness.js:372`.
- **What:** For every `mcp__*` tool call the bus fires twice; the synthetic copy omits `agentId/runId/callId`
  (frontend bus never validates). `worksignalstore.js:50` falls back `p.agentId || 'agent'`, so hero MCP
  tool use is **double-counted** in the EWMA that drives the recruiter/prospect matcher; world ticker also
  prints a duplicate line with an undefined agent.
- **Why it matters:** Silent logic bug skewing a growth-loop signal + duplicate UI beats.
- **Fix:** Delete the redundant `U.bus.emit` at `chat.js:3892`; the stream-sourced emit is authoritative.
  (Optional hardening: make `U.bus.emit` warn on unknown-name/missing-required, per the meta-finding.)

### 0.6 Frontend leaks the local API token to openrouter.ai (third party)
- **Where:** `frontend/app/harness.js:44-46` (`isApiUrl` matches `/\/api\//` anywhere), `:290` (fallback
  `fetch(OR + '/models')` where `OR = https://openrouter.ai/api/v1`).
- **What:** The `window.fetch` monkey-patch attaches `X-StarNet-Token` to *any* URL containing `/api/`.
  The OpenRouter fallback catalog URL contains `/api/`, so the desktop build (which injects the token)
  sends the private local token to openrouter.ai. The custom header also forces a CORS preflight
  OpenRouter rejects → the fallback catalog fetch fails outright.
- **Why it matters:** Secret leak to a third party, *and* it breaks the exact fallback (key-entry dropdown
  stays empty) at the moment the sidecar is unreachable and the user needs it most.
- **Fix:** Restrict `isApiUrl` to same-origin/relative `/api/` (leading-slash or same-origin absolute only),
  never a substring match. Verified: `https://openrouter.ai/api/v1/models` passes the current regex.

### 0.5 Release pipeline — three ship-blockers
- **0.5a Updater + INSTALL.md point at a private repo that 404s fleet-wide.** `src-tauri/tauri.conf.json:67`
  and `INSTALL.md:17-18` both target `nonfungiblefunyuns-ship-it/starnet-releases/.../latest`, which returns
  404 while private. Auto-update is dead and the doc handed to testers 404s. **Decision required:** publish
  the releases repo public (Andrew-only action) or gate the doc/updater behind "coming soon."
- **0.5b Version floor stale → backwards release.** `tauri.conf.json`/`Cargo.toml` say 0.2.2, installed is
  0.2.4, and `scripts/release-bump.mjs:146` only checks "greater than the file's current." A `release:bump
  0.2.3` succeeds and, since GitHub `releases/latest` = most-recently-published (not highest semver), flips
  the feed backwards for new installs. **Fix:** anchor the bump floor to the published GitHub latest, not the
  in-tree value.
- **0.5c Emergency `release.yml` publishes a live Windows-only manifest.** `.github/workflows/release.yml:72-85`
  runs `gh release create` without `--draft`, attaching a windows-only `latest.json` (`release-cut.mjs:70`).
  One `publish=true` dispatch repoints the feed and breaks every mac/linux updater. **Fix:** require a
  confirmation input and/or force `--draft`; remove the non-Windows verify waiver at `:90`.

---

## P1 — truthful-telemetry & real bugs

### 1.1 BYOK provider key persisted in plaintext once a channel connects
- **Where:** `sidecar/channels/secrets.js:34` (`TOKEN_FIELDS = ['token']`), written via `index.js:2051-2056`.
- **What:** Connecting Telegram/Discord resolves the live keychain key then writes it as `key:` into
  `channels/secrets.json`; only `token` is stripped. Violates the stated "keys live in the OS keychain,
  never plaintext" posture; the key sits on disk (and in `.bak`) indefinitely.
- **Fix:** Add `key` (and any provider-secret field) to the strip list; resolve from keychain at runtime,
  never persist. HIGH.

### 1.2 Channel (Telegram/Discord) runs never enter `runsMeta` → SSE reconnect wipes live state
- **Where:** `sidecar/index.js:660-666` (`runsMeta`) vs `channels/hub.js:142` (`inflight`).
- **What:** `/api/state/snapshot` lists interactive/cron/workshop runs but not hub runs. On SSE reconnect
  the frontend clears anything absent from the snapshot, so a live channel-driven run's floor/HUD is wiped
  mid-run and E-STOP tooling under-reports active spend.
- **Fix:** Register hub runs in `runsMeta` (or include `inflight` in the snapshot).

### 1.3 `approvalMode` not persisted → silently reverts to "ask" on restart
- **Where:** `sidecar/index.js:704` (save) vs `:687` (parse); field parsed but omitted from the persisted roster.
- **What:** After a sidecar restart every agent's Full-Access reverts to "ask" until a browser re-pushes the
  roster. A headless (Telegram/cron-only) deployment loses it permanently; saved UI state and runtime disagree.
- **Fix:** Include `approvalMode` in `saveAgentRoster`.

### 1.4 `STARNET_TEST_OPEN_LOG` makes `/api/workshop/open` fake success in production
- **Where:** `sidecar/index.js:789-793` (`installTestOpenLog`).
- **What:** If that env var is non-empty, the opener is replaced and unconditionally returns `launched` —
  a success-shaped stub not gated on any dev/test flag. A stray env var → "Open it" reports success while
  nothing opens. Truthful-telemetry violation.
- **Fix:** Gate on an explicit test/dev flag (e.g. `DEV_MODE` or `NODE_ENV==='test'`).

### 1.5 `shell.bg.exit` emitted with no frontend handler
- **Where:** emitter `sidecar/index.js:1549`; zero listeners under `frontend/`.
- **What:** A `shell.exec background:true` process finishing/dying updates the UI never — silently stale.
- **Fix:** Add a handler (world ticker line + desk-state clear) or drop the event if backgrounding isn't surfaced.

### 1.6 Prompt-injection blast radius via auto-granted `team.*`
- **Where:** `sidecar/capability/registry.js:85-93` (`team.dispatch/spawn/resume` are `requiresConsent:false`).
- **What:** A hostile page/doc reaching an agent through auto-granted read tools (`web_fetch`, `browser.*`)
  can fan out sub-agents and burn spend with no human prompt; and workspace file reads can be exfiltrated via
  a later `web_fetch` to an attacker URL (not consent-gated). Spend is *bounded* by budgets/concurrency, not
  eliminated. **Decision required:** consent-gate `team.spawn`/`team.dispatch`, or accept-and-document.

### 1.8 OAuth & Spotify connect bypass the desktop-safe external-open helper
- **Where:** `frontend/app/stationui.js:3650` (OAuth), `:3715` (Spotify) use raw `window.open`; the Tauri
  `openExternal` helper (`open_external_url`) already exists at `:2106`.
- **What:** In the desktop webview (strict CSP + Tauri window policy) the popup can silently fail; the UI
  then asserts "complete the sign-in in the popup window…" and polls for 5 minutes against a window that
  never appeared. Also never checks `window.open`'s null return (popup-blocked case).
- **Why it matters:** OAuth-tier connectors and Spotify are effectively un-connectable from the shipped
  desktop app while working fine in the browser — and the status line lies about a popup that isn't there.
- **Fix:** Route both through `openExternal`; guard on the null return with an honest "couldn't open sign-in"
  message.

### 1.7 Empty final turn reads as a clean "done"
- **Where:** `sidecar/loop.js:408-417`.
- **What:** A run whose last model turn is empty (zero tools, no text) is refunded but ends `reason:'done'`,
  so a degraded provider streaming empty completions shows as clean finishes in history/reflection gates.
- **Fix:** Distinguish `reason:'empty'`/`'no-op'` from `'done'` when the turn produced nothing.

---

## P2 — polish & hygiene

- **1.x Channel supersede race** (`channels/hub.js:301-341` vs `index.js:4323`): a follow-up channel message
  during an in-flight run can get "⚠ already running" instead of takeover; the hub doesn't retry the transient
  refusal, so the message is lost. Add a short retry/backoff on that specific refusal.
- **`/api/version` blank in the packaged app** (`index.js:5117-5124`): version files aren't bundled resources,
  so the honesty/diagnostics surface can't tell support which build a desktop user is on. Bundle a
  build-stamp or read the Tauri version via IPC.
- **Orphaned tests** `test/cron.run-now.test.js`, `test/station-authority.test.js` pass but are in no gate.
  Add both to `test/fast.list` (one line each).
- **Two different `REF_HARNESS_PARITY_PLAN.md`** (root untracked vs `docs/` tracked) — an agent told to read it
  lands on either. Rename/consolidate. Also `git add` the important untracked root docs (AGENTS.md,
  CODE_MAP.md, plans) or move them into `docs/` so a `git clean` can't nuke them.
- **`package.json:5` mojibake** description (double-encoded em-dash) + triplicate `start`/`app`/`sidecar` and
  duplicate `serve`/`serve:ui-only` scripts.
- **Custom-provider silent fail** (`frontend/app/harness.js:139,156` + `keycta.js:28-31`): picking "custom"
  with no baseUrl raises no "no brain wired" CTA — first task just fails. Add the CTA for that seam.
- **STT key via query param** (`index.js:5719-5726`): `/api/stt?key=...` leaks into history/logs; the
  `X-OpenRouter-Key` header path already exists — drop the query path.
- **`handleDirStat` unjailed** (`index.js:5869-5878`): token-gated `stat()` of any absolute path; jail to
  user-profile roots (chains with 0.3 if the token is stolen).
- **Dead telemetry** declared but unconsumed: `cost.estimate` (no live spend ticker while streaming),
  `cron.tick`, `workshop.built`/`workshop.decided` (poll-bound instead), and a live `'flagged'` alarm
  listener (`audio.js:27`) nothing emits. Wire the useful ones (a live spend ticker is a nice win), delete
  the retired names + the false "cosmetic emitters" comment in `events.js:196`.
- **`config/aux-run` cost policy inconsistency** (`index.js:1261,1307` vs `1113,1191`): skill-review/curator
  runs omit the `unmetered` flag that reflection/study pass, so a Codex-only user's budget drains on phantom
  aux spend. Make the flag consistent.
- **`orModelCatalogIds` warmed once at boot** (`index.js:727`): a boot-time `/models` failure disables
  channel `/model` validation forever. Reuse the throttled re-warm the provider layer already grew.
- **Non-atomic plaintext-token migration write** (`main.rs:523-524`): `std::fs::write` of `secrets.json`,
  no temp+rename; crash mid-write corrupts channel config. Use atomic write.
- **qa/findings hygiene**: README says "ships empty" but 15 JSONs are tracked with absolute `C:\Users\<you>\…`
  paths baked in. Reconcile.

### Frontend polish (from the UI lane)
- **VT323 loaded only from Google Fonts** (`frontend/index.html:7-8`, CSP `tauri.conf.json:13`): offline/
  air-gapped first boot — invited by the local-first pitch — silently drops the house typeface everywhere,
  DOM → Courier, canvas → default monospace, degrading the locked CRT look with no error. Ship a local woff.
- **Blob-URL leak on deliverable open** (`chat.js:792-798`): `fileBlobUrl()` never `revokeObjectURL`s
  (every other createObjectURL site does). A 24/7 station reviewing many/large deliverables leaks memory
  proportional to files opened.
- **Nine drifted HTML-escape helpers** (`app.js:8`, `modeldock.js:524`, `modelpicker.js:11`, `warroom.js:15`,
  … vs the complete `U.esc` at `util.js:67`): several don't escape quotes yet are used in attribute contexts
  (`href="`, `id="`). Latent today (static inputs) but an attribute-injection trap the first time an agent/
  server string flows through. Consolidate on `U.esc`. (Also `app.js:1246` interpolates a raw device-auth
  response field into `innerHTML` — one `esc()` fixes it.)
- **`orgvalidator.js` (265 lines) is dead in the app** — the only `frontend/app` JS not loaded by index.html;
  nothing references `OrgValidator` outside `test/capdrift.test.js`. Either wire the org-graph validation it
  documents or delete the dead weight shipped in every bundle.
- **Widget-rail pollers never gated** (`widgets.js:470-473`): insights/cron/feed/ticker `setInterval`s arm at
  DOMContentLoaded and never pause on the title/connect screen — the same title-screen-polling waste
  `world.js:4416-4430` already fixed for the world loop. Gate on game-entered / pinned.
- **Marketplace catalog never retries** (`marketplace.js:148-153`): a transient sidecar hiccup sets
  `skillCatalog = {}` and the `if (skillCatalog)` guard short-circuits every later load — recipes show raw
  slugs for the rest of the session even after the sidecar returns. Allow retry (cronPending does it right).
- **`--warn` only retinted for `theme-green`** (`style.css:66` vs `:root:18`): the other five themes inherit
  the amber `--warn`, so ~25 `var(--warn)` uses read as a foreign accent on blue/purple/red/white — same leak
  the `--gold-rgb` per-theme work fixed. Add per-theme `--warn`.

---

## Checked and cleared (do not re-chase)
- **"Run Now never settles its cron work item / phantom queue depth forever"** — FALSE. `handleCronRun`
  settles via a `finally` backstop at `index.js:3671`. No leak.
- **CSRF / DNS-rebinding on `/api/*`** — defended (loopback bind, Host pin, per-launch token). Sound.
- **Jail escape / path traversal** in file-serving routes — `fsJail.resolveInside` rejects `..`/absolute/UNC/
  symlink; `agentId` regex-pinned. Sound.
- **Key leaks in config export / diagnostics / `/api/providers`** — scrubbed; only `configured` booleans exit.
- **Test coverage gaps / assertion-less / skipped tests / tracked secrets** — none found; all 53 sidecar
  modules exercised.
- **Beginner keyless boot** — no dead screen; Codex-default funnel + honest key CTA + translated 401/429/402
  errors + non-empty empty-states all confirmed working.
- t1/t5 mtime fixtures — relative-ordering, not a date bomb. Untouched by design.
