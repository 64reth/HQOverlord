# SWEEP · providers — model routing, OAuth, keys, spend and billing honesty

Read `loops/sweep/README.md` first; it carries the protocol. Surface key: `providers`.
**Rank 2 of 10** — this is the only surface where a bug spends the Commander's money, and the
only one where a comforting error message is worse than a blunt one.

## What you own

`sidecar/providers/` · `routing/` · `runroute.js` · `fallbackchain.js` · `billing.js` ·
`budget.js` · `budgetcaps.js` · `cost.js` · `credits.js` · `credpool.js` · `spend.js` ·
`ledger.js` · `mint-ledger.js` · `servicekeys.js` · `servicekeys-catalog.js` · `insights.js` ·
`frontend/app/ctxgauge.js` · `codexsignin.js` · `keycta.js`

## The failure states to walk

1. **Every 429 is not "wait a few seconds."** "Sign in with ChatGPT" spends the CODEX meter, not
   API billing, and a genuinely exhausted quota currently renders as a transient retry message.
   Drive a real exhausted-quota response and read what the user is told. Three copy/retry
   defects here are known-unbuilt — verify they are still real before rebuilding.
2. **`(unknown)` and `$0.0000` are claims, not blanks.** Reject `(unknown)` unless *every*
   identity source is genuinely missing, and reject `$0.0000` as a final answer on an unmetered
   or unpriced path — those must be *labelled*, not zeroed. Walk: replay, OpenRouter, Codex
   OAuth, fallback, unpriced, unmetered, managed-credit.
3. **The ledger must agree with itself.** For one run, compare provider result → ledger row →
   spend aggregate → Logbook → Insights → HUD. Any two disagreeing is a P0 truthfulness break.
4. **Key every provider catalog BY PROVIDER.** The CTX gauge bug was a catalog keyed by model id
   across providers. Grep for other catalogs keyed on a bare model name.
5. **Device-flow OAuth sends the user somewhere.** A device flow's `verification_uri` may CONSUME
   the code — the user must be sent to `verification_uri_complete`. This broke on Kimi. Re-walk
   every provider's device flow and assert on the URL a user is actually handed.
   **Trap: a fixture that INVENTS the destination proves the wire and nothing about where the
   user is sent.** Pin fixtures to live-captured payloads.
6. **Fallback must not lose identity.** Force the primary model to fail mid-run. Does the
   fallback model's name reach the ledger and the UI, or does the run report the model it
   *wanted*?
7. **A key that is present but wrong.** Not "no key" — a syntactically valid, rejected key. Walk
   billing-declined, revoked, and wrong-org. Each must produce a distinct, actionable message;
   none may be retried as if transient.
8. **Budget caps bound the LEAD only.** A per-run `$` cap is known not to bound spawned workers
   (each carries its own `maxCostUsd`). Verify against trunk, then walk a team dispatch and see
   what the total actually is.

## Done means

Replay-path proofs for everything, plus at least one live paid smoke if a real key is available
(say so explicitly if not). Every cost or model string you assert must be traced to the backend
state that proves it — if the UI can say it and the harness cannot prove it, that is the bug.
