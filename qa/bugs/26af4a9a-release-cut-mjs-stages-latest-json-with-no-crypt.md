---
fingerprint: 26af4a9a
slug: release-cut-mjs-stages-latest-json-with-no-crypt
title: release-cut.mjs stages latest.json with no cryptographic signature check, and no downstream gate does one either — t1 checks .sig mtime, t5 text-compares it, ve
surface: release
severity: P1
status: fixed
found: 2026-07-28
lane: sweep/release
fix: b315063b
---

# release-cut.mjs stages latest.json with no cryptographic signature check, and no downstream gate does one either — t1 checks .sig mtime, t5 text-compares it, ve

## Symptom

A release cut with the wrong updater private key (a restored/regenerated ~/.tauri/starnet-updater.key, or STARNET_UPDATER_KEY_FILE pointed at a different file) passes T1 signing, T5 public-distribution and verify-update-host completely green, publishes, and then hard-fails the update for EVERY installed app — the exact failure minisign-verify.mjs was written to prevent. Nothing in the ladder catches it; only a human remembering to run `release:verify-sig` by hand does.

## Repro

Ran a script that signs fake installer bytes with a DIFFERENT ed25519 key via test/minisign-test-signer.js, builds the manifest exactly as release-cut.mjs lines 197-209 does, then replays t5's validateManifest() and verify-update-host's per-platform signature check verbatim, and finally the real verifySignature() against the pubkey baked in src-tauri/tauri.conf.json:
  t5 validateManifest errors  : (none) -> T5.2 PASS
  verify-update-host sig check: PASS
  real crypto vs baked pubkey : FAIL -> key id mismatch: signature is from key 381bf5b905c232f5 but the public key is 8c3f2122db327eff — signed with a DIFFERENT key

## Evidence

`scripts/release-cut.mjs:201`

**Mechanism (read from the code):** `release-cut.mjs` builds the manifest itself: line 201 `signature = readText(sig).trim();` then lines 204-211 write `release/latest.json`. Its only signature checks are existence (line 177) and mtime freshness (line 184). It never imports `minisign-verify.mjs` — grep for `minisign-verify|verifySignature|resolvePubkeyText` over the repo returns only `scripts/minisign-verify.mjs` itself, `scripts/release-assemble-manifest.mjs:57`, and the two test files. The downstream gates are equally blind: `t5-public-distribution.mjs:171` only does a TEXT compare, `if (sigText && String(platform.signature||'').trim() !== sigText) errors.push('manifest signature does not match installer .sig file')`; `t1-signing.mjs:139-167` `updaterStatus()` only checks `existsSync(sigFile)` and `signatureStat.mtimeMs >= installerStat.mtimeMs`; `verify-update-host.mjs:125-126` only checks `typeof plat.signature === 'string' && plat.signature.trim().length > 40`. minisign-verify.mjs's own header (lines 6-12) names this exact gap — "the release pipeline used to check only that a .sig file exists, is non-empty, and matches the manifest TEXT... a mismatched release would pass every publish check and then fail the update for EVERY user" — but the fix was wired into only ONE producer (release-assemble-manifest.mjs, used by the CI train and the canary) and not into release-cut.mjs, which is the local one-command Windows cutter.

**Existing test coverage:** test/t1-signing.test.js:109 and test/t5-public-distribution.test.js:82 — both CONFIRM the gap rather than close it: they write the literal strings 'fake updater signature' / 'fake-updater-signature' as the .sig contents and assert the gate reaches green. test/minisign-verify.test.js and test/release-assemble-manifest.test.js do exercise real crypto, but only against release-assemble-manifest.mjs — no test drives release-cut.mjs's manifest output through verifySignature().

**Adversarial verdict (survived refutation):** Confirmed. scripts/release-cut.mjs:201 `signature = readText(sig).trim();` feeds the manifest written at :204-211; its only signature guards are existence (:176-180) and mtime freshness (:181-185), and preflight (:100-117) checks only `existsSync(KEY_FILE)` — never that the key matches the baked pubkey. Repo-wide grep for minisign-verify|verifySignature|resolvePubkeyText returns only scripts/minisign-verify.mjs, scripts/release-assemble-manifest.mjs:57 and the two test files, so release-cut has no crypto path. Downstream is shape-only as claimed: t5-public-distribution.mjs:171 is a text compare against the .sig, t1-signing.mjs:139-167 checks existsSync + `signatureStat.mtimeMs >= installerStat.mtimeMs`, verify-update-host.mjs:125-126 checks `trim().length > 40`. release-cut is a live documented publish path (package.json:122 `release:cut`; docs/LAUNCH_CHECKLIST.md:47 'Re-cut LAST: npm run release:cut immediately before upload'), and neither that checklist, docs/RELEASE_CUT_CHECKLIST_v0.7.0.md, nor release-cut's own printed upload checklist (:224-240) ever calls `release:verify-sig`. Tests confirm rather than close the gap: test/t1-signing.test.js:108-121 writes the literal 'fake updater signature' and asserts publicReleaseReady===true; test/t5-public-distribution.test.js:82 writes 'fake-updater-signature' and reaches green. Only correction: the gates are not literally 'ANY non-empty text' (t5 requires it match the .sig byte-for-byte, verify-update-host requires >40 chars) — but none performs a cryptographic check, which is the substance of the claim.

_Found by the `sweep/release` lane, 2026-07-28. Finder confidence: high. Severity claimed P1, after refutation P1._

## Verdict

_Filled in when the bug leaves the backlog: what was true, and why it is closed._
