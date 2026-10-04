---
fingerprint: ff73b79a
slug: a-stale-sidecar-token-lets-local-live-open-a-sil
title: A stale sidecar token lets Local Live open a silent microphone session after restart
surface: voice
severity: P1
status: fixed
found: 2026-07-31
lane: agent/voice-release-sweep
fix: 8bc9ff9a
---

# A stale sidecar token lets Local Live open a silent microphone session after restart

## Symptom

After the sidecar restarts, an already-open browser tab still shows the old station token. The Local Live
button remains usable and can open the microphone, but every voice API call is rejected, leaving a
live-looking session that cannot hear or speak.

## Repro

1. Open a seeded station and leave the page loaded.
2. Restart the sidecar without reloading that page.
3. Press Local Live in the stale tab.
4. Before the fix, the availability probe's plain-text 403 failed JSON parsing, returned `null`, and
   `start()` continued into `openMicrophone()`.

## Evidence

Live browser proof on 2026-07-31 showed the stale tab at `station unreachable` while the Live Voice
button remained enabled. Source inspection showed `probeAvailability()` swallowed the 403 JSON error
and `start()` only refused `available:false`. `test/voice-live-ui.test.js` now exercises 403 and 500
classification and proves the refusal precedes `openMicrophone(seq)`.

## Verdict

Fixed by treating failed availability probes as explicit results. A stale 403 now refuses before
microphone access and tells the user to reload; other probe failures show a retryable station error.
