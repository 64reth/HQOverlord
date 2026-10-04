# Voice Phase-2 Plan — Immersive Agent Voices

Synthesized from a 4-track design investigation (bug RCA, personality system, conversation UX, TTS engine). All work lives in the `voice` worktree (`agent/voice`). Every stage is one-commit-sized, additive-only (no `shared/events.js` / `shared/schema.js` edits), and must pass `npm run test:fast` before merge.

Goal: agents that feel like **your little AI worker homie living in the simulation** — laid-back, casual, themed to station life — with a **fluid hands-free voice conversation**. Voice mode stays short & spoken; **text mode stays detailed**.

---

## 1. The bug fix — SHIPPED (commit 85e6ca2)

**Symptom:** TTS spoke turn 1, then went silent on every later turn.
**Root cause (high confidence):** after the mic's `SpeechRecognition` runs (and the `synth.cancel()` push-to-talk fires), Chrome leaves `speechSynthesis` paused/idle and silently no-ops `speak()` until `resume()` is called. Turn 1 has no prior mic run, so it works; every mic-driven turn after is wedged.
**Fix (in `frontend/app/voice.js`):** `kickResume()` before+after each speak; a 4s watchdog that resumes any paused-while-pending state; cancel only when `speaking||pending` (never on an empty queue); voices-ready retry on `voiceschanged`. Idempotent, no-op in Firefox/Safari. Public surface unchanged; `chat.js` untouched.

---

## 2. Staged build plan

Dependency order: **fix → personality (text) → voice-mode split → neural engine → hands-free loop → ambient life.** Stages 1–3 independently shippable; 4 depends on 3's `onReplyEnded` seam; 5 depends on 4's `convoState`.

### Stage 1 — Personality presets + prompt architecture (text-side)
- Frozen `PRESETS` table (5) + `personas.get/list`. Inject the chosen preset's `promptInjection` into `composeSystemPrompt` **after identity, before purpose** (3-layer order: identity/manual → personality → task/voice constraints). Default `worker-homie`. Store `agent.personaId`.
- Files: new `frontend/app/personas.js`; `app.js composeSystemPrompt` (app.js:52); `index.html` script tag; connect-screen persona picker.
- **Unchanged:** the identity REAL-tools clause and the task hint — personas self-scope "chill" to conversation and defer to the work, so task fidelity is intact.

### Stage 2 — Voice-mode behavior split (short/casual spoken vs detailed text)
- Append `VOICE_MODE_RULES` (1–3 sentences, contractions, no markdown, "offer details in chat") onto `sys` **last**, only on conversational + voice-enabled turns. Ephemeral/per-turn — never baked into the persistent prompt, never on text/task turns.
- Files: `voice.js` export `Voice.isOn()`; `chat.js send()` (chat.js:152) appends the block after the task hint.

### Stage 3 — Neural TTS engine + `/api/tts` sidecar route + browser fallback
- Server-owned 3-tier ladder behind the existing `ttsProvider.speak` seam — `chat.js` does not change.
- `POST /api/tts` in `sidecar/index.js` beside `/api/run`: `{text, agentId, voice?, instructions?, provider?, format?}`; stream provider chunks to `res.write()`; cache by `sha1(provider:voice:instructionsHash:text)` in `WORKSPACES/voice/cache` (atomic tmp→rename, LRU ~200MB); headers `X-Voice-Provider` / `X-Voice-Cache`.
- **BYOK keys** follow the channel-secrets pattern (`loadChannelSecrets`/atomic `renameSync`), set via `POST /api/voice/keys` — never in the `/api/tts` body, never echoed, never in the fs jail. (OpenRouter key ≠ TTS key.)
- Browser seam: `ttsProvider.speak` POSTs `/api/tts` → `new Audio(blob)`; on `{fallback:true}` / fetch throw / `play()` reject → existing `speechSynthesis` path. `currentAudio` so mic-open/new-reply pauses it.

### Stage 4 — Fluid hands-free conversation loop (auto-listen, barge-in)
- New persisted **VOICE MODE** toggle (`🎙️`/`💬`, LS `starnet.voice.mode`). OFF = today's push-to-talk; ON = self-driving listen→send→speak→listen.
- Loop pivot: `speak()` passes a real `onReplyEnded` into `ttsProvider.speak` (today it passes `null`); on true `onend`, if `convoMode && !busy` → guarded `rearmMic()`.
- Barge-in: a light always-on listener during `speaking`; first non-empty interim → `stopSpeaking()` + capture. Silence/endpointing via `onend→onFinal` hardened with a ~1.3s `silenceTimer`. Exit: toggle / spoken "stop voice mode" / Escape / DISCONNECT. Echo mitigation: never capture while speaking; ~300ms re-arm guard; `getUserMedia` AEC; half-duplex fallback without AEC.

### Stage 5 — Ambient station-life remarks (spoken + conversation-aware)
- Make `world.js` `curiositySay` remarks **spoken** (lower/muttered) and **silent mid-conversation**. Tag curio lines `say(text,{ambient:true})`; only auto-speak ambient ones (real replies already speak via chat.js). Extend the no-stomp guard with an `inConversation` check (`World.setConversing(bool)` from voice.js). Rides world.js's existing throttles — no new timers, stays sparse.

---

## 3. Decisions for andro

**A. Primary TTS engine — recommend OpenAI `gpt-4o-mini-tts` headline + a 3-tier ladder.** It's the only option that takes a free-text `instructions`/vibe string — the exact mechanism for "laid-back, distinct-per-agent." Fast (streamable, sub-second), cheap (~1–2¢/reply, $0 cached), BYOK. Ladder: **OpenAI → Piper (bundled local neural, keyless/offline) → browser speechSynthesis (floor).** ElevenLabs = opt-in premium (cloned per-agent voices), never default (~10× cost).

**B. Personality lineup + default — recommend all 5, default `worker-homie`.** `worker-homie` (chill buddy), `deadpan-bot` (dry/sarcastic), `hype-buddy` (upbeat), `old-salt` (grizzled spacer), `gremlin` (chaotic-good goblin). Each pairs a `promptInjection` with `voiceParams` so personality + voice stay in sync. All self-scope "chill" to conversation and defer to the work.

**C. Voice mode laid-back by default — recommend yes.** The `VOICE_MODE_RULES` block governs only spoken conversational turns; text and task turns keep full structure (headers, bullets, code, citations).

**D. Barge-in on speakers without AEC — recommend half-duplex fallback** (mic reopens only after the agent finishes) when `echoCancellation` is unavailable; full barge-in on headphones.

---

## TTS engine comparison (for decision A)

| Engine | Quality | Latency | Cost | Offline | Role |
|---|---|---|---|---|---|
| Browser speechSynthesis | low–med, robotic | ~instant | $0 | yes | **floor / fallback** |
| OpenAI gpt-4o-mini-tts | high, **prose-steerable vibe** | sub-second, streamed | ~1–2¢/reply, $0 cached | no (BYOK) | **recommended primary** |
| Piper (local neural) | med–high, clearly neural | fast on CPU | $0 after model dl | **yes** | **free neural tier / 2nd fallback** |
| ElevenLabs | top tier, cloning | very good (turbo/flash) | ~10× OpenAI | no | opt-in premium |

The per-agent identity is one small JSON record `{provider, voice, instructions}`; each engine reads the fields it understands (OpenAI `instructions`, Piper `model`/`lengthScale`, browser `pitch`/`rate`). Swapping providers never touches the `voice.js` call site or `chat.js`.
