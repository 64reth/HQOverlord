# StarNet product-perfection convergence

This directory defines the literal product bar requested by the owner: every created feature,
release-facing UI implementation, and backend promise must be fully polished and work in the running
product. It is deliberately stricter than `qa:ready`, which is a release-readiness aggregate rather
than an exhaustive product-perfection proof.

`waves.json` is the tracked goal contract. Runtime status is always derived; nobody edits a `done`
flag. `scripts/qa/product-perfect.mjs` runs the verifier for the first non-passing wave and writes
candidate-bound receipts beneath `.dogfood/product-perfect/` (gitignored). A receipt is reusable only
when all of these still match:

- the exact Git commit;
- the exact wave definition hash;
- the wave ID and dependency order;
- a real verifier exit code of zero.

Changing source or a wave condition re-queues the affected proof. Missing/unreadable evidence is
`BLOCKED`, never green. The controller serializes the campaign: later waves do not run while an
earlier wave is failing or stale.

W0 is intentionally narrow. It locks the current advertised-claims inventory, the
official/reproducible-source/custom/dirty-dev taxonomy, and exact installed desktop identity. It
does not require hardware-rooted anti-owner proof, and it does not run the broad `qa:ready`
aggregate. W1 then proves the clean installed first-user journey. Only afterward may the
W0-verdict-filtered security work (W2), UI/recovery unification (W3), capability decision matrix
(W4), autonomy honesty (W5), integration/full-surface proof (W6), and frozen 48-hour candidate
(W7) advance.

The claims ledger has two distinct verdicts. Its W0 planning verdict means the finite inventory is
source-current and every material promise has a code-backed SHIPPED/PARTIAL/MISSING/REFUTED or
EXPERIMENTAL disposition. It is not product proof. Its terminal verdict stays blocked until W6
has candidate-bound installed lifecycle evidence or a visible point-of-use experimental label for
every advertised promise.

## Commands

```powershell
node scripts/qa/product-perfect.mjs --status
node scripts/qa/product-perfect.mjs --run
node scripts/qa/product-perfect.mjs --wave W0
```

`--status` is read-only. `--run` reuses current valid pass receipts, runs forward in order, and stops
at the first non-pass. `--wave` is mainly for focused development and refuses to run when a dependency
is not current and green.

Exit codes are `0` only for a passing requested wave or the terminal `PRODUCT PERFECT` aggregate,
`1` for a verifier-proved failure, and `2` for missing/unverifiable/blocked proof.

The final verdict remains product validation only. Publishing or other external release operations
require separate owner authorization.
