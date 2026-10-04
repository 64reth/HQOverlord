---
fingerprint: e89317af
slug: no-quota-exhaustion-error-class-exists
title: No quota-exhaustion error class exists: a 429 from a spent Codex/subscription weekly quota renders as 'the provider is busy — wait a few seconds' and burns up t
surface: providers
severity: P1
status: fixed
found: 2026-07-28
lane: sweep/providers
fix: fdbb12a2
---

# No quota-exhaustion error class exists: a 429 from a spent Codex/subscription weekly quota renders as 'the provider is busy — wait a few seconds' and burns up t

## Symptom

A ChatGPT-subscription (Codex) user who has burned their weekly quota — which resets in days — is told the provider is momentarily busy and offered ↻ Try again. Every retry is doomed. The message also implies API billing when the meter that was actually spent is the ChatGPT subscription one, so "top up" advice elsewhere in the UI points at the wrong lever.

## Repro

Sign in with ChatGPT, exhaust the Codex weekly quota (or replay a 429 whose body is `{"error":{"message":"You've hit your usage limit. Resets in 3 days","type":"usage_limit_reached"}}`) and read the COMMS error row. Headless: `Friendly.friendlyError(Object.assign(new Error('codex http 429 — You have hit your usage limit'), {status:429}))` → kind 'rate_limit', userMessage "…busy (too many requests) — wait a few seconds…", retryable true.

## Evidence

`frontend/app/friendlyerror.js:75`

**Mechanism (read from the code):** errorClass.js:143 `if (status === 429) return 'rate_limit';` fires in step 2 (HTTP status), strictly before step 4's message patterns at line 161 (`/insufficient|not enough credit|out of credit|quota|payment required|add credits/ -> 'billing'`), so a 429 body saying "you've hit your usage limit" can never reach the quota branch. REASONS.rate_limit is `{ retryable: true, shouldRotateCredential: true }` (errorClass.js:34). codex.js:361-367 builds `new Error('codex http 429 — ' + detail)`, classifies it, and because `cls.retryable` is true it burns RETRY_DELAYS attempts against the exhausted quota before throwing; loop.js:636-644 then spends up to MAX_STREAM_RETRIES=2 more, and loop.js:662 emits `agent.run.error` with `transient: true`. friendlyerror.js maps reason→kind via REASON_TO_KIND (line 115) to `rate_limit`, whose copy is verbatim `'The model provider is busy (too many requests) — wait a few seconds and try again.'` with `retryable: true, action: null` — no door, no reset time, no mention of the subscription meter. There is no branch anywhere for a quota-exhaustion 429: grepping sidecar/ and frontend/app/ for `usage_limit|resets_at|plan_type` returns nothing.

**Existing test coverage:** test/errorclass.test.js:24-25 (`429 -> rate_limit`, `rate_limit retryable`) and test/friendlyerror.test.js:146-150 (`A.ok(/too many requests|busy/i.test(v.userMessage))`) both PIN the current copy — the tests assert the lie rather than catching it. No test drives a quota-exhaustion body.

**Adversarial verdict (survived refutation):** Code claim verified. sidecar/providers/errorClass.js:143 `if (status === 429) return 'rate_limit';` sits in step 2 (HTTP status), before the step-4 message patterns at :161, and REASONS.rate_limit at :34 is `{retryable:true, shouldRotateCredential:true}`. frontend/app/friendlyerror.js:75 is verbatim `rate_limit: { retryable: true, action: null, msg: 'The model provider is busy (too many requests) — wait a few seconds and try again.' }`, reached via REASON_TO_KIND (:115) and the final `return { userMessage: k.msg, … }`. I traced friendlyError()'s earlier special-case branches (managed_credit, grok, grok/kimi oauth, chatgpt sign-in, spotify, capdenied, agent_busy, stale_session) — none matches a codex 429 quota body, so it falls to classifyApiError. sidecar/providers/codex.js:361-366 does build `new Error('codex http ' + res.status + ' — ' + detail)` and burns RETRY_DELAYS=[400,1200] because cls.retryable is true; loop.js:636-644 spends up to MAX_STREAM_RETRIES more. errorClass.extractRetryAfter only parses ms/s/m units (:106), so a 'resets in 3 days' hint yields nothing and no reset time can surface even if the copy wanted one. Two corrections that do NOT save the claim: (a) the cited existing test does not exist — grep finds no 'too many requests' assertion in test/friendlyerror.test.js; the real pin is :138 `const bad = /max_iters|max_tokens|sidecar HTTP|429|4\d\d|…/` asserting no technical token appears in KINDS copy; (b) the 'implies API billing / top up points at the wrong lever' half is wrong — the rate_limit kind has `action: null`, so no billing door is offered. Status-before-message precedence is deliberate (documented at errorClass.js:13 and :128-134), so the fix is a quota-exhaustion class, not a reordering.

_Found by the `sweep/providers` lane, 2026-07-28. Finder confidence: high. Severity claimed P1, after refutation P1._

## Verdict

_Filled in when the bug leaves the backlog: what was true, and why it is closed._
