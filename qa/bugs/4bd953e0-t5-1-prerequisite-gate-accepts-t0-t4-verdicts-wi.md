---
fingerprint: 4bd953e0
slug: t5-1-prerequisite-gate-accepts-t0-t4-verdicts-wi
title: t5.1 prerequisite gate accepts T0–T4 verdicts with no installer-hash or freshness binding, though t3.2 already binds T0's recorded installer sha256 to the binar
surface: release
severity: P2
status: fixed
found: 2026-07-28
lane: sweep/release
fix: b76e340c
---

# t5.1 prerequisite gate accepts T0–T4 verdicts with no installer-hash or freshness binding, though t3.2 already binds T0's recorded installer sha256 to the binar

## Symptom

`publicDistributionReady=true` can be stamped for a binary that was never clean-installed, never state-safety tested and never update-delivery tested. Build installer A, run t0–t4 to green, then rebuild (any code change) and run only `npm run t5:public-distribution`: T5.1 passes on A's leftover evidence while T5.2 hashes the NEW installer, and the lane emits a green public-distribution verdict for B. That is the false green this lane's governing law calls the worst outcome in the repo.

## Repro

With a built installer: `npm run t0:clean-install` … `npm run t4:update-delivery` to green, then `touch`/rebuild so `src-tauri/target/release/bundle/nsis/*-setup.exe` has a new sha256, then `npm run t5:public-distribution` with STARNET_T5_DISTRIBUTION_EVIDENCE pointing at evidence for the new build. t5.1-prerequisite-gates reports 'T0, T1 public, T2, T3, and T4 are green.' referencing the OLD binary's evidence; nothing in the status JSON records which installer those verdicts were about.

## Evidence

`scripts/t5-public-distribution.mjs:144`

**Mechanism (read from the code):** `checkPrereqs` (lines 134-158) reads `.dogfood/t{0..4}-*-latest/*-status.json` and only inspects verdict/ready booleans: `if (gates.t0.status && !readyValue(gates.t0.status, 'cleanInstallProofReady'))`, `gates.t1.status.publicReleaseReady !== true`, etc. There is no `generatedAt` freshness check and no comparison of the installer sha256 those runs recorded against `currentInstallerInfo()` — even though it computes exactly that hash three lines later in `checkArtifacts` (line 181). The `-latest` dirs are unconditionally re-stamped by `copyLatest()` on every run of every rung, so they persist across rebuilds indefinitely. The repo already knows how to do this correctly: `t3-release-smoke.mjs:130-141` reads T0's status, pulls `r.artifacts.installer.sha256` out of it, and refuses unless `t0Hash.sha256 === String(installerInfo.sha256).toLowerCase()`. t5 — the LAST gate before publishing to real users — is the one that skipped it.

**Existing test coverage:** test/t5-public-distribution.test.js — it exercises t5.1 only in the missing-status direction (asserts `nextAction.id === 't5.1-prerequisite-gates'` when the gate files are absent) and stubs the prereq statuses green thereafter. No test writes a green prereq status for one installer sha and then runs t5 against a different installer, so the staleness path is untested.

**Adversarial verdict (survived refutation):** Confirmed. scripts/t5-public-distribution.mjs:134-158 checkPrereqs reads the five status JSONs and inspects only verdict/ready booleans via readyValue (:121) — no generatedAt freshness check and no installer-hash comparison, even though currentInstallerInfo/fileInfo already computes sha256 (:32-40) and checkArtifacts uses it three steps later. sameHash is defined at :117 but is used exactly once, at :207, and only against the human-supplied evidence document's release.installerSha256 — never against the prereq statuses. copyLatest (:51-58) unconditionally re-stamps the -latest dir at the end of every run (:363), so old evidence persists across rebuilds. The precedent is real: t3-release-smoke.mjs:130-141 pulls r.artifacts.installer.sha256 out of T0's status and fails the step unless it equals the current installer's hash. test/t5-public-distribution.test.js stubs all five prereq statuses green via STARNET_T5_T{0..4}_STATUS and never writes a green prereq for one installer sha then runs against another, so the staleness path is untested. Minor correction to the claim's framing: t3 binds only T0's hash (its checkT2 at :143-150 does not), so the precedent is narrower than 't3 does that binding' implies, and t5's own evidence step DOES bind the installer hash — the unbound surface is specifically T5.1's prereq verdicts.

_Found by the `sweep/release` lane, 2026-07-28. Finder confidence: medium. Severity claimed P2, after refutation P2._

## Verdict

Confirmed and closed. T5.1 now requires installer-bearing T0/T1/T3/T4 receipts to record the current installer hash and bytes, and requires every T0-T4 receipt to be generated after the candidate installer; T2 is freshness-bound because it is a repository-level state-safety proof. Hashless, stale, and different-installer receipts fail closed. Focused gate: 35 assertions green.
