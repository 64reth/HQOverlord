---
fingerprint: 8d7b0b52
slug: credpool-penalize
title: credPool.penalize() on the run's PRIMARY key is inert — the sole credPool.order() call site (index.js:10580) receives a pool with runKey filtered out
surface: providers
severity: P2
status: fixed
found: 2026-07-28
lane: sweep/providers
fix: fdbb12a2
---

# credPool.penalize() on the run's PRIMARY key is inert — the sole credPool.order() call site (index.js:10580) receives a pool with runKey filtered out

## Symptom

After a 429/auth/billing failure rotates off the primary provider key, the very next run tries that same cooling key FIRST again, and again for every run inside the 5-minute cooldown — burning one wasted round-trip and one of the loop's bounded recovery slots each time. index.js:11219's own comment claims the opposite: "so a rate-limit/auth/billing key gets a cooldown (credpool) and isn't tried first next run."

## Repro

Set SKYNET_KEY_POOL=KEYB,KEYC with OPENROUTER_KEY=KEYA. Drive a run whose first stream call 429s: the loop rotates A→B, onFallback fires with credKey 'KEYA', credPool.penalize('KEYA') runs. Start a second run within 5 minutes: index.js:10578 builds pool = ['KEYB','KEYC'] (KEYA filtered out), order() sinks nothing relevant, and the run still opens on KEYA and 429s again. Confirmable statically — `credPool.order` has exactly one call site and its argument provably excludes runKey.

## Evidence

`sidecar/index.js:10579`

**Mechanism (read from the code):** loop.js:621 reports the OUTGOING key: `onFallback({ reason, rotate, credKey: activeCredKey, … })`, and `activeCredKey` starts as the run's primary (index.js:11220, `credKey: providerUnmetered ? null : runKey`). index.js:11228 then records `credPool.penalize(credKey, ttlMs)`. But the only consumer of that cooldown is `credPool.order(...)`, called exactly once, at index.js:10580, on a list that has already had the primary stripped: `const pool = (Array.isArray(o.keyPool) ? o.keyPool : String(ENV('KEY_POOL')||'').split(',')).map(s=>String(s||'').trim()).filter(s => s && s !== runKey);`. runKey is never a member of any list passed to order(), and the next run's primary is re-derived from providerRuntimeKey(), not from the pool ordering — so the cooldown recorded for it can never affect anything. credpool.js:40-46 `coolingUntil` is likewise called only from inside `order()` (line 64) and is exported but unused elsewhere (grepped sidecar/). Cooldowns for ALTERNATE keys do work; only the primary — the key most likely to be rate-limited, since it is always tried first — is affected.

**Existing test coverage:** test/credrotate.test.js:52 — `A.eq(credPool.order(['KEYA','KEYB']), ['KEYB','KEYA'], 'failed key A is now cooled to the back of the order')`. It passes because the test hands order() a list that INCLUDES the primary; production never does. test/credpool.test.js tests the pure module only, never the index.js wiring.

**Adversarial verdict (survived refutation):** Verified end to end. sidecar/index.js:10578-10579 builds the pool with `.filter(s => s && s !== runKey)` and :10580 is the ONLY call to credPool.order() in the whole sidecar (grep 'credPool\.' returns exactly two sites: :10580 order, :11228 penalize). runKey is derived independently at index.js:9900 `const runKey = providerRuntimeKey(providerId, key);`, never from the pool ordering, so a cooldown recorded for it can affect nothing. loop.js:318 `let activeCredKey = (o.credKey != null) ? o.credKey : null` seeds from index.js:11220 `credKey: providerUnmetered ? null : runKey`, and loop.js:620-621 fires onFallback with the OUTGOING key before switching — so the first rotation really does penalize the primary. credpool.js confirms coolingUntil() is consumed only from inside order() (:64). The comment at index.js:11218-11219 ('so a rate-limit/auth/billing key gets a cooldown (credPool) and isn't tried first next run') is therefore false for the one key most likely to be limited. Cooldowns for ALTERNATE keys do work, exactly as the claim scopes it. test/credrotate.test.js:52 does pass vacuously with respect to production: it hands order() a list containing the primary, which index.js:10579 provably never does.

_Found by the `sweep/providers` lane, 2026-07-28. Finder confidence: high. Severity claimed P2, after refutation P2._

## Verdict

Fixed by fdbb12a2: runOnce now consults the primary key's cooldown, starts on a warm alternate, demotes the cooling primary, and passes the actually active key into the loop. The real-sidecar regression in e5e4e620 proves a second run does not touch the cooled primary after backup success.
