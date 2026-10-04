'use strict';

const { randomUUID } = require('node:crypto');
const RATE = 16000, WINDOW = RATE * 8, MAX_BUFFER = RATE * 16;
const normalized = word => String(word || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

// Incremental Whisper adapter: audio arrives once; two successive hypotheses confirm words.
// Word timestamps let us retire confirmed audio instead of re-decoding a growing full recording.
// No transcript or audio is persisted. This is local incremental ASR, not a native streaming model.
function createVoiceStream({ transcribe, now = () => 0 }) {
  const ac = new AbortController(), started = now();
  let pcm = Buffer.alloc(0), offset = 0, received = 0, decodedAt = 0;
  let committed = [], previous = [], provisional = [], through = 0, confirmed = 0;
  let busy = null, closed = false, finishing = false, failure = '', completeSnapshot = false;
  let firstPartialMs = null, recognitionMs = null, decodeCount = 0, maxWindowMs = 0;
  const wordsText = words => words.map(w => w.text).join('').trim();
  const snapshot = () => ({
    stable: wordsText(committed.concat(provisional.slice(0, confirmed))), partial: wordsText(provisional.slice(confirmed)),
    text: wordsText(committed.concat(provisional)), error: failure || undefined,
    metrics: { firstPartialMs, recognitionMs, decodeCount, receivedMs: received / RATE * 1000, maxWindowMs }
  });
  async function decode(final = false) {
    const samples = Math.min(pcm.length / 4, WINDOW);
    if (!samples) return;
    const input = Buffer.from(pcm.subarray(0, samples * 4));
    const base = offset / RATE, at = now();
    decodedAt = received;
    completeSnapshot = samples === pcm.length / 4 && samples < WINDOW;
    const result = await transcribe(input, { signal: ac.signal, words: true });
    if (closed) return;
    recognitionMs = Math.round(now() - at); decodeCount++;
    maxWindowMs = Math.max(maxWindowMs, samples / RATE * 1000);
    const chunks = result && result.chunks || [];
    let words = chunks.filter(w => w && Array.isArray(w.timestamp) &&
      Number.isFinite(w.timestamp[0]) && Number.isFinite(w.timestamp[1]) && w.timestamp[1] >= w.timestamp[0])
      .map(w => ({ text: String(w.text), start: base + w.timestamp[0], end: base + w.timestamp[1] }));
    if (result && result.text && !words.length) throw new Error('Word timing is unavailable for continuous recognition.');
    // Only trim overlap at a retired window boundary. Repeatedly cropping after each partial
    // cuts phonemes and makes Whisper duplicate or omit words when its timestamps move.
    if (through > base) {
      let overlap = 0;
      for (let n = 1; n <= Math.min(12, committed.length, words.length); n++) {
        const last = words[n - 1];
        if (last.start < through &&
            committed.slice(-n).every((w, i) => normalized(w.text) === normalized(words[i].text))) overlap = n;
      }
      if (overlap) words = words.slice(overlap);
      else words = words.filter(w => (w.start + w.end) / 2 >= through);
    }
    let count = 0;
    while (count < Math.min(previous.length, words.length - 1) &&
      normalized(previous[count].text) === normalized(words[count].text)) count++;
    previous = words;
    provisional = words;
    confirmed = count;
    if (firstPartialMs === null && words.length) firstPartialMs = Math.round(now() - started);
    if (samples === WINDOW) {
      // Keep the last second of context; commit at a word boundary in the preceding second.
      let n = 0;
      while (n < words.length && words[n].end <= base + 7) n++;
      if (!n) {
        if (words.length) throw new Error('Cannot find a safe speech window boundary.');
        pcm = pcm.subarray(RATE * 7 * 4); offset += RATE * 7;
        previous = []; provisional = []; confirmed = 0; return;
      }
      committed.push(...words.slice(0, n));
      through = committed[committed.length - 1].end;
      const drop = Math.max(1, Math.floor((through - base - .35) * RATE));
      pcm = pcm.subarray(drop * 4); offset += drop;
      provisional = words.slice(n); previous = []; confirmed = 0;
    } else if (final) {
      committed.push(...words); provisional = []; previous = []; confirmed = 0;
      pcm = pcm.subarray(samples * 4); offset += samples;
    }
    if (committed.length > 2000) throw new Error('This voice turn is too long. Please send it before continuing.');
  }
  function kick() {
    if (closed || finishing || busy || failure || received - decodedAt < RATE * .4) return;
    busy = decode().catch(e => { if (!closed) failure = String(e.message || e); }).finally(() => {
      busy = null; if (!closed && !finishing && !failure && received - decodedAt >= RATE * .4) kick();
    });
  }
  return {
    snapshot,
    push(bytes) {
      if (closed || finishing) throw new Error('Voice stream is closed.');
      if (!Buffer.isBuffer(bytes) || bytes.length % 4 || bytes.length > RATE * 4) throw new Error('Invalid audio chunk.');
      if (pcm.length + bytes.length > MAX_BUFFER * 4) throw new Error('Speech recognition cannot keep up. Please pause and try again.');
      for (let i = 0; i < bytes.length; i += 4) if (!Number.isFinite(bytes.readFloatLE(i))) throw new Error('Invalid audio samples.');
      pcm = Buffer.concat([pcm, bytes]); received += bytes.length / 4; kick(); return snapshot();
    },
    async finish() {
      finishing = true; if (busy) await busy;
      if (failure) throw new Error(failure);
      if (completeSnapshot && decodedAt === received && !closed) {
        committed.push(...provisional); provisional = []; confirmed = 0; pcm = Buffer.alloc(0);
      }
      while (pcm.length && !closed) {
        const before = offset;
        await decode(true);
        if (offset === before) throw new Error('Recognition could not finish this audio window.');
      }
      if (closed) throw new Error('Voice stream was cancelled.');
      provisional = []; closed = true; return snapshot();
    },
    cancel() { closed = true; ac.abort(); pcm = Buffer.alloc(0); committed = previous = provisional = []; }
  };
}

function makeVoiceStreams({ localVoice, now = () => 0, monotonicNow = now, uuid = randomUUID }) {
  const sessions = new Map();
  function sweep() {
    for (const [id, row] of sessions) if (now() - row.used > 30000) { row.stream.cancel(); sessions.delete(id); }
  }
  const timer = setInterval(sweep, 5000); timer.unref();
  return {
    open() {
      sweep();
      if (!localVoice.status().available) throw new Error('Local speech models are unavailable.');
      if (sessions.size >= 4) throw new Error('Too many active voice streams. Close another voice session first.');
      const id = uuid(), stream = createVoiceStream({ now: monotonicNow, transcribe: (pcm, opts) => localVoice.transcribe(pcm, opts) });
      sessions.set(id, { stream, used: now() });
      return { id, engine: 'local-incremental', ...stream.snapshot() };
    },
    async action(id, action, bytes) {
      sweep(); const row = sessions.get(id);
      if (!row) throw new Error('Voice stream expired. Start a new turn.');
      row.used = now();
      if (action === 'audio') return row.stream.push(bytes);
      if (action === 'finish') {
        try { return await row.stream.finish(); } finally { row.stream.cancel(); sessions.delete(id); }
      }
      if (action === 'cancel') { row.stream.cancel(); sessions.delete(id); return {}; }
      throw new Error('Unknown voice stream action.');
    },
    close() { clearInterval(timer); for (const row of sessions.values()) row.stream.cancel(); sessions.clear(); }
  };
}
module.exports = { createVoiceStream, makeVoiceStreams };
