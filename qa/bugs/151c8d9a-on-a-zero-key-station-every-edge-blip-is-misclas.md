---
fingerprint: 151c8d9a
slug: on-a-zero-key-station-every-edge-blip-is-misclas
title: On a zero-key station every Edge blip is misclassified as 'no key': no retry, a 60s dead-voice cold-off, and a tooltip demanding a credential the station never
surface: voice
severity: P1
status: fixed
found: 2026-07-28
lane: sweep/voice
fix: 50a8b07b
---

# On a zero-key station every Edge blip is misclassified as 'no key': no retry, a 60s dead-voice cold-off, and a tooltip demanding a credential the station never

## Symptom

An Anthropic-only / Codex-only / fresh station (the exact station the free keyless Edge floor exists for) has working voice. One transient Edge failure — a timeout, a refused upgrade, a network blip — and the agent goes completely silent for a full minute across every reply, while the speaker tooltip reads "🔇 real voice needs an OpenRouter, Gemini, or OpenAI credential · reply shown as text". The user is told to buy an API key to fix a network hiccup on a voice path that is keyless by design.

## Repro

node rig booting the real voice.js; /api/tts answers {fallback:true, reason:<R>}; drive Voice.speak() three times (t=0, t=0, t=+4.2s) and count round-trips. R='edge: edge timeout' → 2 round-trips on reply 1 (retry fired), 2 again at t+4.2s (4s cold-off expired), tooltip clean. R='no key; edge: edge timeout' → 1 round-trip on reply 1 (NO retry), 0 at t+4.2s (still cold), tooltip = '🔇 real voice needs an OpenRouter, Gemini, or OpenAI credential'. R='gemini 429 — {"message":"Quota exceeded for quota metric"}; edge: edge timeout' → 1 round-trip, 0 at t+4.2s, tooltip = 'voice provider out of credits'.

## Evidence

`frontend/app/voice.js:131`

**Mechanism (read from the code):** sidecar/index.js:13088 sets `let keyedReason = ttsKey ? '' : 'no key';` — on a keyless station that string is a STRUCTURAL constant, not a diagnosis. When the Edge floor then fails, index.js:13124 returns `fallback(keyedReason + '; edge: ' + msg)`, i.e. reason = "no key; edge: edge timeout". The client classifier is a substring test that checks the terminal class FIRST: `if (/no key/i.test(reason)) return 'nokey';`. So the transient half of the reason is invisible. Three consequences, all proven live: (1) the one-shot transient retry at voice.js:546 is gated on `classifyFallback(res.reason) === 'error'` and never fires; (2) noteFallback (voice.js:146) arms BILLING_COLD_MS (60s) instead of NEURAL_COLD_MS (4s); (3) startSynth (voice.js:539) short-circuits a BRAND-NEW reply in full while cold (`!replyTried`), so every chunk of every reply for 60s resolves `{kind:'silent'}` without a round-trip. Net effect: on a keyless station the entire transient-failure path is unreachable code. Same substring flaw, second instance: a Gemini per-minute 429 body ("Quota exceeded for quota metric") matches `/quota/i` at line 132 → 'credits' → "voice provider out of credits" + a 60s cold-off for a rate limit that clears in seconds.

**Existing test coverage:** test/voice.button.test.js:198 ('a no key TTS response does NOT permanently disable neural') passes vacuously — it feeds reason exactly 'no key' and asserts the 60s cold-off IS armed, which is correct for a genuinely keyless-and-Edge-disabled station but never exercises the composite reason a keyless station gets when Edge fails. test/sidecar.http.test.js:803-806 asserts /no key/i on the reason with the Edge floor disabled at spawn; the edge-floor block at :1041 only exercises the SUCCESS path. Nothing covers 'no key; edge: …'.

**Adversarial verdict (survived refutation):** Every link verified. sidecar/index.js:13088 is literally `let keyedReason = ttsKey ? '' : 'no key';` and on a keyless station ttsKey is '' unconditionally (13066-13074: no explicit body.key, no runtime key in TTS_KEY_PROVIDERS). edgetts.js:189 `enabled()` returns true by default (`!truthyOff(env('EDGE_TTS'))`), so a keyless station DOES have voice via the Tier-2 floor. When that floor throws, index.js:13124 returns `fallback(keyedReason + '; edge: ' + msg)` — 'no key; edge: …'. frontend/app/voice.js:130-133 classifies by substring with `/no key/i` tested FIRST, so the composite reads 'nokey'. All three consequences confirmed by reading the code: (1) voice.js:546 gates the one retry on `classifyFallback(res.reason) === 'error'` → never fires; (2) voice.js:146 arms BILLING_COLD_MS=60000 (line 120) instead of NEURAL_COLD_MS=4000 (line 114); (3) voice.js:539 `if (Date.now() < neuralColdUntil && (!replyTried || replyFails >= MID_REPLY_GIVEUP))` short-circuits — and since line 540 (`replyTried = true`) sits AFTER the early return and resetQueue() (505) clears replyTried per reply, EVERY chunk of EVERY reply resolves {kind:'silent'} for the full 60s. The keyless tooltip at voice.js:152 then blames a missing credential for a network blip. Worse case also confirmed: index.js:13125 `fallback(keyedReason || 'edge: empty audio')` drops the edge detail entirely on a keyless station. Second instance confirmed too: index.js:12931-12932 splices the raw provider body (300 chars) into the reason, so a Gemini 429 'Quota exceeded for quota metric' hits `/quota/i` at voice.js:132 → 'credits' → 60s cold-off for a per-minute rate limit. Test analysis is correct: voice.button.test.js:198-212 feeds exactly 'no key' (line 200) and asserts the 60s cold-off IS armed — right for a genuinely keyless+Edge-disabled station, vacuous for the composite; sidecar.http.test.js:803-806 runs with the Edge floor disabled at spawn and the edge block at :1041 only asserts the 200/audio SUCCESS path. Nothing feeds 'no key; edge: …'. No comment or law sanctions the composite-as-terminal reading; voice.js:112-119 documents the opposite intent (keep transient cool-offs SHORT).

_Found by the `sweep/voice` lane, 2026-07-28. Finder confidence: high. Severity claimed P1, after refutation P1._

## Verdict

_Filled in when the bug leaves the backlog: what was true, and why it is closed._
