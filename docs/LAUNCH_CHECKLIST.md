# StarNet Launch Checklist

One page. Every public-facing artifact and its status, so launch day is a checklist — not a
memory test. Update the Status column as things land.

_Last updated: 2026-08-04. This checklist records the release-train contract; unchecked rows
still require evidence from the exact candidate and must not be inferred from workflow code._

## Launch scope

| Decision | Value | Notes |
| --- | --- | --- |
| **Advertised platforms** | **Windows + macOS** | The tagged public train builds win-x64, darwin-arm64, and darwin-x64. Linux remains a manual/internal artifact only and is not assembled or published by the public train. |

## Release channel

Public releases repo: **`androoAGI/starnet-releases`**
Updater endpoint (baked into the app, `src-tauri/tauri.conf.json`):
`https://github.com/androoAGI/starnet-releases/releases/latest/download/latest.json`

## Artifacts

| # | Artifact | Location | Status | Notes |
| - | --- | --- | --- | --- |
| 1 | **Windows installer** `StarNet_<ver>_x64-setup.exe` (+ `.sig`) | GitHub release asset | ☐ EVIDENCE REQUIRED | Windows x64 NSIS. The public train requires Authenticode publisher/timestamp verification plus a signed updater artifact. A workflow requirement is not installed proof. |
| 1a | **macOS DMG** `StarNet_<ver>_aarch64.dmg` + `StarNet_<ver>_x64.dmg` | GitHub release asset | ☐ EVIDENCE REQUIRED | Apple Silicon + Intel. The public train requires Developer ID signing, signed/timestamped nested native dependencies, Apple acceptance/stapling, and paired per-arch `*.app.tar.gz` + `.sig`. |
| 2 | **`latest.json`** update manifest (Windows + macOS) | GitHub release asset (root of endpoint above) | ☐ EVIDENCE REQUIRED | ONE manifest covering windows-x86_64, darwin-aarch64, and darwin-x86_64. Linux keys are explicitly allowed to be absent. The assembler verifies every included artifact/signature pair against the updater pubkey before emitting. |
| 3 | **Updater signature key** | `~/.tauri/starnet-updater.key` (Andrew's machine) | ☐ VERIFY | Pubkey is committed in `tauri.conf.json`; private key must sign every `latest.json`. |
| 4 | **INSTALL.md** | repo root — SHIPPED on trunk | ✅ DONE | SmartScreen + SAC honesty; download + update + uninstall. Public copy must match repo. |
| 5 | **PRIVACY.md** | repo root | ✅ DRAFTED | Audited 2026-07-03. No telemetry; local-first; keychain vs plaintext honest. |
| 6 | **TERMS.md** | repo root | ✅ DRAFTED | As-is, BYOK spend responsibility, not affiliated, **LICENSE-DECISION block open**. |
| 7 | **Download page** | `docs/DOWNLOAD_PAGE.md` | ✅ DRAFTED | Paste into static host / release README. Links INSTALL/PRIVACY/TERMS. |
| 8 | **Screenshots / demo clip** | — | ☐ TODO | Placeholder block in DOWNLOAD_PAGE.md. Real running-station media required. |

## Blocking swaps before public launch

| Item | What to do | Status |
| --- | --- | --- |
| **Support email** | ✅ DONE 2026-07-04: `androo.agi@gmail.com` in diagnostics.js + PRIVACY.md + TERMS.md + DOWNLOAD_PAGE.md (Andrew's pick; supersedes the earlier gmail swap). | ✅ DONE |
| **License decision** | ✅ DONE 2026-07-04: MIT (reaffirmed 2026-07-22, Hermes-style: MIT code + branding not licensed). `LICENSE` at repo root; TERMS.md §7 points to it. | ✅ DONE |
| **Public OS trust** | Public train must fail closed on missing/invalid Windows Authenticode, Mac Developer ID, nested-native signing, or Apple notarization. Manual test builds may degrade only when labelled internal/unsigned. | ☐ EXACT-CANDIDATE EVIDENCE REQUIRED |

## Cut & publish order (the installer bakes the frontend — order matters)

1. **Swap the support email first** (it lives in `frontend/app/diagnostics.js`, which ships
   inside the exe — an installer cut before the swap shows the literal placeholder to users).
2. **Re-cut LAST**: `npm run release:cut` immediately before upload. A staged installer goes
   stale the moment trunk moves (this bit us on 2026-07-03: the 23:02 cut predated four
   same-night merges). Trunk is multi-session — always re-cut, never trust `release/` dates.
3. Upload + publish the GitHub release (exact tag `vX.Y.Z`), then `npm run release:verify-host`.
4. **Unattended-update proof — mind the legacy-endpoint trap**: installs ≤0.1.7 have the DEAD
   `updates.starnet.app` endpoint baked in and will NEVER see GitHub releases. They need one
   manual (re)install. The real proof of the update loop: manually install the first
   GitHub-era build, then publish a trivial next version and watch System → Updates apply it
   unattended. Do this once before telling the public updates work.

## Consistency gates (do NOT ship until true)

- ☐ **Cross-platform smoke test BEFORE clicking Publish on the draft:** install and launch the
  exact staged Windows artifact and both Mac architectures on disposable test machines. Record
  Authenticode publisher/timestamp, Gatekeeper notarization verdict, launch, and updater behavior.
  Workflow checks alone do not satisfy this row.
- ☐ SmartScreen / SAC / Gatekeeper wording is **identical in spirit** across INSTALL.md and
  DOWNLOAD_PAGE.md: SmartScreen reputation can still warn, while a public Mac Gatekeeper trust
  failure is unexpected and must not be bypassed.
- ☐ The `latest.json` uploaded matches the version of the installer asset in the same release.
- ☐ `ANDREW_SUPPORT_EMAIL` no longer appears anywhere (grep returns nothing).
- ☐ `LICENSE` file exists and TERMS.md §7 points to it.
- ☐ PRIVACY.md claims still true after any last-minute code changes (re-audit if network or
  storage code changed: providers, channels, Spotify, updater endpoint, keychain paths).
- ☐ `npm run test:fast` green on the release commit.

## Quick verification commands

```bash
# support-email placeholder must be gone before launch — NOT just docs:
# it is also a frontend constant (frontend/app/diagnostics.js) BAKED INTO the exe.
grep -rn "ANDREW_SUPPORT_EMAIL" --include="*.md" --include="*.js" .

# confirm the updater endpoint the app will actually hit:
grep -n "endpoints" -A2 src-tauri/tauri.conf.json

# test gate:
npm run test:fast
```
