---
fingerprint: 562b14a5
slug: the-api-stt-degrade-reason-is-written-to-the-sta
title: The /api/stt degrade reason is written to the status line then overwritten by endListening()'s restore in the same synchronous block, so it is never painted
surface: voice
severity: P2
status: fixed
found: 2026-07-28
lane: sweep/voice
fix: 50a8b07b
---

# The /api/stt degrade reason is written to the status line then overwritten by endListening()'s restore in the same synchronous block, so it is never painted

## Symptom

When transcription legitimately fails with a reason ('no key', 'groq: whisper-large-v3-turbo 500', 'openai: 429'), the code makes a point of surfacing it — and the user never sees a single character of it. The status line goes straight from 'listening…' back to 'online'. The only surviving trace is a console.warn nobody has open.

## Repro

rig, recorder path, /api/stt returns the documented degrade {text:'', reason:'groq: whisper-large-v3-turbo 500'}. statusLog === ['listening…', 'voice: groq: whisper-large-v3-turbo 500', 'online'] but the final DOM textContent is 'online' — both writes land in the same synchronous block, so the middle value is never rendered.

## Evidence

`frontend/app/voice.js:1048`

**Mechanism (read from the code):** finish() at voice.js:903-907 runs three statements in ONE synchronous .then body: `if (!text && reason) { setStatus('voice: ' + reason.slice(0,60)); … } cb.onFinal(...); cb.onEnd();`. `cb.onEnd` is `() => endListening()` (line 1034), and endListening ends with an UNCONDITIONAL restore: `if (!busyNow() && !speaking) setStatus(savedStatus || (convoMode ? 'voice mode on' : 'online'));`. Chat.status (chat.js:1055) is a plain synchronous `statusEl.textContent = s`, so the browser only ever paints the last write of the block — the reason has a zero-frame lifetime. This is the 'stamped verdict with zero consumers' shape: the honest degrade telemetry is produced and immediately discarded. (In hands-free the reason survives ~150ms until the rearm writes 'voice mode — listening…' — also invisible in practice.)

**Existing test coverage:** none found — no test asserts anything about the status line after an /api/stt degrade; voice.button.test.js only asserts the INVERSE for TTS (that voice-outage text must NEVER reach #chat-status, :190).

**Adversarial verdict (survived refutation):** Confirmed. voice.js:903-907 runs `if (!text && reason) { setStatus('voice: ' + …); maybeFallbackToWebSpeech(reason); } cb.onFinal(…); cb.onEnd();` in one synchronous .then body. cb.onEnd is `() => endListening()` (voice.js:1034). endListening's guard at 1041 (`if (!listening) return;`) does NOT save it: `listening` is only cleared inside endListening itself (1042) or the onError branch (1022), so it is still true when the transcribe promise resolves — the function runs through to the unconditional restore at 1048, `if (!busyNow() && !speaking) setStatus(savedStatus || (convoMode ? 'voice mode on' : 'online'));`. savedStatus was captured at startListening:1005, before the reason existed, so it can never carry it. setStatus:91-94 delegates to Chat.status, and chat.js:1055-1057 is a plain synchronous `statusEl.textContent = s` with no queue or animation — no paint occurs between the two writes, so the reason has a zero-frame lifetime and only the console.warn at 895 survives. Hands-free variant also checks out: 1045 → handleEmptyListen:749 → maybeRearm:702 → 150ms timer → startListening:1006 overwrites with 'voice mode — listening…'. No test asserts the status line after an /api/stt degrade; voice.button.test.js:190-191 only asserts the inverse for TTS. Nothing in the comments makes the overwrite deliberate — 1046-1047 explains the restore without accounting for a degrade write. P2 is right: a lost diagnostic, not a false assertion.

_Found by the `sweep/voice` lane, 2026-07-28. Finder confidence: high. Severity claimed P2, after refutation P2._

## Verdict

_Filled in when the bug leaves the backlog: what was true, and why it is closed._
