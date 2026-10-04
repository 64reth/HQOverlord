---
fingerprint: 3d9dce85
slug: filtered-journey-run-can-replace-the-full-releas
title: Filtered journey run can replace the full release journey receipt
surface: release
severity: P1
status: fixed
found: 2026-09-06
lane: agent/release-ui-audit-0906
fix: 042394b7d
origin: audit
---

# Filtered journey run can replace the full release journey receipt

## Symptom

A focused passing journey rerun replaces the canonical release receipt after the
complete journey suite failed. `qa:ready` then marks its Journey corps check PASS,
although the remaining journeys were not re-proven. Other readiness checks can still
correctly prevent the aggregate READY verdict.

## Repro

1. Run `npm run qa:journeys`; preserve the complete result.
2. Run `npm run qa:journeys -- --only J4` successfully on the same commit.
3. Read `qa/journeys-last-run.json` and run `npm run qa:ready`.
4. The focused result overwrites the full result without identifying its limited scope;
   the readiness checker accepts it as the Journey corps pass.

## Evidence

Observed on `d107e5ef2` in the isolated audit worktree:

    full suite: JOURNEYS FAIL (exit 3) — 121/122 assertions passed
    --only J4: JOURNEYS PASS — 13/13 assertions passed
    qa:ready: [PASS] Journey corps last run
              value: PASS · 13/13 assertions

Evidence files in `.bugloops/release-ui-audit-0906/`: `release-audit-journeys.log`,
`release-audit-j4.log`, and `release-audit-ready.log`. The overall readiness verdict remained NOT READY;
this finding concerns its falsely satisfied journey component.

Source anchors: `scripts/qa/journeys.mjs:995` unconditionally writes the last-run stamp
from `finish`, including runs selected by `ONLY`. `scripts/qa/ready.mjs:195` accepts
result=pass plus current commit and freshness without checking full journey coverage.

## Verdict

Receipts explicitly record `fullSuite: ONLY === null`;
the readiness reader requires boolean true. Focused diagnostics can still record their
result, but cannot satisfy the full-suite gate. Legacy receipts lacking coverage proof
also require a fresh full run.
No claim is made that the newest visual merges introduced this pre-existing gap.

## Regression

`test/qa-ready.test.js` failed three assertions before the repair and passes 118/118
after it. False, absent, and string-valued fullSuite flags cannot qualify.
A live `--only J6` run passed 6/6, wrote `fullSuite:false`, and `qa:ready` reported:
`Journey corps last run: journeys receipt does not prove the full suite`.
After-fix evidence: `release-audit-subset-after.log` and `release-audit-ready-after.log`
under the audit artifact directory. This QA-only change does not require an installer.
The complete live run exposed a null-filter error in the first writer patch; an
executable producer test now verifies both actual argument-parser paths, including
the unfiltered null value, before the final full-run receipt is accepted.
Final full live rerun on `4f338ad8d` passed 130/130 and saved `fullSuite:true`,
`exitCode:0`, and the exact candidate SHA in `qa/journeys-last-run.json`.
The exact candidate also passed all 723 fast-gate steps, exit 0.
