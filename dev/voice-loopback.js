/* dev/voice-loopback.js — prove the OFFLINE voice engine end to end without a microphone.
 *
 *   node dev/voice-loopback.js [--bundle-root <dir>] [--wav <output.wav>]
 *
 * Kokoro synthesizes a known phrase, we decode that WAV, and Whisper transcribes it back. If the text
 * survives the round trip, both halves of the local engine are genuinely working — which is the one claim
 * that cannot be made from unit tests, because they never load a model.
 *
 * Run it from a SIMULATED BUNDLE (a dir holding sidecar/ beside node_modules/) to prove the packaged
 * layout resolves, which is how the resource wiring in tauri.conf.json was verified.
 *
 * GOTCHA: Kokoro emits 32-bit FLOAT wav at 24 kHz, not 16-bit PCM. Decoding it as int16 yields noise, and
 * Whisper answers noise with the word "You" — which reads exactly like a broken engine. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const bundleRoot = path.resolve(arg('--bundle-root', path.join(__dirname, '..')));
const wavOutput = path.resolve(arg('--wav', path.join(os.tmpdir(), 'starnet-voice-loopback.wav')));
const lv = require(path.join(bundleRoot, 'sidecar', 'local-voice.js'));

function decodeWav(wav) {
  const dv = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  let pos = 12, fmt = null, dataOff = 0, dataLen = 0;
  while (pos < wav.length - 8) {
    const id = String.fromCharCode(wav[pos], wav[pos + 1], wav[pos + 2], wav[pos + 3]);
    const sz = dv.getUint32(pos + 4, true);
    if (id === 'fmt ') fmt = { fmtTag: dv.getUint16(pos + 8, true), ch: dv.getUint16(pos + 10, true), rate: dv.getUint32(pos + 12, true), bits: dv.getUint16(pos + 22, true) };
    if (id === 'data') { dataOff = pos + 8; dataLen = sz; break; }
    pos += 8 + sz + (sz % 2);
  }
  const bytesPer = fmt.bits / 8;
  const n = Math.floor(dataLen / bytesPer / fmt.ch);
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const off = dataOff + i * bytesPer * fmt.ch;
    mono[i] = fmt.bits === 32 ? dv.getFloat32(off, true) : dv.getInt16(off, true) / 32768;
  }
  return { fmt, mono };
}

function resampleTo16k(mono, rate) {
  if (rate === 16000) return mono;
  const ratio = rate / 16000;
  const out = new Float32Array(Math.floor(mono.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const s = Math.floor(i * ratio), e = Math.min(mono.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = s; j < e; j++) sum += mono[j];
    out[i] = sum / Math.max(1, e - s);
  }
  return out;
}

const norm = s => String(s || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
const sameWords = (a, b) => {
  const left = norm(a), right = norm(b);
  // ASR may split or join a compound ("taskboard" ↔ "task board"). That is the same letter
  // sequence and command meaning; do not forgive substitutions, omissions, or extra words.
  return left === right || left.replace(/ /g, '') === right.replace(/ /g, '');
};

(async () => {
  const t0 = Date.now();
  await lv.warm();
  console.log('warm ok in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's | asr=' + lv.status().asr + ' tts=' + lv.status().tts);

  const PHRASES = [
    'open the taskboard and start the build',
    'stop the night shift',
    'what did you finish while I was away'
  ];

  let pass = 0;
  for (const phrase of PHRASES) {
    const wav = await lv.synthesize(phrase, { voice: 'af_heart', speed: 1 });
    const decoded = decodeWav(wav);
    const pcm = resampleTo16k(decoded.mono, decoded.fmt.rate);
    let peak = 0;
    for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
    const heard = await lv.transcribe(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
    const ok = sameWords(heard, phrase);
    if (ok) pass++;
    console.log('\n  said : "' + phrase + '"');
    console.log('  heard: "' + heard + '"');
    console.log('  wav  : ' + wav.length + 'B ' + decoded.fmt.rate + 'Hz ' + decoded.fmt.bits + 'bit | peak ' + peak.toFixed(3) +
      ' | ' + (pcm.length / 16000).toFixed(2) + 's | tts ' + lv.status().lastTtsMs + 'ms asr ' + lv.status().lastAsrMs + 'ms');
    console.log('  ' + (ok ? 'MATCH' : 'MISMATCH'));
  }
  fs.mkdirSync(path.dirname(wavOutput), { recursive: true });
  fs.writeFileSync(wavOutput, await lv.synthesize(PHRASES[0], { voice: 'af_heart', speed: 1 }));
  console.log('proof wav: ' + wavOutput);
  console.log('\nRESULT: ' + pass + '/' + PHRASES.length + ' round-trips matched');
  process.exit(pass === PHRASES.length ? 0 : 2);
})().catch(e => { console.error('FAILED:', (e && e.message) || e); process.exit(1); });
