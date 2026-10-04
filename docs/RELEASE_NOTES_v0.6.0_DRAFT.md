# StarNet v0.6.0 — DRAFT release notes (paste into RELEASE_NOTES.md after `release:bump`)

Everything merged to trunk since the v0.5.3 cut (`e5e2d0dd`), verified through the standard
gates. Author-edit before publishing; keep only user-meaningful bullets.

## Highlights

- **Onboarding, rebuilt (V3).** The station now *earns* its understanding of you: intake chips
  steer instead of answering for you, a guided-discovery interview digs into your real week, and
  no recommendation fires until the station is genuinely ready. Blitzing through setup no longer
  poisons your dossier. Keyless stations wake honestly and offer the real interview once a brain
  is connected.
- **COMMS decluttered.** Run machinery folds into a single collapsible "RUN COMPLETE" line,
  station broadcasts stack into one block, and passive beats whisper instead of shouting.
  Timestamps appear on hover.
- **Import your agent from the reference harness or OpenClaw.** One click in the Recruitment Bay migrates a
  persona, instructions, memory, and model pin — API keys never transfer (re-enter in KEYS).
- **Your save is protected at boot.** If the app can't *prove* what's on disk, it shows a
  blocking "your save has NOT been deleted" screen with auto-retry — first-run setup can no
  longer render over an intact save.
- **Station voice & sound.** Licensed per-cue interface bleeps across the UI (governed by the
  TERMINAL AUDIO setting); voice mode no longer reads choice-marker syntax aloud; dictation can
  no longer wipe text you typed; Whisper-based transcription preferred over the censored
  browser recognizer.

## Improvements

- Projects rail redesigned: two-line cards with path preview and a rebuilt ADD card.
- Session titles are real model-written summaries (stranded placeholders self-heal on later turns).
- A pending clarifying question now owns the COMMS moment — no second popup can stack over it
  and wipe your answer chips.
- Every user-visible timestamp is the exact moment the thing happened (built-time rides
  deliverables end-to-end; the rail no longer says "now" for old work).
- Text size adapts to your screen (AUTO) with a manual dial.
- Returning users get earned starter chips only — no canned suggestion pads.
- KEYS tab: paste an API key for any service; agents' shell runs inherit it as an env var.
  Provider-key names are refused (they'd silently become billing credentials).
- Connector catalog honesty: platforms reachable only through an aggregator show a live
  "VIA ZAPIER" jump instead of a dead SOON button; GitHub connects with a personal access
  token (its OAuth cannot complete against our sign-in flow — verified live).
- Concurrent sessions can drive the same agent; the agent leaves its desk only when the last
  run ends.
- Night Shift: fail-closed prechecks, AVOID list + steer for directing autonomous work,
  honest mode/readiness readouts.
- Multiple UI polish passes: spacing sweep, CSS gap fixes, fullscreen layout fix, night-floor
  visibility, 12 new agent skins, quieter default logging.

## Fixes

- "Built while away" cards no longer show as stubs after a cold boot.
- Deliverables open in the format that fits the work.
- Duplicate popups, session-rail timestamp lies, workshop session resolution, and the
  voice/STT asterisk censoring are all fixed (see qa/STATUS.md digests for receipts).
