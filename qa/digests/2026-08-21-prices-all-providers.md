# 2026-08-21 — Lane B: every metered provider priced (spend caps work everywhere)

Branch `agent/prices-all-providers` (forked from trunk `bc797dc72`). NOT merged.

## Why

`sidecar/providers/prices.js` knew two families (anthropic, gemini). `openai-compatible.js` priced only from the
catalog `pricing` block, which OpenAI's `/v1/models` (and every clone of it) never carries. So on openai / xai /
groq / mistral / deepseek / together / fireworks every turn reconciled at `$0`, `spentUsd` never moved, and
`spentUsd >= maxCostUsd` in loop.js could never fire. Separately, `anthropic.js` replays `msg.reasoning`
verbatim and the fallback branch swapped model/provider without stripping it — a block signed by model A
replayed to model B 400s on the first retried turn.

## What changed (commits, oldest first)

| commit | slice | change |
|---|---|---|
| `da3d5841f` | B1 | prices.js: OPENAI / XAI / GROQ / MISTRAL / DEEPSEEK / TOGETHER / FIREWORKS tables, each ending in family fallbacks; ANTHROPIC refreshed with Claude 5 (fable-5, mythos-5, opus-5, sonnet-5) and opus 4.6/4.7/4.8; GEMINI with 3.x; CACHE multipliers for openai (0.10x), deepseek (0.02x), mistral (0.10x). Header records the 2026-08-21 verification sources. |
| `baf08fc90` | B1 | existing test: the gemini flash family fallback now tracks the 3.5 flash tier (1.50, was 0.30). |
| `f8cc98915` | B2 | liveprices.js `FAMILY_TO_PROVIDER` → `openai`, `xai`, `groq`, `mistral`, `deepseek`, `together: 'togetherai'`, `fireworks: 'fireworks-ai'` (keys probed from https://models.dev/api.json the same day; extractor + disk-cache revalidation already iterate the map). |
| `777c7464d` | B3 | openai-compatible.js `priceFamily` option: catalog pricing → `prices.priceOf(family, id)` → null; `listModels` publishes `pricingBlock` like anthropic.js. factory.js threads `profile.priceFamily`; registry.js declares it on the seven metered profiles. |
| `26c9ad14e` | B4+B5 | loop.js: `limits.maxUnpricedTokens` — tokens reconciled `unpriced` accrue and the guard ends `'budget'` (`budgetScope:'run'`, plus additive `unpricedModel` / `unpricedTokens` / `unpricedCapTokens` and a `budgetNote` sentence on the return); `agent.cost` carries `unpriced:true` once per run. index.js `CAPS.maxUnpricedTokens` = 2,000,000 (env `SKYNET_MAX_UNPRICED_TOKENS`), passed as `Infinity` for unmetered / codex / device-OAuth. Fallback branch deletes `reasoning` from every assistant message when model or provider changes; `provider.fallback` gains `reasoningDropped`. |
| `22555fcff` | tests | `test/prices.all-providers.test.js` (119 assertions, registered in fast.list) + live fixture extended with openai/xai/togetherai/fireworks-ai. |

`shared/events.js` / `shared/schema.js` untouched. `obj()` there declares no `additionalProperties`, so the
additive event fields validate (asserted in the new test with `schema.validate`).

## Rates — provenance

- Anthropic: claude-api skill reference (2026-06-24 snapshot); models.dev concurs. `claude-sonnet-5` is the
  $3/$15 LIST rate (intro $2/$10 through 2026-08-31 → over-reports until then). `claude-mythos-preview`-style ids
  ride the mythos row unverified (commented).
- OpenAI: developers.openai.com/api/docs/pricing. `gpt-5.2-pro`, `gpt-5.3-*`, `gpt-5-pro`, `o3-mini`, `gpt-4.1-nano`,
  `gpt-4o-mini`, gpt-4/-turbo/3.5 are models.dev-only (commented per row). Bare `gpt-5.6` is not on the vendor page
  — family fallback at the sol rate.
- xAI: docs.x.ai/docs/models, <200k tier (≥200k bills 2x → under-reports on huge prompts). `grok-4`/`grok-3`/
  `grok-code-fast-1` (registry staticModels) are no longer listed — family fallback only.
- Gemini: ai.google.dev pricing (3.6/3.7 flash rates double 2027-01-01).
- Mistral: mistral.ai/pricing/api. Groq: console.groq.com/docs/models (only gpt-oss rows are vendor-verified).
- Together: together.ai/pricing. Fireworks: docs.fireworks.ai/serverless/pricing (incl. size tiers; any unknown
  serverless id → 1.20 top tier).
- DeepSeek: vendor page is JS-rendered and unreadable headless; rows carry models.dev + benchlm.ai figures
  (two concurring sources, 0.435/0.87 pro, 0.14/0.28 flash). Other aggregators report a peak-hours tier up to
  3x → may UNDER-report at peak. Flagged in the file header and table comment.

## Evidence

Gate (from the worktree, read from log tails):
```
run-fast-tests: OK — 660 step(s) green          (..\prices-gate.log, 0 FAIL lines)
run-test-list: OK — 78 step(s) green            (..\prices-http.log)
```

Live proof — real `sidecar/index.js` process, provider `openai`, `baseUrl` pointed at a mock api.openai.com
whose `/models` has NO pricing, mock usage 40,000 in / 2,000 out per call:
```
[NORMAL] agent.cost: {"usd":0.13,"tokensIn":40000,"tokensOut":2000,"model":"gpt-5.4","reconciled":true} ×2
[NORMAL] agent.run.end: {"reason":"done","turns":2,"usd":0.26}
[NORMAL] ledger.jsonl: {"runId":"da35a318-…","turns":2,"usd":0.26,"tokens":84000,"model":"gpt-5.4","unmetered":false}
[CAP $0.001] agent.run.end: {"reason":"budget","turns":1,"usd":0.13,"budgetScope":"run","budgetCapUsd":0.001}
```
0.13 = 40,000 × $2.50/M + 2,000 × $15/M — exactly the gpt-5.4 row, i.e. `costSource 'catalog'` (the ledger row
itself stores usd/tokens/model only; `costSource` is a cost.reconcile field, not a ledger column). The cap env
that exists is `SKYNET_BUDGET_PER_RUN` (there is no `SKYNET_MAX_COST_USD`).

## NOT verified

- No real vendor key was spent; the live proof uses a mock endpoint (the priceFamily path is what was under test).
- The unpriced-token ceiling and the fallback thinking-strip are proven by tests driving the real `runAgentLoop`
  (new suite D/E), not by a sidecar-process run.
- Rates will drift; the live models.dev layer (now covering all nine families) supersedes the snapshot at runtime.
- `cerebras` (api_key, openai-compatible) is deliberately on the ratchet's `UNPRICED_BY_DESIGN` allowlist — the
  unpriced-token ceiling is its seatbelt. `starnet` (managed) likewise: the proxy bills the ledger itself.
