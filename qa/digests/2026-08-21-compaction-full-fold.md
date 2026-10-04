# Compaction that keeps the run's memory — Lane A digest (2026-08-21)

Branch `agent/compaction-full-fold` off trunk `bc797dc72`. NOT merged.

## The defect (proved on trunk before any change)

`runOnce`'s summarizer rendered the foldable slice then `.slice(0, 16000)`: a 300–500k-char fold reached
the model as its OLDEST ~16k chars. `test/compaction-summarizer.test.js` (a) seeds 400 messages with one
unique marker each and checks every marker reaches the summarizer; against the trunk behaviour
(`COMPACTION_LEGACY_16K=1`) it fails with **384 of 400 markers missing**. Also on trunk: the directive (first
user message) sat inside the foldable slice; the tail was 6 *messages* (~2 tool turns); a tripped
summarizer breaker (2 failures or 2 <10% folds) left `context_overflow` with no fold → run ended `error`.

## What changed

| Slice | Where | What |
| --- | --- | --- |
| A1 | `sidecar/compaction-summarizer.js`, `sidecar/index.js` | summarizer extracted: `makeSummarizer({provider, model, cost, signal, emit, auxModelFor, auxEffortFor, summaryPrompt, transcriptDrain, memoryBlockFor, chunkChars, maxChunks})`; index.js is thin wiring; aux-tier retry-once floor, abort semantics, strict transcript drain and durable-memory prepend kept |
| A2 | same | **chunked fold**: rendered slice partitioned at `STARNET_COMPACT_CHUNK_CHARS` (default 48000), never across a tool pair; chunk 1 merges prevSummary, chunk N merges chunk N-1's summary (existing MERGE prompt), sequential; usd/tokens/unpricedUsage summed; `STARNET_COMPACT_MAX_CHUNKS` (12) → remainder folded as one marked chunk, `truncatedChars` reported |
| A3a | `sidecar/loop.js` | the directive (first non-system message) is pinned byte-identical in the prefix |
| A3b | `sidecar/context.js` | `keepTailTurns` (assistant + its tool results = 1 turn; default 6 turns); legacy `keepTail` keeps message semantics for existing callers; `thresholdTokens()` |
| A3c | `sidecar/loop.js` | **micro tier** before any paid fold: tool results older than the tail elided on a COPY; committed only if the PROVIDER's count scaled by the local shrink ratio clears the threshold (`agent.compact` reason `micro`, `elided`); each elision keeps the first 240 chars of the result; `STARNET_COMPACT_MICRO=0` turns it off |
| A3d | `sidecar/loop.js` | breaker tripped → deterministic bullet digest of the originals (no LLM), reason `fallback`, returns true so the overflow retry proceeds |
| A4 | `sidecar/loop.js` | `agent.compact` additive fields `chunks`, `truncatedChars`, `elided`; `reason` now also `micro` / `fallback` |
| proof | `sidecar/index.js`, `dev/compaction-live-proof.js` | `STARNET_CONTEXT_LIMIT_OVERRIDE` (test/soak only) + a real-model proof driver |
| prompt | `sidecar/context.js` | `compactionSummaryPrompt`: collected results are NEVER obsolete — carried forward verbatim through the merge chain |

## What the live proof taught (each one changed the code)

Driver: hermetic `SidecarFixture` → forwarding proxy to real OpenRouter that rewrites the catalog
`context_length` (+ the override env) → `anthropic/claude-haiku-4.5` reads a 30-file CHAIN (each file
names the next, so reads can't be batched) with one unique token per file, then lists every token.

1. A 6000-token window sits under the real fixed prefix (~30k tokens WITH tool schemas; the local
   estimator sees ~10k) — threshold unreachable, every fold <10%, breaker trips. Proof window must exceed
   the prefix (60k). The local/provider ruler gap is ~3x.
2. The micro tier "cleared" the threshold on the LOCAL ruler while the provider still counted 2x over it:
   one elision per turn, the paid fold starved. Fixed: project the provider's count by the local ratio.
3. A bare `[elided]` marker → the model **confabulated 20 of 30 values** (listed 30 "tokens", 20 invented).
   Fixed: keep each result's first 240 chars in the marker. Re-run: 30/30.
4. The fallback digest was built from already-elided bodies → forgot everything. Fixed: digest originals.
5. 3000-char chunks on this task overflow the 12-chunk cap: `chunks:12, truncatedChars:11390` and the 7
   missing tokens were exactly the truncated files (14–20) — the cap's telemetry is truthful.
6. With the chunk chain at 7 merges, 1 run in 5 dropped the early values (merge prompt's "drop anything
   now obsolete") and confabulated 17 — fixed with the NEVER-obsolete clause; see results below.

## Live results (micro off so the paid chunked fold is the path under test)

Unchanged merge prompt: 9/10 across two 5x batches — the one miss confabulated tokens 1-17 after the
7-step merge chain dropped them. With the NEVER-obsolete clause (`83f2498f1`): **5/5 PASS**
(`gen-trees/proof5x-c.log`). Every run: `reason:done`, 32 turns, $0.21-0.30, one `agent.compact`
`{reason:'context', chunks:7, before:20181, after:11799-11915}`, 7 summarizer requests seen by the proxy,
final answer 30/30 correct tokens, first five 5/5 — those files were folded ~14 turns before the answer and
the model wrote zero narration, so the tokens could only have arrived through the chunked summary.

## Gate (at `83f2498f1`, ~1.3 GB free RAM, no starvation exit)

```
run-fast-tests: OK — 660 step(s) green
run-test-list: OK — 78 step(s) green
```

## Owed

- `shared/events.js` `agent.compact`: declare `chunks:int`, `truncatedChars:int`, `elided:int` (schema
  tolerates undeclared fields today — `obj()` sets no `additionalProperties:false`; `reason` is already `str`).
  Request to the contract owner; additive.
- Frontend: nothing renders `reason:'micro'|'fallback'` specially yet (events validate; display unchanged).
- The micro tier is a fidelity trade: facts deeper than 240 chars into an old tool result are gone until
  the tool is re-run. Off switch exists (`STARNET_COMPACT_MICRO=0`).
