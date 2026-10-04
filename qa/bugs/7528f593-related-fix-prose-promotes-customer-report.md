---
fingerprint: 7528f593
slug: related-fix-prose-promotes-customer-report
title: Reconciler mistakes related repairs for reported bug resolution
surface: release
severity: P1
status: fixed
found: 2026-09-05
lane: reliability-audit
fix: ef5585145
origin: audit
---

# Reconciler mistakes related repairs for reported bug resolution

## Symptom

An unresolved customer report becomes `likely-fixed` in reconciliation after its verdict
mentions a related repair, even when the text explicitly says it did not reproduce the symptom.
That can create misleading stale-record pressure to close the investigation.

## Repro

Create a customer-origin open record with no `fix` field. In its Verdict, state that a known
ancestor commit does NOT reproduce the customer's disappearance and cite a passing baseline
test for a different symptom. Run `makeReconciler().judgeRecord()` or `qa:reconcile`.

## Evidence

`test/qa-bug-lifecycle.test.js`, scenario "related fix prose cannot promote an unresolved
customer report in reconciliation", failed before repair: actual `likely-fixed`, expected
`unverifiable`. The same test passes after repair. Existing `test/ledger-reconcile.test.js`
passes all 82 assertions, preserving the legacy sweep behavior.

Live CLI read of the imported six open reports with `--no-run --no-write --json` now returns
zero likely-fixed and six unverifiable. That is an evidence limitation, not a recovery claim.

## Verdict

Fixed by ef5585145. Customer/owner records use their explicit fix field for source-causal
evidence. Related prose, passing baseline tests and missing files cannot infer that their
reported symptom is resolved. Failing named tests still report still-open. Historical sweep
records retain the existing semantics. This is QA tooling, not an installer or customer fix.
