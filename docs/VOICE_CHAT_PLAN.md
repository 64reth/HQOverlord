# Voice chat — design & roadmap

Two-way voice for the COMMS panel: **talk to your agent** (no typing) and **agents talk back**
(each with its own voice). Built to be orthogonal to the existing Chat/Harness/World modules and
to leave a clean seam for premium neural voices later.

## Why it's layered

The cool end-state — agents that *sound* like distinct characters with real neural voices — costs
API keys, money, and audio plumbing. The fastest working version costs none of that. So the design
splits cleanly:

- **Phase 1 (shipped):** browser-native Web Speech API. Zero keys, zero cost, works offline. Proves
  the UX and the wiring.
- **Phase 2 (planned):** swap the providers for neural backends. No UI or `chat.js` changes required —
  that's the whole point of the seam.

## Architecture

```
                 ┌─────────────────────────────── frontend/app/voice.js ──┐
  mic button ───▶│  sttProvider.start({onInterim,onFinal,onError,onEnd})   │
  (push-to-talk) │        │ web-speech now  →  record→Whisper later        │
                 │        ▼                                                 │
                 │   Chat.send(text)  ── identical to typing ──────────────┼──▶ Harness /api/run
                 │                                                          │
  agent reply ──▶│  Voice.speak(text, agentName)                           │
  (chat.js seam) │        │ ttsProvider.speak()                            │
                 │        │ web-speech now  →  neural per-agent voice later │
                 │        ▼                                                 │
                 │   🔊 speakers + COMMS "speaking…" + room speech bubble   │
                 └──────────────────────────────────────────────────────────┘
```

- **Input** rides `Chat.send` verbatim, so all of chat.js's busy/awaiting-purpose/task-vs-talk logic
  and per-stream cost accounting are reused untouched.
- **Output** hooks the single existing "agent talks" seam in `chat.js` (next to `World.say`), so TTS
  fires once per finished conversational reply — never per streamed token, never on tasks/errors.
- **Per-agent voice identity:** `voiceFor(id)` hashes the agent's name (FNV-1a) to deterministically
  pick an installed voice and spread pitch/rate. Same agent → same voice, every session. This is the
  hook that makes "each agent has a voice" real and survives the Phase 2 swap.

## Files

| File | Role |
|---|---|
| `frontend/app/voice.js` | the module: `sttProvider`, `ttsProvider`, mic/toggle UI wiring, `voiceFor()` |
| `frontend/index.html` | `#chat-mic` button (input row), `#voice-toggle` (COMMS header), `<script>` tag |
| `frontend/css/app.css` | `.mic-btn` (+ `.rec` pulse), `.voice-toggle` (+ `.speaking`/`.off`) |
| `frontend/app/chat.js` | exports `status`; calls `Voice.speak(reply, name)` at the talk seam |
| `frontend/app/app.js` | `Voice.init({ name })` right after `Chat.init` |

## Phase 1 — shipped (browser-native)

- **STT:** `SpeechRecognition` / `webkitSpeechRecognition`, push-to-talk. Click mic → live transcript
  previews in the input box → on a natural pause it auto-sends through `Chat.send`. Click again to stop
  early. Mic glows red + pulses while hot; disabled mid-run so you can't talk over a reply.
- **TTS:** `speechSynthesis`. Each agent gets a stable distinct voice from its name. The 🔊/🔇 header
  toggle mutes/unmutes (persisted in `localStorage`).
- **Graceful degradation:** no `SpeechRecognition` → mic hides; no `speechSynthesis` → toggle hides.
  (Chromium has both; Firefox/Safari TTS yes, STT limited.)

### Known Phase-1 limits (acceptable for the MVP)
- Web Speech recognition is Chromium-centric and quality varies; some browsers stream audio to a cloud
  recognizer. Neutral en-US only.
- Synth voices are OS-dependent and robotic — fine for "it works," not the character voices we want.
- Auto-send fires a billable run from a transcript; the input-box preview is the confirmation beat. A
  "review before send" mode is a trivial flag if we want it.

## Phase 2 — neural voices & robust STT (the cool part)

Swap the two providers inside `voice.js`; the UI and `chat.js` seam stay put.

1. **Neural per-agent TTS.** Replace `ttsProvider.speak` with a backend call (sidecar `POST /api/tts`
   → ElevenLabs / OpenAI / a local model) returning audio; play via `Audio()`. Map each agent to a
   **named voice** instead of a hashed system voice — store the voice id on the agent record so the
   crew has consistent, recognizable characters. Stream + cache by `(agentId, textHash)` to cut cost.
2. **Whisper-grade STT.** Replace `sttProvider.start` with `MediaRecorder` capture → `POST /api/stt`
   (Whisper) → transcript. Better accuracy, language detection, punctuation, fully local-capable.
3. **Speaking presence in the room.** Drive the world: hold the agent's speech bubble for the audio's
   real duration, add a "speaking" mouth/indicator, optional lip-sync to audio amplitude.
4. **Backpressure & barge-in.** Cancel TTS when the mic opens (done in Phase 1); add interrupt-on-speak
   so you can cut the agent off by talking.
5. **Config.** Per-agent voice picker in the dossier; global voice on/off + input device in Settings;
   keys via the same BYOK path as the model key (and behind the OS keychain in the desktop build).

### Backend seam (Phase 2, additive)
- New sidecar routes `POST /api/tts` and `POST /api/stt` (raw http, parallel to `/api/run`).
- New `agent.audio` telemetry rung if we want voice activity on the event bus — **additive** to
  `shared/events.js`, so it must be **requested from the cortex-memory owner**, never edited directly.
- Voice settings persist alongside channel secrets; keys never touch the agent's fs jail.
