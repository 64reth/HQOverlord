---
fingerprint: 37059128
slug: cancelled-edit-starts-a-replacement-language-ser
title: Cancelled edit starts a replacement language server
surface: autonomy
severity: P2
status: fixed
found: 2026-09-05
lane: reliability-audit
fix: 547dd03d7
origin: audit
---

# Cancelled edit starts a replacement language server

## Symptom

A cancelled edit can start a new language-server process after its prior server has
been reaped, despite never modifying the file. This wastes work after cancellation.

## Repro

Run `test/lsp-edit-feedback.test.js`: edit a supported file using the real stdio fixture,
wait for the manager to reap the idle server, then request another edit with an already
aborted signal. Compare process-ledger records and cached clients before and after.

## Evidence

The final integration fast gate exposed two recorded language-server children where
one was expected. A deterministic cold-server regression failed before the repair:
`an already-cancelled edit never starts a replacement language server — expected 1, got 2`.
After the repair, the real stdio test passes all 31 assertions, including no replacement
client, no new process, idle cleanup, diagnostic deltas and no cancelled file mutation.

## Verdict

Fixed in 547dd03d7: beginEdit checks cancellation before acquiring a client or starting its process. The real stdio regression passes 31 assertions; installer behavior remains unverified.
