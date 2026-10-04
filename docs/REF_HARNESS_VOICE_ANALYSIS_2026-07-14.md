# the reference harness voice system vs StarNet — code-level analysis (2026-07-14)

Sources: full read of `C:\Users\<you>\harness-ref` (the reference harness main @ 8e734810d, 2026-07-08)
voice subsystem (`tools/tts_tool.py`, `tools/transcription_tools.py`, `tools/voice_mode.py`,
`cli.py` voice UX, `gateway/run.py`, `plugins/platforms/discord/*`), and a same-day audit of
StarNet's voice stack on this branch (`frontend/app/voice.js`, `frontend/app/chat.js`,
`sidecar/index.js` /api/tts + /api/stt).

## Headline: do NOT copy their pipeline — ours is architecturally ahead

the reference harness is a **classic turn-based STT → LLM → TTS pipeline everywhere**. The full LLM reply
completes, markdown is stripped, ONE audio file is synthesized, then played. The single
exception is CLI + ElevenLabs, which streams sentence-by-sentence into a persistent
sounddevice OutputStream (`tts_tool.py:2595 stream_tts_to_speaker`, boundary regex
`(?<=[.!?])\s`, min sentence 20 chars, idle flush at 100 chars).

StarNet already streams TTS **while the LLM is still generating** (`chat.js onToken →
pushSpeech`), peels a tiny first clause (~3-4 words) for fast first audio, synthesizes two
chunks ahead, plays in order, prewarms ambient lines into a disk cache, and has a real
barge-in teardown (`speakSeq` invalidation + fetch aborts). the reference harness has none of that outside
the one CLI path. They also have: no wake word, no webrtcvad (hand-rolled RMS energy VAD,
same class as ours), no realtime/duplex mode in production (Meet v2 duplex is an explicit
stub; `api_server.py` hardcodes `"realtime_voice": false`).

**So "the reference harness sounds decent, ours is terrible" is not the pipeline. It's four feel factors
plus two self-inflicted degrade traps on our side.**

## The defining principle: voice is a STATION subsystem, never a model property

Andrew's observation (2026-07-14): the reference harness works fluidly with any model. Correct — and the
reason is structural: the reference harness's voice stack is **fully decoupled from the LLM**. TTS provider
is config (default = free keyless Edge), STT provider is config (default = local Whisper);
the agent brain can be anything. StarNet v3 did the opposite on purpose: the `/api/tts`
chain prefers the RUN provider's native voice API (`preferProvider`), and `/api/stt` rides
OpenRouter/Gemini chat models. Consequence: an Anthropic-only or Codex station has **no
audio API at all** → robotic browser voice + no desktop STT. Voice quality varies with
which brain you picked. That coupling is the root defect, not any single provider branch.

**The replication bar (Andrew: "we get it right or we remove voice mode entirely"):**
1. Voice works IDENTICALLY on every station regardless of roster model or credential mix —
   including an Anthropic-only station and a zero-key fresh install.
2. The robotic speechSynthesis voice becomes unreachable. Once a free neural floor exists,
   "get it right or remove it" applies to the robotic fallback: if every neural tier fails
   (total network loss), degrade to TEXT + honest speaker-tooltip reason — silence over
   cringe. Delete the speechSynthesis speak path (keep the synth object only for feature
   detection).
3. ONE station voice identity survives every tier. Bit-identical timbre across providers is
   impossible (OpenAI branch already approximates Algenib with onyx); identity is carried by
   (a) nearest-voice mapping per tier and (b) the machine-shell DSP, which is client-side
   and applies to ALL tiers including Edge. Same character, occasionally a different actor —
   never a different species.
4. Acceptance matrix, live-proven per starnet-verify (not existence-audited): stations with
   {gemini key, openai key, openrouter key, anthropic-only, zero-key} × {speak reply,
   hands-free round-trip} — 10 cells, all neural, all transcribing.

**Feasibility (verified on npm 2026-07-14):** Edge floor = `msedge-tts` 2.0.7 (maintained,
2026-07-09; free MS Read-Aloud endpoint, no key/no Edge install). Local STT floor =
`sherpa-onnx-node` 1.13.4 (2026-07-07, offline ASR, prebuilt per-platform) or
`nodejs-whisper` (whisper.cpp). Local model ≈75–150MB — download on first voice-mode use
with a progress line, never bundled in the installer.

## What the reference harness actually does better (the copy list, ranked)

### 1. Real ASR endpoints for STT — our single biggest latency+accuracy gap
the reference harness transcribes with dedicated speech models: local **faster-whisper** `base` (default,
free, private, CUDA→CPU int8 fallback), **Groq whisper-large-v3-turbo**, OpenAI `whisper-1`,
Mistral Voxtral, ElevenLabs scribe_v2, xAI `/v1/stt` (`transcription_tools.py`, auto-detect
order local > groq > openai > …).

StarNet's `/api/stt` sends the clip as an `input_audio` part to a **generic chat model over
OpenRouter** (default `google/gemini-3.1-flash-lite-preview`) with a "transcribe verbatim"
prompt and a 120s timeout (`sidecar/index.js:8843`). Full upload + a whole chat completion
must finish before the send even begins — that dead air after you stop talking is the worst
part of our hands-free loop, and chat-model transcription is also less accurate than Whisper.

**Replicate:** teach `handleStt` dedicated ASR branches keyed off available creds —
Groq `whisper-large-v3-turbo` (very fast/cheap) and OpenAI `whisper-1` first, current
chat-model path demoted to fallback. Same shape as the TTS provider chain we already have.
(Local whisper is Python-ecosystem in the reference harness; a Node port (whisper.cpp binding) is a separate
decision — provider ASR gets 90% of the win with zero deps.)

### 2. A free NEURAL fallback tier before the robotic voice
the reference harness's **default** TTS is **Edge TTS** (`en-US-AriaNeural`) — Microsoft's free endpoint, no
key, genuinely decent neural voice. Their degrade ladder therefore never sounds robotic:
edge → local neural (NeuTTS/Kitten/Piper ONNX) → error.

StarNet's degrade ladder is neural-with-key → **browser speechSynthesis** (the hated robotic
voice). Every no-key install, billing blip (60s cold-off), or transient error (4s cold-off)
drops straight to robotic. This is almost certainly the core of "our voice system is
terrible" — see also the 2026-07-07 billing escape in memory.

**Replicate:** add an `edge` branch to `/api/tts` between the keyed providers and
`{fallback:true}` (Node equivalents of the edge-tts protocol exist, e.g. the msedge-tts
package — needs a verification spike; it speaks a free MS websocket endpoint). Machine-shell
DSP applies client-side regardless of source, so even the fallback keeps the Ultron shell.
Keep the 200-always contract; cache under its own namespace.

### 3. Dead-air fill: thinking bed + spoken acknowledgements + ducking
the reference harness Discord voice (`plugins/platforms/discord/voice_mixer.py`, `adapter.py:2707
voice_fx`): a continuous synthesized ambient bed (detuned sines + tremolo + filtered noise)
plays while the agent works, **ducks** 0.18→0.06 under speech with a 400ms release, and the
agent speaks a short verbal ack ("Let me look into that.", "One moment.") on its **first
tool call** (`gateway/run.py:17005 play_ack_in_voice`). That overlap is the "Grok voice
mode" feel — the thing that reads as "decent".

StarNet already has the perfect substrate: prewarmed `ambientLines` in the voice cache and a
WebAudio graph. During a long tool-using turn our station is just silent.

**Replicate (respecting locked laws):** spoken ack lines on first tool-call (cache-hit
instant, they're prewarmed) + duck SFX under speech (we already duck). The ambient bed must
be pitched as an eerie station-processing HUM (SFX, Director-triggered), NOT music — the
score was deliberately deleted (memory: music-removed-sfx-redesign); do not re-add anything
melodic. This needs Andrew's taste call on the bed itself; the acks don't.

### 4. STT hygiene: hallucination filter + quiet-take discard + speech-confirm VAD
- Whisper-style **hallucination filter** (`voice_mode.py:824`): 26+ phantom phrases
  ("Thanks for watching", "продолжение следует"…) + repeat-regex → treated as empty.
  Chat-model STT hallucinates too; we forward whatever comes back straight into Chat.send.
- **Peak-RMS gate** discards too-quiet takes instead of uploading them.
- **Two-stage VAD confirm**: speech only counts after ≥0.3s above threshold with ≤0.3s dip
  tolerance; prevents a cough/bump from triggering a send. Ours: any single frame above
  floor+0.010 counts as voiced.

**Replicate:** all three are small, self-contained changes in `voice.js` (`watchLevel`,
`transcribe`) + a phantom-phrase list check in `submitTranscript` or `handleStt`.

### 5. Smaller polish worth stealing
- **Sentence de-dupe** in the TTS stream (LLM repetition guard) — trivial in `pushSpeech`.
- **`<think>` block stripping** across chunk boundaries (matters if reasoning models ever
  stream visible think tags into replies).
- **Emotion/prosody tag rewrite via aux LLM** (xAI `[pause]/[sigh]` tags, Gemini audio-tag
  rewrite `tts_tool.py:1593`) — we already carry a 500-char style prompt; an aux-model
  rewrite pass is the next rung if Andrew wants more life in delivery. Fits the existing
  aux-cheap-model-slots plan (hermes-update-2026-07-eval DO-NOW item).
- **Command-provider escape hatch**: any shell CLI becomes a TTS/STT provider via config
  (`type: command`, `{input_path}/{output_path}` placeholders). Cheap flexibility for power
  users; low priority for our beginner moat.

## Our self-inflicted wounds (fix regardless of the reference harness)

- **`ttsDisabled` latches for the whole session on ONE "no key" response**
  (`voice.js:584`) — a single spurious 401/no-key at startup means robotic until reload.
  Should re-probe on a timer or on the next speaker toggle.
- **Degrade reason lives only in the speaker tooltip** — correct per the locked COMMS-bar
  law, but pair it with fix #2 above so degrade becomes inaudible instead of merely explained.
- **Double chunking heuristics** (chat.js `pushSpeech` + voice.js `firstClauseSplit`) can
  emit 3-4-word fragments with odd prosody; worth consolidating to one splitter with
  ref-style min-sentence-length (20 chars) + forward-merge of short fragments.

## Explicitly NOT copying
28 TTS/STT providers, 20 channel adapters, Discord RTP/DAVE decrypt stack, Google Meet bot,
Python-local models as a hard dependency. Off-moat breadth; we want the feel, not the fleet.

## Suggested lane order (each independently shippable, test-gated)
1. **V-STT** — dedicated ASR chain in `/api/stt`: Groq/OpenAI Whisper when those keys
   exist → current chat-model path (OpenRouter/Gemini creds) → **local sherpa-onnx/whisper
   floor** (on-demand model download) so zero-key/Anthropic-only stations still transcribe.
   Backend-only. Biggest perceived-latency win + closes the STT half of the decoupling bar.
2. **V-EDGE** — free neural floor in `/api/tts` via msedge-tts, nearest-Algenib Edge voice
   + client-side shell DSP; un-latch `ttsDisabled`; **delete the robotic speechSynthesis
   speak path** (text + tooltip is the terminal degrade). Closes the TTS half of the bar.
3. **V-ACK** — spoken ack on first tool call from prewarmed cache + ducking. Frontend.
4. **V-HYGIENE** — VAD confirm stage, quiet-take discard, hallucination filter, sentence
   de-dupe, single chunker.
5. **V-PROSODY (taste-gated)** — aux-LLM emotion-tag rewrite; ambient processing hum
   (needs Andrew's explicit yes — adjacent to the deleted-music law).
