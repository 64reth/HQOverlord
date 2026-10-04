'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  makeMediaService, pcmToWav, float32PcmToWav, wavToMono16kFloat32, oggOpusToMono16kFloat32, sttMultipartBody
} = require('../sidecar/media-service.js');

// 80 ms mono Opus tone in a real Ogg container. Generated once with libopus; checked in as text so the
// test proves the shipped WASM decoder without requiring ffmpeg on a developer or release machine.
const OGG_OPUS = Buffer.from(
  'T2dnUwACAAAAAAAAAAC36uPZAAAAACvBgEwBE09wdXNIZWFkAQE4AYC7AAAAAABPZ2dTAAAAAAAAAAAAALfq49kBAAAAq9xArgE+T3B1c1RhZ3MNAAAATGF2ZjYyLjEyLjEwMQEAAAAdAAAAZW5jb2Rlcj1MYXZjNjIuMjguMTAxIGxpYm9wdXNPZ2dTAAQ4EAAAAAAAALfq49kCAAAABkcHRAVFOzI3H3iCAbdsRyTqAkZv+rYDjIE01uheAesbsV7vyXgY8gqzIUHM0aaf4Yqbhp1rgeoEnutAiitHUCgJ0EZTAHRNtp96w/QA+XijP/esmIUDXCYKV5+K8o09bIVMwBPqQbZh53f7dxTMWHWvNRLH9wshBXhb4UZ4svXifY+1ePppKdPLeJujElFFAKzjUZtzIbzvkYf9xoYkZjRJyLfYYOyuGQ16hsiSDl+FlUmChd1GPvaUKYt4m6MRtBy/UiiBezmWuWR9rnAX1N7fcFaVORBbFQ/O0UoSEsPPQg+XUCym9WlXzffTW861RJUCeAZq5oQF8SsdLTmsuzQSGw7LXdkN4omo7g5at9f8/g==',
  'base64'
);

const roots = [];

async function make(overrides) {
  const workspaces = await fsp.mkdtemp(path.join(os.tmpdir(), 'starnet-media-'));
  roots.push(workspaces);
  const opts = Object.assign({
    workspaces,
    fs,
    fsp,
    fetch: async () => { throw new Error('unexpected network'); },
    edgetts: { enabled: () => false, resolveVoice: () => 'en-US-ChristopherNeural', synth: async () => Buffer.alloc(0) },
    localVoice: {
      status: () => ({ available: false }),
      defaultVoice: () => 'af_heart',
      edgeVoiceFor: () => 'en-US-ChristopherNeural',
      synthesize: async () => { throw new Error('local unavailable'); },
      transcribe: async () => ''
    },
    nativeStt: { status: () => ({ available: false }), recognize: async () => ({ ok: false, text: '' }) },
    readBody: async () => '{}',
    readBodyBuffer: async () => Buffer.alloc(0),
    providerRuntimeKey: () => '',
    providerRuntimeBaseUrl: () => '',
    normalizeProviderId: value => String(value || '').toLowerCase(),
    getRuntimeKey: () => '',
    env: () => '',
    processEnv: {},
    redact: String,
    logger: { error() {}, warn() {} },
    now: () => 1234,
    randomUUID: () => 'uuid',
    randomBytes: n => Buffer.alloc(n, 0xab)
  }, overrides || {});
  return makeMediaService(opts);
}

async function invokeTts(overrides, body) {
  const service = await make(Object.assign({}, overrides || {}, {
    readBody: async () => JSON.stringify(body || {})
  }));
  const response = { status: 0, headers: {}, body: Buffer.alloc(0) };
  await service.handleTts({}, {
    headersSent: false,
    writeHead(status, headers) { response.status = status; response.headers = headers || {}; this.headersSent = true; },
    end(value) { response.body = Buffer.isBuffer(value) ? value : Buffer.from(String(value || '')); }
  });
  return response;
}

(async () => {
  // PCM wrapping and the local-ASR decoder remain exact inverses at their shared boundary.
  const pcm = Buffer.alloc(4 * 2 * 2);
  for (let frame = 0; frame < 4; frame++) {
    const sample = frame < 2 ? 32767 : -32768;
    pcm.writeInt16LE(sample, frame * 4);
    pcm.writeInt16LE(sample, frame * 4 + 2);
  }
  const wav = pcmToWav(pcm, 32000, 2);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt32LE(24), 32000);
  assert.equal(wav.readUInt16LE(22), 2);
  const decoded = wavToMono16kFloat32(wav);
  assert.equal(decoded.length, 2, '32 kHz stereo is downsampled to 16 kHz mono');
  assert.ok(decoded[0] > 0.99);
  assert.equal(decoded[1], -1);
  assert.equal(wavToMono16kFloat32(Buffer.from('not wav')), null);

  const captured = new Float32Array([1, -1, 0.5, -0.5]);
  const nativeWav = float32PcmToWav(Buffer.from(captured.buffer), 16000);
  const nativeDecoded = wavToMono16kFloat32(nativeWav);
  assert.equal(nativeDecoded.length, captured.length, 'a click-bounded Float32 take becomes a complete mono WAV');
  assert.ok(nativeDecoded[0] > 0.99 && nativeDecoded[1] === -1, 'native WAV conversion preserves sample polarity and bounds');
  assert.equal(float32PcmToWav(Buffer.from([1, 2, 3]), 16000), null, 'a partial Float32 sample is rejected');

  const decodedOgg = await oggOpusToMono16kFloat32(OGG_OPUS);
  assert.ok(decodedOgg.length >= 1200 && decodedOgg.length <= 1500, 'real Ogg/Opus is decoded and resampled to 16 kHz');
  assert.ok(decodedOgg.some(sample => Math.abs(sample) > 0.01), 'decoded Ogg/Opus contains audible PCM');

  // Multipart construction preserves the audio byte-for-byte and names the Whisper model/file parts.
  const audio = Buffer.from([0, 1, 2, 255, 13, 10]);
  const multipart = sttMultipartBody(audio, 'clip.webm', 'audio/webm', { model: 'whisper-test' }, n => Buffer.alloc(n, 7));
  assert.match(multipart.contentType, /^multipart\/form-data; boundary=----StarNetSTT/);
  assert.ok(multipart.body.includes(Buffer.from('name="model"')));
  assert.ok(multipart.body.includes(Buffer.from('whisper-test')));
  assert.ok(multipart.body.includes(Buffer.from('name="file"; filename="clip.webm"')));
  assert.ok(multipart.body.includes(audio), 'multipart body carries the original audio bytes');

  // No credentials and no local engine is an honest terminal capability result.
  const keyless = await make();
  assert.deepEqual(await keyless.transcribeAudioBuffer(Buffer.from('audio'), 'webm'), { ok: false, reason: 'no key' });
  assert.deepEqual(keyless.sttStatus(), {
    available: false, preferred: 'none', cloud: false, local: false, native: false
  });
  assert.match((await keyless.synthesizeForAgent({ text: 'hello' })).reason, /edge: disabled/);

  const nativeOnly = await make({ nativeStt: { status: () => ({ available: true }), recognize: async () => ({ ok: true, text: 'native' }) } });
  assert.deepEqual(nativeOnly.sttStatus(), {
    available: true, preferred: 'native', cloud: false, local: false, native: true
  });

  let nativeParams = null;
  const capturedPcm = Buffer.from(new Float32Array([0.2, -0.2]).buffer);
  const capturedNative = await make({
    readBodyBuffer: async () => capturedPcm,
    nativeStt: {
      status: () => ({ available: true }),
      recognize: async params => { nativeParams = params; return { ok: true, text: 'two clicks' }; }
    }
  });
  const nativeResponse = { status: 0, body: '' };
  await capturedNative.handleNativeStt({}, {
    destroyed: false, writableEnded: false, headersSent: false,
    on() {},
    writeHead(status) { nativeResponse.status = status; this.headersSent = true; },
    end(value) { nativeResponse.body = String(value || ''); this.writableEnded = true; }
  });
  assert.equal(nativeResponse.status, 200, 'captured native STT keeps the media 200-always contract');
  assert.equal(JSON.parse(nativeResponse.body).text, 'two clicks');
  assert.equal(nativeParams.audioWav.toString('ascii', 0, 4), 'RIFF', 'the native recognizer receives the captured take as WAV');

  {
    let signal, release;
    const service = await make({
      readBodyBuffer: async () => capturedPcm,
      localVoice: { transcribe: async (_pcm, opts) => {
        signal = opts.signal;
        return new Promise(resolve => { release = resolve; });
      } }
    });
    const response = new (require('node:events').EventEmitter)();
    response.destroyed = false; response.writableEnded = false;
    response.writeHead = () => assert.fail('must not write to a disconnected preview');
    response.end = () => assert.fail('must not send a stale preview');
    const pending = service.handleLocalVoiceTranscribe({}, response);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(signal.aborted, false);
    response.destroyed = true; response.emit('close');
    assert.equal(signal.aborted, true, 'cancelling a preview reaches the ASR queue');
    release('stale preview'); await pending;
  }

  // A keyed TTS failure falls through to the free Edge floor instead of committing a hard failure.
  let ttsFetches = 0;
  const edge = await make({
    providerRuntimeKey: provider => provider === 'openrouter' ? 'key' : '',
    fetch: async url => {
      ttsFetches++;
      assert.equal(url, 'https://openrouter.ai/api/v1/audio/speech');
      return { ok: false, status: 402, text: async () => 'credits exhausted' };
    },
    edgetts: { enabled: () => true, resolveVoice: () => 'en-US-ChristopherNeural', synth: async () => Buffer.from('edge-mp3') }
  });
  const spoken = await edge.synthesizeForAgent({ text: 'fallback line', voice: 'Umbriel' });
  assert.equal(ttsFetches, 1);
  assert.equal(spoken.ok, true);
  assert.equal(spoken.provider, 'edge');
  assert.equal(spoken.buf.toString(), 'edge-mp3');

  // Dedicated ASR preserves the Groq -> OpenAI order and continues after a failed first tier.
  const asrCalls = [];
  const asr = await make({
    providerRuntimeKey: provider => provider === 'groq' ? 'groq-key' : (provider === 'openai' ? 'openai-key' : ''),
    providerRuntimeBaseUrl: provider => 'https://' + provider + '.invalid/v1',
    fetch: async (url, init) => {
      asrCalls.push({ url, init });
      if (url.startsWith('https://groq.invalid/')) return { ok: false, status: 503, text: async () => 'busy' };
      return { ok: true, status: 200, json: async () => ({ text: 'heard by openai' }) };
    }
  });
  assert.deepEqual(await asr.transcribeAudioBuffer(audio, 'webm'), { ok: true, text: 'heard by openai' });
  assert.equal(asrCalls.length, 2);
  assert.match(asrCalls[0].url, /groq\.invalid\/v1\/audio\/transcriptions$/);
  assert.match(asrCalls[1].url, /openai\.invalid\/v1\/audio\/transcriptions$/);
  assert.ok(asrCalls[0].init.body.includes(audio));
  assert.ok(asrCalls[1].init.body.includes(Buffer.from('whisper-1')));

  // The keyless local floor receives decoded/resampled Float32 PCM, never compressed container bytes.
  let localPcm = null;
  const local = await make({
    localVoice: {
      status: () => ({ available: true }),
      transcribe: async bytes => { localPcm = Buffer.from(bytes); return 'local words'; },
      defaultVoice: () => 'af_heart', edgeVoiceFor: () => 'en-US-ChristopherNeural',
      synthesize: async () => { throw new Error('unused'); }
    }
  });
  assert.deepEqual(await local.transcribeAudioBuffer(wav, 'wav'), { ok: true, text: 'local words' });
  assert.deepEqual(local.sttStatus(), {
    available: true, preferred: 'local', cloud: false, local: true, native: false
  });
  assert.equal(localPcm.length, decoded.length * 4);
  localPcm = null;
  assert.deepEqual(await local.transcribeAudioBuffer(OGG_OPUS, 'ogg'), { ok: true, text: 'local words' });
  assert.equal(localPcm.length, decodedOgg.length * 4, 'Telegram Ogg/Opus reaches local ASR as 16 kHz Float32 PCM');
  assert.match((await local.transcribeAudioBuffer(Buffer.from('compressed'), 'webm')).reason, /local engine cannot decode webm/);

  // Local Live chooses its serving engine once. An Edge-pinned session bypasses Kokoro, while a
  // Kokoro-pinned session fails silent instead of changing to a different voice for one sentence.
  {
    let localCalls = 0, edgeCalls = 0, edgeVoice = '';
    const engines = {
      localVoice: {
        status: () => ({ available: true }), defaultVoice: () => 'am_onyx',
        edgeVoiceFor: () => 'en-US-ChristopherNeural', transcribe: async () => '',
        synthesize: async () => { localCalls++; throw new Error('temporary local failure'); }
      },
      edgetts: {
        enabled: () => true, resolveVoice: () => 'en-US-ChristopherNeural',
        synth: async (_text, options) => { edgeCalls++; edgeVoice = options.voice; return Buffer.from('edge-audio'); }
      }
    };
    const edgePinned = await invokeTts(engines, { text: 'same speaker', local: true, localVoice: 'am_onyx', localEngine: 'edge' });
    assert.equal(edgePinned.headers['X-Voice-Provider'], 'edge:en-US-ChristopherNeural', 'an Edge-pinned session names and keeps its mapped voice');
    assert.equal(localCalls, 0, 'an Edge-pinned session never probes Kokoro between sentences');
    assert.equal(edgeVoice, 'en-US-ChristopherNeural', 'the pinned Edge engine uses the selected voice mapping');

    const localPinned = await invokeTts(engines, { text: 'do not switch', local: true, localVoice: 'am_onyx', localEngine: 'local-kokoro' });
    assert.match(localPinned.headers['Content-Type'], /application\/json/, 'a failed Kokoro-pinned chunk degrades without returning another voice');
    assert.equal(edgeCalls, 1, 'a Kokoro-pinned session never falls through to Edge mid-conversation');
  }

  console.log('media-service: OK (36 assertions)');
})().finally(async () => {
  for (const root of roots) await fsp.rm(root, { recursive: true, force: true });
}).catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
