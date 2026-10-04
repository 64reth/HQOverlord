# Plan: Rebuild the StarNet desktop installer so it carries all of yesterday's work

**Audience:** Codex (executing agent). This doc is self-contained — assume no memory of the
conversation that produced it.
**Author:** Claude (Opus 4.8), 2026-06-28.
**Status:** Ready to execute. Two decision points are flagged inline (DECISION 1 = signing,
DECISION 2 = version bump) — resolve them before the build step.

---

## 1. Context — what happened and what this fixes

StarNet is a downloadable Tauri desktop app: a Rust shell that loads a static web frontend and
spawns a bundled Node sidecar. The user runs the **installed** build, not a dev server.

- The user's running app is the **installed copy** at `C:\Users\<you>\AppData\Local\StarNet\`,
  reporting itself as **version 0.1.0**.
- That install's `.exe` was built **2026-06-27 03:23:54 -0400**. Everything committed to the
  source trunk *after* that timestamp (an entire day of feature work — see §3) **never made it
  into the build**, so the running app was missing it.
- The first symptom the user hit: the awakening onboarding still asked the vague
  *"what good looks like"* question that was **removed in source yesterday** (commit `6e654fe`).
  It was still showing because the install was stale, not because the code was wrong.

**Already done (a hotfix, NOT this task):** the source `frontend/` was mirrored directly into
the live install's resource dir via `robocopy`, so after an app restart the *running* install is
already current. A pre-sync backup sits at
`C:\Users\<you>\AppData\Local\StarNet\frontend.bak-20260628-pre-sync`.

**This task:** produce a *properly rebuilt 0.1.0 installer* so the distributable artifact itself
carries all the work — for clean reinstalls and (if pursued) updater delivery. The hot-sync was a
band-aid on one machine; this bakes it into the bundle.

---

## 2. Where to build from

- **Integration tree / trunk:** `C:\Users\<you>\Desktop\gen`, branch **`feat/harness-backend`**.
  This branch already has every relevant merge (latest commit at authoring time: `21e2711`).
- All the missing work is **already committed on this branch** — there is nothing to merge or
  cherry-pick. The build just needs to run against current trunk.
- Confirm before building:
  ```
  cd C:\Users\<you>\Desktop\gen
  git status            # expect clean (or only untracked docs/screenshots)
  git rev-parse --abbrev-ref HEAD   # expect: feat/harness-backend
  git log -1 --oneline  # expect 21e2711 (merge agent/replacement-sweep) or later
  ```
  Per the repo's multi-agent protocol (`CLAUDE.md`), do not feature-edit the integration tree.
  This task only *builds* it — that's allowed. The only file edits permitted here are the
  optional `tauri.conf.json` / `package.json` version bump in DECISION 2, made deliberately.

---

## 3. The precise delta — what was committed but absent from the 0.1.0 build

### 3a. Empirical file-level delta (authoritative)
Before the hot-sync, `diff -rq` of source `frontend/` vs the installed `frontend/` showed exactly
this set. **All native (Rust) code was identical** — only bundled web resources differed, which is
why no Rust rebuild is logically required for content, though we still produce a fresh signed
installer.

**Modified frontend files (9):**
- `frontend/app/app.js`
- `frontend/app/chat.js`
- `frontend/app/dossier.js`
- `frontend/app/harness.js`
- `frontend/app/interview.js`
- `frontend/app/onboarding.js`  ← the awakening copy fix lives here
- `frontend/app/save.js`
- `frontend/app/stationui.js`
- `frontend/index.html`  ← wires the new `<script>` modules below; must ship together with them

**New frontend files absent from the build entirely (11):**
- `frontend/app/pitch.js`, `frontend/app/pitchstore.js`
- `frontend/app/quests.js`, `frontend/app/queststore.js`
- `frontend/app/seeds.js`, `frontend/app/seedstore.js`
- `frontend/app/autonomy.js`, `frontend/app/autonomystore.js`
- `frontend/app/autojobs.js`, `frontend/app/autojobstore.js`
- `frontend/app/suggeststore.js`

`shared/` delta: **none**. `sidecar/` delta: **none** (the only differences were runtime
`workspaces` data dirs, which are NOT code and must not be shipped).

### 3b. Commits since the installed build (2026-06-27 03:23:54) — what those files implement
31 commits, grouped by arc:
- **Awakening copy fix** — `6e654fe` fix(awakening): drop vague "what good looks like".
- **Dossier extraction in awakening** — `a81233e` pain (Slice 6), `d1cd38a` ambition (Slice 7).
- **First Pitch arc** (quest log + self-growing seed shelf + hardening) — `b28c727`, `6bdc48e`,
  `c16ad25`, `6ce5028`, `c221d7a`, `ad14b20`, `2c89849`.
- **Autonomy layer** (Initiative×Reach posture engine, cadence beat + station dial, self-initiation
  → cron jobs) — `a997d06` (1a), `424ac16`/`4f5e34f` (1b), `2133d97` (Slice 2), `a4aa7a7` polish.
- **Release/distribution test gates t0–t5 + replacement sweep** — `b2d53d3`, `ffcfd13`, `b219099`,
  `3994074`, `96a6c69`, `e743a0d`, `d19b694`, `30a9ff7`/`3438d56`, `a43c54d`/`7071cfe`,
  `a4dadf?`/`70efcdf`/`21e2711`, plus secret-lint `2e24307`.

To regenerate the exact list:
`git log --since="2026-06-27 03:23:54" --pretty=format:'%ci %an %h %s'`

---

## 4. Prerequisites / environment (verify before building)

1. **Rust + MSVC toolchain** (Tauri v2 on Windows needs the MSVC build tools + WebView2 runtime,
   which is standard on Win11). Check: `rustc --version`, `cargo --version`.
2. **Tauri CLI** — declared as devDep `@tauri-apps/cli ^2`. `npm install` provides it; invoke via
   `npm run tauri -- --version` (expect 2.x).
3. **Node** — present (used for prepare-node + sidecar). The build bundles its own `node.exe`.
4. **DECISION 1 — updater signing key.** `src-tauri/tauri.conf.json` has
   `bundle.createUpdaterArtifacts: true` and a `plugins.updater` block. With that on, `tauri build`
   **will fail at the signing step** unless one of these is set in the environment:
   - `TAURI_SIGNING_PRIVATE_KEY` (inline key) **or** `TAURI_SIGNING_PRIVATE_KEY_PATH` (key file), and
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (if the key is password-protected).
   The matching public key is already pinned in `tauri.conf.json`. The current bundle dir contains
   **only the `.exe` and no `.sig`**, so the signing key is likely NOT wired on this machine.
   Choose one:
   - **(A) Have the key** → export the env vars, build normally, get signed updater artifacts
     (`.nsis.zip` + `.sig`) suitable for the `updates.starnet.app` endpoint.
   - **(B) Don't have the key / local-only rebuild** → temporarily set
     `bundle.createUpdaterArtifacts: false` in `tauri.conf.json`, build to get just the NSIS
     installer, then **revert the edit**. Do this only for a local reinstall, never for public
     update delivery.
   The repo has a readiness checker: `npm run t1:signing` (and `node scripts/t1-signing.mjs`)
   reports whether signing is configured — run it first to learn which branch you're on.

---

## 5. Build steps

```bash
cd C:\Users\<you>\Desktop\gen

# 1. Confirm branch/commit (see §2).
# 2. Install deps (gets the tauri CLI).
npm install

# 3. GREEN GATE — required by repo protocol (CLAUDE.md): must pass fully before shipping.
npm run test:fast

# 4. Stage the bundled Node runtime into src-tauri/binaries/ (externalBin prereq).
node scripts/prepare-node.mjs        # auto-detects win-x64 -> node.exe

# 5. Resolve DECISION 1 (signing) and DECISION 2 (version) FIRST, then build.
#    desktop:build == prepare-node.mjs + tauri build (prepare-node re-runs harmlessly).
npm run desktop:build
```

Expected primary artifact:
`src-tauri/target/release/bundle/nsis/StarNet_<version>_x64-setup.exe`
Plus, if DECISION 1 = (A): `…_x64-setup.nsis.zip` and `…_x64-setup.nsis.zip.sig` (updater artifacts).

---

## 6. DECISION 2 — version number

`tauri.conf.json.version` is currently **0.1.0** — the *same* number the stale build already used.
The content changed materially (an entire feature layer), so shipping another `0.1.0`:
- is fine for a **local reinstall** (NSIS upgrades in place), but
- the **updater will NOT trigger** for existing installs, because the updater compares versions and
  `0.1.0 == 0.1.0` is not an upgrade.

**Recommended:** bump to **`0.1.1`** in `src-tauri/tauri.conf.json` (and optionally match
`package.json`, currently `0.0.0` — note Tauri reads the version from `tauri.conf.json`, not
package.json, so the package.json value is cosmetic). Commit the bump as its own small commit.
If this is purely a local reinstall and you don't care about the updater, keeping `0.1.0` is
acceptable — just know the in-place installer will still apply.

---

## 7. Verify the freshly built bundle actually contains the new work

Before installing, confirm the build packaged the current frontend (catches a stale
`target/release/frontend` resource copy):

```bash
# New modules present in the build's staged resources:
ls src-tauri/target/release/frontend/app/pitch.js \
   src-tauri/target/release/frontend/app/quests.js \
   src-tauri/target/release/frontend/app/seeds.js \
   src-tauri/target/release/frontend/app/autonomy.js \
   src-tauri/target/release/frontend/app/suggeststore.js

# Awakening copy is fixed (expect NO output):
grep -n "good looks like" src-tauri/target/release/frontend/app/onboarding.js
```

---

## 8. Install / deliver

1. **Close the running app first** — the installed `skynet-desktop.exe` (was PID 33048) locks its
   own binary; the installer can't replace a running exe. Fully quit StarNet.
2. Run the new installer: `src-tauri/target/release/bundle/nsis/StarNet_<version>_x64-setup.exe`
   (NSIS, `installMode: passive`). It installs to `C:\Users\<you>\AppData\Local\StarNet\`.
3. If pursuing updater delivery (DECISION 1 = A, DECISION 2 = bump): publish the new
   `latest.json` + signed `.nsis.zip`/`.sig` to `https://updates.starnet.app/desktop/latest.json`.
   (Out of scope for a local rebuild; note it as a follow-up.)

---

## 9. Post-install verification

```bash
INST="C:/Users/<you>/AppData/Local/StarNet"
ls "$INST/frontend/app/pitch.js" "$INST/frontend/app/quests.js"   # new modules present
grep -n "good looks like" "$INST/frontend/app/onboarding.js"      # expect no output
```
Then launch StarNet and confirm: app boots with no console errors, the awakening shows the
corrected context beat, and the pitch / quests / seeds / autonomy features are present.

---

## 10. Gotchas / notes

- **Running exe locks itself** — always close StarNet before reinstalling (see §8.1).
- **`index.html` + the 11 new JS files are a unit** — shipping one without the other 404s or
  no-ops the new features. A full rebuild handles this automatically; just don't hand-pick files.
- **Don't ship `sidecar/workspaces*`** — those are runtime data dirs, not code.
- **Hot-sync already applied to the live machine** — the user's running install is already current
  after a restart; this rebuild is for a clean distributable, not to un-break the live machine.
- **Backup exists** at `C:\Users\<you>\AppData\Local\StarNet\frontend.bak-20260628-pre-sync` if a
  rollback of the hot-sync is ever needed.
- **package.json version (0.0.0) is cosmetic** for the installer; `tauri.conf.json` is the source
  of truth for the bundled version.
