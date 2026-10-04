# macOS update test — the proof before Mac users exist

Goal: prove, on a real Mac, that an **older installed StarNet updates itself to a newer one and
the user's station survives** — before anyone outside tests it. Windows is proven end-to-end
(the local update canary caught + fixed a real hang). Mac is architecturally sound but has ZERO
end-to-end runs; this runbook closes that.

You need: a Mac (any recent macOS), and someone to click through it. No dev toolchain or signing
key required on the tester's Mac — they only install `.dmg`s and click Update.

---

## Why this is safe to run without a public launch

The updater endpoint baked into every build is
`https://github.com/androoAGI/starnet-releases/releases/latest/download/latest.json`.
`releases/latest` is just "the newest non-prerelease on that repo." Publishing there makes a build
reachable **only to someone who already has StarNet installed and pointed at that repo** — there is
no store listing, no announcement, no index. Two real releases on the (still-unadvertised) repo are
visible to an audience of exactly one: your tester. Nothing about this "launches" the product.

> NOTE: do NOT use GitHub "pre-release" for this. `releases/latest` never resolves to a prerelease,
> so an installed app's updater would not see it — the test would prove nothing. Use normal
> (latest) releases on the unadvertised repo.

---

## The test (real-endpoint path — recommended)

Two versions, `A` (old) then `B` (new). Example: `A = 0.5.0`, `B = 0.5.1`.

### 1. Cut version A through the release train
On your machine: `npm run release:bump 0.5.0`, write notes, push the `v0.5.0` tag
(see `docs/RELEASE_RUNBOOK.md`). The train builds all legs incl. the two mac `.app.tar.gz`
updater artifacts + `.dmg` installers, assembles `latest.json`, and stages a **draft**.
**Publish** the v0.5.0 draft (set as latest, NOT pre-release).

### 2. Tester installs A and SEEDS RECOGNISABLE STATE
- Download `StarNet_0.5.0_aarch64.dmg` (Apple Silicon) or `_x64.dmg` (Intel) from the release page.
- Open it, drag StarNet to Applications, launch. (Unsigned build ⇒ first-launch Gatekeeper prompt:
  right-click → Open, or System Settings → Privacy → Open Anyway. Expected; documented in INSTALL.md.)
- **Seed state we can check survives the update** — this is the "won't break setups" proof:
  - complete onboarding / wake the first agent (note its NAME),
  - recruit one more agent or change a visible setting (e.g. theme),
  - note the current version in Settings → UPDATES.

### 3. Cut + publish version B
`npm run release:bump 0.5.1` → tag `v0.5.1` → train → **publish** the draft as latest.

### 4. Tester updates A → B in-app
- In StarNet: Settings → UPDATES → UPDATE CENTER → **CHECK NOW**.
- It should show v0.5.1 available. Click **INSTALL UPDATE**.
- The app downloads, installs, and **relaunches on its own** as v0.5.1.

### 5. Verify — BOTH must hold
- **Update mechanism:** Settings → UPDATES shows `current v0.5.1`; the app relaunched itself with
  no manual step, no stuck installer, no error.
- **Setups survived (the important one):** the agent from step 2 is still there by name, the extra
  agent / setting change is intact, the station looks like it did before. Nothing reset to
  first-run.

If step 5 passes, Mac auto-update is proven end-to-end AND update-safe for existing setups.

---

## What "no matter what" means here — the manual fallback

Even a perfect auto-updater can be blocked by things we don't control (Gatekeeper on an unsigned
build, a network/permission/disk failure). So the app now **always** offers a manual path: on any
update error the Update Center shows **DOWNLOAD LATEST MANUALLY**, and a `download manually` link
sits in the Update Center footer at all times (`frontend/app/updates.js`, `RELEASES_PAGE`). Both
open the releases page in the system browser.

Reinstalling the latest `.dmg` over the top is ALWAYS a valid update on macOS and **keeps all user
data**, because user state lives OUTSIDE the `.app` bundle the installer replaces:
- **workspaces** (agents, saves, transcripts) → `~/Library/Application Support/ai.skynet.harness/`
- **localStorage / IndexedDB** (roster, settings, update prefs) → the WKWebView data store, keyed by
  the bundle id `ai.skynet.harness` (unchanged across updates)
- the version-change cache purge only ever deletes regenerable GPU/compiled caches, and is a no-op
  on macOS anyway (`purge_stale_webview_cache_on_version_change`, `src-tauri/src/main.rs`).

So the guarantee is layered: auto-update is the happy path; if it ever fails, the manual reinstall
always works and never costs the user their station. Have the tester confirm the manual path too:
trigger it (there's a `download manually` link in the footer) and check it opens the releases page.

---

## Optional: local canary on a dev Mac (no publishing)

If the tester's Mac has the full dev repo + the updater signing key, the Windows-proven local canary
(`npm run release:canary`, `scripts/update-canary.mjs`) can be extended to macOS: build-old /
build-new emit `.app.tar.gz` + `.dmg`, `serve` (already cross-platform) hosts the localhost feed,
and the update is driven by clicking INSTALL in the app (WKWebView has no CDP port, so the automated
`drive` step is Windows-only). This avoids publishing anything but needs the dev toolchain, so the
real-endpoint path above is the better fit for a plain Mac tester.
