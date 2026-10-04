---
fingerprint: cb8dc6c3
slug: the-index-js-summarize-closure-captures-the-pre
title: The index.js summarize closure captures the pre-failover provider/model — after a credential rotation or provider fallback, two failed summaries flip compaction
surface: providers
severity: P2
status: fixed
found: 2026-07-28
lane: sweep/providers
fix: fdbb12a2
---

# The index.js summarize closure captures the pre-failover provider/model — after a credential rotation or provider fallback, two failed summaries flip compaction

## Symptom

A run that fails over (credential rotation or cross-provider fallback) and later needs to compact its context makes the summarizer call against the dead credential / failed endpoint. Two failed summaries turn compaction OFF for the rest of the run (loop.js:468,471 `if (++compactionFails >= 2) compactionOff = true`), so when the run then hits a real context_overflow the shouldCompress recovery returns false and the run dies 'error' instead of folding and continuing. On a rate-limited key it also keeps hammering the exact key credpool just cooled.

## Repro

Configure a fallback chain (SETTINGS → Models) or SKYNET_KEY_POOL, drive a long run whose primary returns 401/429 so the loop emits provider.fallback, then keep the conversation going past the 65% compaction threshold. The summarizer call goes to the original provider object on the original credential/model; watch the agent.cost emitted from index.js:10657 name the abandoned model, and watch two failures flip compactionOff.

## Evidence

`sidecar/index.js:10647`

**Mechanism (read from the code):** loop.js owns its OWN provider/model/cost and swaps all three on failover (lines 625-627: `if (fb.cost) cost = fb.cost; provider = fb.provider; if (fb.model) model = fb.model;`). But `summarize` is a closure built in index.js BEFORE the loop starts and captures index.js's own bindings: `const req = { model, stream: true, signal, messages: [...] }` (index.js:10647) and `for await (const ev of provider.stream(req))` (index.js:10652), with `const cost = makeCostEngine({ priceOf: provider.priceOf })` at index.js:10560. index.js's `provider` is assigned once (index.js:10532-10558) and never reassigned, and its `model` (index.js:9898) is never reassigned either (grepped `model = ` across the file — the only hit, line 12115, is an unrelated function). So the failover is fixed at exactly one producer and does not generalize to the injected summarizer.

**Existing test coverage:** test/credrotate.test.js covers failover at the loop level only (it injects no `summarize`). test/loop.provider-recovery.test.js exercises recovery paths with fake summarizers, not the index.js closure. none found for the index.js summarize/failover interaction.

**Adversarial verdict (survived refutation):** Confirmed by reading both sides. The summarize closure is built in index.js before the loop starts: `const req = { model, stream: true, signal, messages: [...] }` is exactly index.js:10647 and `for await (const ev of provider.stream(req))` exactly :10652, over `const cost = makeCostEngine({ priceOf: provider.priceOf })` at :10560. I scanned lines 9890-11500 for reassignment of either binding: `model` is assigned once at :9898 and `provider` only at :10542/:10555/:10557 (the three pre-loop selectProvider branches) — neither is ever rebound after the loop starts. loop.js:305 `const summarize = o.summarize` is captured once and never re-derived, while loop.js:624-627 swaps only the loop's OWN `provider`/`model`/`cost` on failover, and loop.js:467 invokes `summarize(plan.older, prevSummary)` with no provider/model argument that could carry the switch. The downstream chain is real too: loop.js:468 and :470 each do `if (++compactionFails >= 2) compactionOff = true`, and loop.js:438 `if (compactionOff || !context) return false` makes the later shouldCompress recovery at :613-615 a no-op, after which a context_overflow (retryable:false, shouldFallback:false per errorClass REASONS:38) falls straight to `fatal`. No comment anywhere claims this is intentional; the adjacent design note at index.js:10561-10562 shows the author was tracking cost-correctness across failover, not the summarizer's binding. Note the agent.cost emitted at index.js:10657 names the old model truthfully (the call really did go there), so this is a recovery defect, not a telemetry lie.

_Found by the `sweep/providers` lane, 2026-07-28. Finder confidence: medium. Severity claimed P2, after refutation P2._

## Verdict

Fixed by fdbb12a2: maybeCompact passes the loop's live provider/model/cost into the summarizer, and the index closure consumes that state. The real-sidecar regression in e5e4e620 proves compaction after a primary 429 reaches only the backup credential and the run completes.
