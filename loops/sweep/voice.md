# SWEEP · voice — TTS, the speech queue, voice chat

Read `loops/sweep/README.md` first; it carries the protocol. Surface key: `voice`.
**Rank 8 of 10** — small surface, but it fails in a way users read as total product failure.

## What you own

`frontend/app/voice.js` (and its generated `website/app/` mirror) · `sidecar/edgetts.js` ·
`/api/tts` · `ttsSynthKeyed` + `agentSpeechSynth` in `sidecar/index.js` · the speech queue in
`chat.js`

## The governing law

**A backoff must never guillotine work already in flight.** One transient 429 on sentence 2
once silenced sentences 3..N of the same reply, because a failed chunk armed a 4s cold-off that
every later chunk short-circuited on without even attempting. The symptom of getting this wrong
is always *"it starts, then stops dead"*, and it reads as a dead feature rather than a one-chunk
blip. **A success must also LIFT the cold-off** — clearing failure counters is not enough.

Both halves are fixed. Your job is to find the same shape elsewhere: grep for every backoff,
cold-off, circuit breaker and cooldown in the frontend and sidecar, and ask of each one
*"does this gate NEW work, or does it also kill a stream that already started producing?"*

## The failure states to walk

1. **A blip must outlive the retry.** There is now a one-shot retry for transient classes, so a
   test that fails exactly ONE request is rescued and proves nothing. Fail request N *and* N+1
   or you are not exercising the gate at all.
2. **Transient vs terminal.** 429 / network / 5xx retry; `no key` and billing must NEVER retry.
   Prove the classifier on each.
3. **Concurrency against one provider.** Turn the speaker on (which prewarms ~6 stock lines) and
   immediately drive a live reply. Prewarm must yield while draining, not race the reply.
4. **The whole ladder.** Keyed neural chain → free keyless Edge floor. Break each rung in turn
   and prove a zero-key station still speaks, and that a total failure NAMES every leg it tried
   and writes nothing.
5. **Over-cap scripts are REFUSED, never truncated.** Verify, then check whether any sibling
   surface truncates instead.
6. **Interruption.** Interrupt a reply mid-speech, switch agents mid-speech, close the panel,
   reload the page. Does the queue drain, or does audio survive the transition?
7. **The choice-marker ear-check** is a known-open item — listen to it, do not read it.

## The rig worth reusing

Boot a seeded dev station; patch `HTMLMediaElement.prototype.play` and `window.fetch` to log;
force a failure on the Nth `/api/tts`; drive five `Voice.speakChunk()` then `endReply()`; count
`play()` calls. Before/after counts are the evidence.

## Note before you commit

`frontend/app/voice.js` is one of the 184 locked release-surface files. Any byte you move there
owes a **claims re-lock in your own lane**, as its own commit.
