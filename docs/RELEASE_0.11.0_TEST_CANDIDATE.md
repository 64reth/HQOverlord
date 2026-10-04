# StarNet 0.11.0 replacement owner-test candidate

The owner authorized fixing four issues from the first installer test and packaging another unpublished 0.11.0 installer. Publication waits for the owner's retest and release decision. The 48-hour soak duration waiver remains limited to duration.

## Artifact

- Installer: `release/StarNet_0.11.0_x64-setup.exe` in the release-0110 worktree; Windows x64, version **0.11.0**.
- Size: **126520301 bytes**.
- SHA-256: `989d45d3d791fba0333b9e50864d747bd81366343760a81cb5825639a325bf0e`.
- Exact packaged source: `d611e156a314a8f8a8475a74a471fff0be33769d`; tree `9d34c0ea0d235da150df3a40f758826216a3a535`.
- Application SHA-256: `e1c43a0b3e6084dbb1286194e5e3b514b413f61f2078a1ae707126b976b2ccd7`.
- Updater signature verified against the configured public key. Windows Authenticode: **NotSigned**. These are separate mechanisms.
- First tested installer and six original candidate files are retained under `release/candidates/2cfdcb04e/`; original installer SHA-256 `721f0b42acfba41dfe5b5a43b9028e61b2e52e241b0b12d3d3822ce4a1b6239e`.

## Included repairs

New group attachments appear on their exact sent message, with image thumbnails and full-image preview. Upload/send retries and restart preserve association, and branching does not expose later message files. Recipe Bay deep shelves retain equal readable card widths. Context extraction uses the existing theme surfaces without changing its interaction. Bay names stay readable in the station and REFIT, including long names and roster renames. The approved station colour grade is independent of the UI palette; existing room-lighting preferences remain intact.

Source fixes: `fe5be77a9`, final cached-message identity correction `7755dd8b2`, and incorporated room-colour merge `cac60f4a990d84b49c734edb67d56cf1a384d307`. See [polish proof](RELEASE_0.11.0_POLISH.md) for the live observations and coverage limits.

## Verification

- Final full fast gate: **729/729**, exit 0.
- Full HTTP gate: **101/101**, exit 0. The first attempt exposed a test-fixture dependency on the absence of the staged publisher registration; after isolating the legacy fixture, its 129 assertions and the complete rerun passed. Native Desktop Google sign-in remains separately tested.
- Browser journeys: **130/130** assertions. Product rendering/behavior is unchanged after that run except the separately live-tested cached-message identity refresh.
- Customer regression campaign: **29/29** suites.
- Claims planning authority: **37 claims / 225 locked files**.
- Actual seeded browser: message attachments and image opening, multiple/attachment-only send, sidecar restart/reload, six-card recipe rail, narrow/wide context card, six named bays in cinema/REFIT, and a real NOVA → NOVA PRIME rename reflected in the bay and existing/new group messages.
- Standard release cutter completed assembly and updater signing. Both exact source identifiers occur in the compiled executable; all **4269** tracked frontend/sidecar/shared staging resources match source bytes, and the generated native Google registration matches its staging copy. This is build/staging proof, not installer extraction or installed-runtime acceptance.

Evidence: `package-0110-polish-final.log`, `gate-0110-polish-final-fast.log`, `gate-0110-polish-http-rerun.log`, `gate-0110-polish-journeys.log`, `gate-0110-polish-customer.log`, `.bugloops/polish-live-proof.json`, `release/CANDIDATE-RECEIPT.json`, `release/SHA256SUMS.txt`, and `release/TEST-0.11.0.md`.

## Acceptance and release boundary

No installed application or personal station data was replaced by this task. The owner must install and retest this exact artifact. Previously shared historical uploads cannot be retroactively assigned to a message whose identity was never recorded; test with a newly sent image. A same-version 0.11.0 replacement requires manual installation; do not assume the updater replaces an equal version.

Google Desktop registration, the repository build secret, five APIs and 11 scopes are configured. Google verification and real-account consent/refresh/revocation acceptance remain pending. See [Google activation](GOOGLE_RELEASE_ACTIVATION_0.11.0.md).

Integration's latest `qa:ready` result is **NOT READY — 6 reasons**, including one QA P1, eight customer P1 records, and Guardian/journey/Beginner/installed receipts that do not match current trunk. A source test pass does not close customer recovery or installed acceptance. Signed Mac artifacts and acceptance remain owed.

The versioned polish candidate remains on `agent/release-0110` for owner testing; trunk is `6777742b7`. Documentation follow-through may be a later commit than the immutable packaged source above. No push, tag, hosted draft, publication or public updater change occurred. The local Windows-only manifest must not be published as a complete multi-platform release.
