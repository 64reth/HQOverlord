---
fingerprint: d02d029b
slug: failed-live-voice-startup-leaves-a-user-mute-for
title: Failed Live Voice startup leaves a user mute force-enabled
surface: voice
severity: P2
status: fixed
found: 2026-07-31
lane: agent/voice-release-sweep
fix: 8bc9ff9a
---

# Failed Live Voice startup leaves a user mute force-enabled

## Symptom

Starting Local Live force-enables speech so a hands-free session cannot open silently. If microphone
startup then fails, the session closes but the speaker remains enabled even when the user had muted it
before starting.

## Repro

1. Mute the speaker.
2. Start Local Live and deny microphone permission (or make microphone startup throw).
3. Before the fix, `start()` called `Voice.forceSpeakOn()` and its catch block detached the coordinator
   but never called `Voice.restoreSpeak()`.

## Evidence

The failure path in `frontend/app/voice-live.js` had no preference restoration while the normal
`finish()` path did. `test/voice-live-ui.test.js` now pins `Voice.restoreSpeak()` inside the startup
failure teardown, in addition to the existing normal-finish assertion.

## Verdict

Fixed by restoring the speaker preference in the startup catch path. `restoreSpeak()` only reverses
the automatic force-on state, so a speaker choice changed manually during startup remains respected.
