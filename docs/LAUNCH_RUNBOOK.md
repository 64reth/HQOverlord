# StarNet LAUNCH RUNBOOK — full public release (Windows + macOS)

Read-mostly prep sweep, 2026-07-17, against trunk `feat/harness-backend` (worktree HEAD
`26ad2a32`, shipped version `0.5.2` per `src-tauri/tauri.conf.json`). Every claim below was
re-proven with a command on this machine; nothing is copied from memory or plan docs.

---

## A. DONE / VERIFIED (with evidence)

### A1. Release pipeline machinery is built — but NOTHING is published
- `node scripts/verify-update-host.mjs` (live): endpoint
  `https://github.com/androoAGI/starnet-releases/releases/latest/download/latest.json`
  → **HTTP 404 — FAIL**. The updater path is NOT live. The releases repo itself 404s
  unauthenticated (private or nonexistent).
- `gh` CLI is **not installed** on this machine (bash + PowerShell both "command not found"),
  so draft state on `starnet-releases` could not be inspected. Judged from the source repo
  instead:
  - `git ls-remote --tags origin` (origin = `androoAGI/starnet`):
    remote tags stop at **v0.4.0**. Tags `v0.5.0`, `v0.5.1`, `v0.5.2` exist **locally only**.
  - `origin/feat/harness-backend` = `3e1802da` (the v0.4.0 commit); local trunk = `144c97b0`,
    hundreds of commits ahead. **The release train has never seen 0.5.x.**
- Local staging IS done: `release/` in the integration tree holds
  `StarNet_0.5.2_x64-setup.exe` + `.sig` + `latest.json` (version 0.5.2, pub_date
  2026-07-17T00:39Z) — but that `latest.json` covers **platforms: [windows-x86_64] only**.
  Publishing it as-is would strand mac/linux updaters; `verify-update-host` hard-requires all
  5 platforms (`windows-x86_64, darwin-aarch64, darwin-x86_64, linux-x86_64,
  linux-x86_64-deb`). The multi-platform release must come from the CI train, not `release/`.

### A2. Mac tooling parity is present in the pipeline (unproven end-to-end)
- `.github/workflows/release-train.yml` matrix builds `darwin-arm64`
  (aarch64-apple-darwin) and `darwin-x64` (x86_64-apple-darwin) on `macos-latest`, packages
  `*.app.tar.gz` + `.sig`, and stage-drafts to `androoAGI/starnet-releases`
  via secret `RELEASES_TOKEN` (fine-grained PAT, Contents:write).
- `scripts/release-assemble-manifest.mjs` maps `*.app.tar.gz` → `darwin-aarch64` /
  `darwin-x86_64` (lines 40–41, 61, 99–100). Manifest tooling covers darwin fully.
- `docs/MAC_UPDATE_TEST.md` exists and is a complete attended runbook (summary in B6).
- Honest status: **zero public end-to-end update proofs on ANY platform**; mac auto-update has
  zero end-to-end runs of any kind (NEXT.md 2026-07-15, re-confirmed — nothing newer exists).
  Windows has a LOCAL canary pass only (0.5.0→0.5.1, `.bugloops/release-prep-2026-07-15/`).
  The 2026-07-14 update-blockers hardening (deb manifest key, minisign verify in assemble,
  immutable published releases) has **never been exercised by a train run**.

### A3. Provider certification — machinery green, 0 certified (no keys in env)
`npm run certify:providers` @ 2026-07-17T07:25Z: **17/17 SKIP**, receipt
`.dogfood/provider-certify/2026-07-17T07-25-53-754Z.json`. Exact env vars per provider:

| provider | env var(s) |
|---|---|
| openrouter | `OPENROUTER_KEY` or `OPENROUTER_API_KEY` |
| openai | `OPENAI_API_KEY` |
| anthropic | `ANTHROPIC_API_KEY` |
| gemini | `GEMINI_API_KEY` / `GOOGLE_API_KEY` / `GOOGLE_AI_API_KEY` |
| xai | `XAI_API_KEY` / `X_AI_API_KEY` |
| groq | `GROQ_API_KEY` |
| mistral | `MISTRAL_API_KEY` |
| deepseek | `DEEPSEEK_API_KEY` |
| together | `TOGETHER_API_KEY` |
| fireworks | `FIREWORKS_API_KEY` |
| perplexity | `PERPLEXITY_API_KEY` |
| cerebras | `CEREBRAS_API_KEY` |
| ollama | none — needs a live endpoint at `http://127.0.0.1:11434/v1` |
| custom | `CUSTOM_OPENAI_BASE_URL` / `OPENAI_COMPATIBLE_BASE_URL` |
| codex / grok / kimi | OAuth sign-in — certify via the live app, not this script |

### A4. Key custody — keys exist; backup + rotation NOT done
- `~/.tauri/starnet-updater.key` + `.key.pub` exist (this is the minisign-format Tauri
  updater key; `npm run release:verify-sig` verifies artifacts against the baked pubkey).
  It is the **single point of total loss** for the update channel — no evidence of any backup.
- Dev OpenRouter key rotation (security audit 2026-07-02): **still open**. Evidence:
  `qa/STATUS.md:271` — "OpenRouter dev-key rotation = Andrew manual"; `docs/NEXT.md:103` and
  `:729` still list it as an open Andrew checkbox. No "rotated" record anywhere in docs/qa.
- `RELEASES_TOKEN` rescope is also still listed open (`docs/NEXT.md` P0 block).

### A5. W1 / T0 gates — code verified, blocked on attended runs by design
- `scripts/qa/installed-first-run.mjs` (W1) fails closed without: exact candidate SHA, exact
  installed-exe bytes, machine-verified isolation (`separate-windows-user` requires the repo
  owner SID ≠ the running user's SID AND the installed app's CDP listener owned by the running
  user), attended flags, and a real provider credential (never logged). Runbook in B4.
- `scripts/t0-clean-install.mjs` (T0) currently exits BLOCKED at t0.3/t0.4: it wants
  `STARNET_T0_CLEAN_EVIDENCE` (or `--evidence <path>`) pointing at a
  `starnet.clean-install-proof.v1` JSON captured during a real outside install whose
  `installer.sha256/bytes` match the current NSIS installer. Capture recipe in B7.
- Attended playtest: **DONE** per Andrew 2026-07-15 ("ran perfectly for me as a user") —
  NEXT.md line 96, checked. Outside installs on other hardware (Win + Mac): **attested done**
  2026-07-15, but formal T0 evidence JSON was not captured (deliberately deferred to the next
  outside install).

### A6. Windows/Mac parity docs + readiness protocol
- `docs/RELEASE_READINESS.md` (RC freeze + 48h soak + `qa:ready` READY-GATE) is current and
  self-consistent with the scripts it names (`qa:ready`, `qa:smoke:installed` verified in
  package.json). Note its stated limitation: `release:cut` builds **Windows only**; rc/* tags
  do NOT drive the train — only `v*` tags matching `tauri.conf.json` version do.
- qa:ready was READY at rc/0.5.1 pin `503ba26f` (2026-07-16). **v0.5.2 has no recorded
  qa:ready READY stamp found in NEXT.md/qa/STATUS.md** — re-run it before publishing (B1).

---

## B. ANDREW-ATTENDED STEPS — optimal order

> Total attended time ≈ 2.5–3.5 h spread over ~3 days (48h soak/canary windows dominate).
> Steps B1–B3 are same-day; B4–B7 ride the published release.

### B1. Pre-flight on this machine (~15 min)
```powershell
cd C:\Users\<you>\Desktop\gen
git checkout feat/harness-backend
npm run qa:ready          # must print READY next to v0.5.2's commit — no READY, no push
npm run release:cut:dry   # sanity: cut machinery clean
```
If NOT READY, burn down the named reasons first (`node scripts/qa/ledger.mjs --digest`).

### B2. Back up + rotate keys BEFORE anything becomes public (~20 min)
1. Copy `C:\Users\<you>\.tauri\starnet-updater.key` (+ `.pub`) to **two offline locations**
   (USB + second medium). Read the copy back and byte-compare before trusting it
   (secret-durability law: never rely on a copy you haven't read back).
2. Rotate the dev OpenRouter key at openrouter.ai (create new, update
   `memory/.openrouter-key` / wherever the live app key lives, revoke old). Open since 7/02.
3. Rescope `RELEASES_TOKEN` (fine-grained PAT, Contents:write on
   `androoAGI/starnet-releases` only) and confirm it's set as an Actions
   secret on the `starnet` source repo.

### B3. Push, train, publish — the actual release (~30 min attended + CI wait)
1. Make `starnet-releases` exist and be **public** (it 404s today; a private repo breaks
   `releases/latest/download` for anonymous updaters).
2. Push source + tag (tag push triggers the train; assemble hard-fails unless the tag is
   exactly `v0.5.2` matching `tauri.conf.json` — it is):
   ```powershell
   git push origin feat/harness-backend
   git push origin v0.5.2
   ```
3. Watch Actions → release-train: 5 legs (win, darwin-arm64, darwin-x64, AppImage, deb) +
   minisign verification in assemble + stage-draft. This is the FIRST train run since the
   2026-07-14 hardening — expect and budget for one red/re-run.
4. Review the DRAFT on `starnet-releases` per `docs/RELEASE_RUNBOOK.md` §1.7 checklist —
   **all platforms' assets attached** (never publish a draft missing a platform), notes right,
   `latest.json` lists all 5 platforms.
5. Click **Publish release** (the only human ship gate), then immediately:
   ```powershell
   node scripts/verify-update-host.mjs   # must print all-PASS now
   ```

### B4. W1 attended fresh-profile proof on this PC (~15–20 min)
Cheapest honest path (NEXT.md line 100): second local Windows account.
1. As andro: create a user, e.g. `net user starnetw1 <pw> /add` (Settings → Accounts works too).
2. Sign in as `starnetw1`; install the exact published `StarNet_0.5.2_x64-setup.exe` there.
3. Relaunch the installed app with CDP open:
   `$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9333'` then start
   StarNet (see `qa/installed/README.md`).
4. Still as `starnetw1`, in a PowerShell in the repo (repo stays owned by andro — that
   ownership difference IS the isolation proof):
   ```powershell
   cd C:\Users\<you>\Desktop\gen
   $env:STARNET_PRODUCT_PERFECT_CANDIDATE_SHA = '<exact v0.5.2 commit sha>'
   $env:STARNET_FIRST_RUN_ARTIFACT = '<path to the installed StarNet.exe>'
   $env:STARNET_FIRST_RUN_CDP_PORT = '9333'
   $env:STARNET_FIRST_RUN_ISOLATION_AUTHORITY = 'separate-windows-user'
   $env:STARNET_FIRST_RUN_FRESH_PROFILE = '1'
   $env:STARNET_FIRST_RUN_ATTENDED = '1'
   $env:STARNET_FIRST_RUN_PROVIDER = 'openrouter'
   $env:STARNET_FIRST_RUN_MODEL = '<model id>'
   $env:STARNET_FIRST_RUN_PROVIDER_SECRET = '<key — typed in this shell only, never logged>'
   node scripts\qa\product-perfect\gates\wave-1-installed-first-run.mjs
   ```
   (The gate mints expected artifact sha/size itself and runs the link probe + journey;
   receipt lands under `qa/installed/smoke-*-first-run/`.) The journey proves: fresh profile →
   visible provider failure → recovery → Overseer → real fs.write/fs.read hello.txt →
   hash-verified → real OPEN click, all under 10 min.

### B5. Public per-platform update canaries (~30 min attended over 2 releases)
Per `docs/NEXT.md` P0: with 0.5.2 published, the next release (0.5.3 or a canary bump)
proves the PUBLIC path per platform: install the older published build → publish newer →
in-app CHECK NOW → INSTALL → relaunch on new version. Windows NSIS on this machine; mac both
arches ride B6; AppImage/.deb on any Linux box/VM. Today there are ZERO public update proofs.

### B6. Mac auto-update proof (~30 min on the Mac, attended)
Run `docs/MAC_UPDATE_TEST.md` exactly. Attended steps on the Mac (no dev toolchain needed):
1. Install version A (`StarNet_<A>_aarch64.dmg` or `_x64.dmg`) from the published release;
   right-click → Open past Gatekeeper (unsigned build — expected).
2. **Seed recognisable state**: complete onboarding, note the first agent's NAME, recruit one
   more agent or change the theme, note version in Settings → UPDATES.
3. After version B publishes (B3/B5): Settings → UPDATES → CHECK NOW → INSTALL UPDATE →
   app relaunches itself as B.
4. Verify BOTH: version shows B with no manual step, AND the named agent/setting survived.
5. Also click the footer `download manually` link once — it must open the releases page
   (the guaranteed fallback; reinstalling the .dmg always preserves user data, which lives in
   `~/Library/Application Support/ai.skynet.harness/`).
Prep already done from Windows (verified): darwin targets in the train matrix, darwin entries
in `release-assemble-manifest.mjs`, darwin required by `verify-update-host.mjs`. Nothing else
is preparable from this machine — the run itself is the deliverable.

### B7. T0 clean-install evidence on the next outside install (~10 min during that install)
On the outside machine, during the install, hand-capture
`starnet-clean-install-proof.json`:
```json
{
  "schema": "starnet.clean-install-proof.v1",
  "generatedAt": "<ISO time>",
  "machineKind": "physical-clean-windows | windows-sandbox | clean-vm",
  "cleanMachine": true,
  "installer": { "sha256": "<sha256 of the setup.exe>", "bytes": <size> },
  "install": { "succeeded": true, "installLocation": "C:\\Program Files\\StarNet" },
  "launch": {
    "succeeded": true,
    "exePath": "<installed StarNet.exe>",
    "workspaceRoot": "C:\\Users\\<user>\\AppData\\Roaming\\ai.skynet.harness"
  },
  "notes": []
}
```
Rules enforced by the validator: `workspaceRoot` must be under AppData and NOT under the
install dir; no `smoke` install paths; installer hash/bytes must match the CURRENT local NSIS
installer. Then on this machine:
```powershell
npm run t0:clean-install -- --evidence C:\path\to\starnet-clean-install-proof.json
```
Exit 0 + `cleanInstallProofReady=true` closes T0.

### B8. Provider certification with real keys (~15 min, optional pre-launch, required for "12 providers" claim)
In one PowerShell, export the keys you actually own (names in A3), then:
```powershell
npm run certify:providers
```
Certify codex/grok/kimi by signing in via the live app once each. Never commit/echo keys.

---

## Brutal-honesty ledger (things that are NOT proven, stated plainly)
1. **No public release exists at all** — not v0.5.1, not v0.5.2. The 0.5.x tags were never
   pushed; the train never built them; the releases repo is not publicly visible.
2. **The hardened release train has never run.** Its first run is part of launch, not before it.
3. **Mac auto-update: zero end-to-end runs ever.** Manual-fallback + data-preservation bound
   the damage, but the happy path is unproven until B6.
4. **Zero public update canaries on any platform** (Windows proof was local-loopback only).
5. **W1 fresh-profile proof and T0 formal evidence: not done** (playtest + informal outside
   installs are attested, but the fail-closed gates have never emitted a PASS receipt).
6. **0/17 providers certified** in the current environment; certification is env-gated.
7. **Updater key has no backup; dev OpenRouter key unrotated since the 7/02 audit.**
8. **No qa:ready READY stamp found for the v0.5.2 commit** (0.5.1's pin was READY; re-run B1).
