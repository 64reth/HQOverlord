'use strict';

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { pathToFileURL } = require('node:url');

// Per-user model cache, alongside the rest of the app's data root (%LOCALAPPDATA%\StarNet on Windows,
// ~/Library/Application Support/StarNet on macOS — the two platforms we ship). Never inside the repo:
// these are ~150 MB of downloaded weights, and PRIVACY.md documents this path for manual removal.
function defaultCacheRoot() {
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'StarNet', 'models');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'StarNet', 'models');
  }
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'starnet', 'models');
}

const cacheRoot = process.env.STARNET_MODEL_CACHE || defaultCacheRoot();
const state = { asr: 'cold', tts: 'cold', progress: null, error: '', cacheRoot };
/* THE SPOKEN VOICE OF THE STATION — male by default. The written station voice is "a low, smooth American
   male with a subtle gravelly rasp" (personas.js STATION_VOICE) and the crew sprites read male, so a female
   default was simply wrong. These ids are the engine's own voice files (node_modules/kokoro-js/voices):
   `am_` American male, `bm_` British male, `af_`/`bf_` the female sets. Listed male-first because that is the
   station's character; every one of them is selectable. */
const DEFAULT_LOCAL_VOICE = 'am_onyx';
/* `edge` on every row: the nearest Microsoft Edge read-aloud neural to that voice. This is the built-in
   fallback identity when the bundled offline engine is disabled, damaged, or unavailable, and before this
   mapping existed /api/tts silently fell through to the KEYED provider voice:
   the picker was inert and the station spoke with a completely different identity than the one chosen
   (2026-07-30, found by Andrew's ears on a stale-node_modules dev server that behaved like an installed
   build). The mapping lives ON the catalogue row so a new voice cannot be added without deciding its
   shipped fallback — a test fails on any row without one. Sex and accent are preserved; the Edge free
   set has only ~5 male American neurals for our 8, so some picks share a nearest neighbour — a coarser
   voice on a degraded installation is honest, the WRONG voice is not. */
const LOCAL_VOICES = [
  { id: 'am_onyx', label: 'ONYX', sex: 'male', accent: 'American', edge: 'en-US-ChristopherNeural' },
  { id: 'am_michael', label: 'MICHAEL', sex: 'male', accent: 'American', edge: 'en-US-GuyNeural' },
  { id: 'am_adam', label: 'ADAM', sex: 'male', accent: 'American', edge: 'en-US-RogerNeural' },
  { id: 'am_eric', label: 'ERIC', sex: 'male', accent: 'American', edge: 'en-US-EricNeural' },
  { id: 'am_liam', label: 'LIAM', sex: 'male', accent: 'American', edge: 'en-US-SteffanNeural' },
  { id: 'am_fenrir', label: 'FENRIR', sex: 'male', accent: 'American', edge: 'en-US-ChristopherNeural' },
  { id: 'am_echo', label: 'ECHO', sex: 'male', accent: 'American', edge: 'en-US-GuyNeural' },
  { id: 'am_puck', label: 'PUCK', sex: 'male', accent: 'American', edge: 'en-US-SteffanNeural' },
  { id: 'bm_george', label: 'GEORGE', sex: 'male', accent: 'British', edge: 'en-GB-RyanNeural' },
  { id: 'bm_lewis', label: 'LEWIS', sex: 'male', accent: 'British', edge: 'en-GB-ThomasNeural' },
  { id: 'bm_daniel', label: 'DANIEL', sex: 'male', accent: 'British', edge: 'en-GB-ThomasNeural' },
  { id: 'bm_fable', label: 'FABLE', sex: 'male', accent: 'British', edge: 'en-GB-RyanNeural' },
  { id: 'af_heart', label: 'HEART', sex: 'female', accent: 'American', edge: 'en-US-JennyNeural' },
  { id: 'af_bella', label: 'BELLA', sex: 'female', accent: 'American', edge: 'en-US-AriaNeural' },
  { id: 'af_nova', label: 'NOVA', sex: 'female', accent: 'American', edge: 'en-US-MichelleNeural' },
  { id: 'af_sarah', label: 'SARAH', sex: 'female', accent: 'American', edge: 'en-US-JennyNeural' },
  { id: 'bf_emma', label: 'EMMA', sex: 'female', accent: 'British', edge: 'en-GB-SoniaNeural' },
  { id: 'bf_alice', label: 'ALICE', sex: 'female', accent: 'British', edge: 'en-GB-LibbyNeural' }
];
const localVoiceIds = new Set(LOCAL_VOICES.map(v => v.id));
// Validated, never passed through: an unknown id would fail deep inside the engine with a stack trace
// instead of simply speaking in the default voice.
function normalizeLocalVoice(id) {
  const v = String(id || '').trim();
  return localVoiceIds.has(v) ? v : '';
}
/* The SHIPPED identity of a picked voice: the Edge neural nearest to it (see the catalogue note). An
   unknown/empty pick maps through the default voice, so the answer is always a real Edge voice name —
   the caller never has to invent one, and never falls back to a different provider's identity. */
function edgeVoiceFor(id) {
  const want = normalizeLocalVoice(id) || DEFAULT_LOCAL_VOICE;
  const row = LOCAL_VOICES.find(v => v.id === want) || LOCAL_VOICES[0];
  return row.edge;
}



// ---- installation probe -------------------------------------------------------------------------
// Offline speech needs two npm packages (`@huggingface/transformers` + `kokoro-js`, which drags in
// onnxruntime-node's native binaries). Release builds stage that runtime closure beside `sidecar/`, where
// Node resolves it normally. `status()` must still PROVE the packages are present rather than infer them
// from being packaged: an interrupted/custom install or explicit opt-out must degrade truthfully, and
// before this probe existed the panel showed users a raw "Cannot find module" string.
const REQUIRED_PACKAGES = ['@huggingface/transformers', 'kokoro-js'];
const UNAVAILABLE_REASON =
  'offline speech models are not installed in this build (run "npm install" in a source checkout to enable them)';
let installedCache = null;

function packagePresent(name) {
  try {
    require.resolve(name);
    return true;
  } catch (error) {
    // An ESM-only package whose exports map omits the `require` condition still PROVES it is on disk —
    // resolution got far enough to read its package.json before rejecting the CommonJS condition.
    const code = error && error.code;
    if (code === 'ERR_PACKAGE_PATH_NOT_EXPORTED' || code === 'ERR_REQUIRE_ESM') return true;
  }
  // Fallback for any other resolver refusal: look for the package directory itself on the module paths.
  for (const base of module.paths || []) {
    if (fs.existsSync(path.join(base, ...name.split('/'), 'package.json'))) return true;
  }
  return false;
}

/* Kill-switch: STARNET_LOCAL_VOICE=0 (or SKYNET_) forces the engine unavailable even where the packages
   resolve. Two real uses: a user opting out of the on-disk models, and TESTS reproducing the installed-build
   shape (no node_modules) on a dev checkout — the shape the 2026-07-30 keyed-fallthrough bug only showed on.
   Read dynamically (not cached) so a spawned test server's env always wins over require-time state. */
function disabledByEnv() {
  const v = process.env.STARNET_LOCAL_VOICE != null ? process.env.STARNET_LOCAL_VOICE : process.env.SKYNET_LOCAL_VOICE;
  return /^(0|false|no|off)$/i.test(String(v == null ? '' : v).trim());
}

function installed() {
  if (disabledByEnv()) return false;
  if (installedCache === null) installedCache = REQUIRED_PACKAGES.every(packagePresent);
  return installedCache;
}

function requireInstalled() {
  if (!installed()) {
    const error = new Error(UNAVAILABLE_REASON);
    error.unavailable = true;
    throw error;
  }
}
let transformersPromise = null;
let transcriberPromise = null;
let kokoroPromise = null;
let asrTail = Promise.resolve();
let asrBusy = 0;
let lastAsrMs = null;
let ttsTail = Promise.resolve();
let ttsBusy = 0;
let lastTtsMs = null;
const monotonicMs = () => Number(process.hrtime.bigint() / 1000000n);

// Transformers eagerly loads Sharp even though StarNet's offline voice paths are audio/text only. Sharp
// <0.35 inherits vulnerable libvips loaders; upstream's documented compatible workaround is to disable
// GIF, TIFF, and VIPS decoding. Apply it before either Transformers copy is imported so future call sites
// cannot accidentally turn an unused image surface into an untrusted-input decoder.
const BLOCKED_SHARP_LOADERS = Object.freeze([
  'VipsForeignLoadNsgif',
  'VipsForeignLoadTiff',
  'VipsForeignLoadVips'
]);
function hardenSharpImageDecoders(sharpImpl = require('sharp')) {
  if (!sharpImpl || typeof sharpImpl.block !== 'function') {
    throw new Error('offline speech image-decoder hardening is unavailable');
  }
  sharpImpl.block({ operation: BLOCKED_SHARP_LOADERS.slice() });
}

async function transformers() {
  if (!transformersPromise) {
    hardenSharpImageDecoders();
    transformersPromise = import('@huggingface/transformers').then(mod => {
      mod.env.cacheDir = path.join(cacheRoot, 'transformers');
      mod.env.allowLocalModels = true;
      mod.env.allowRemoteModels = true;
      return mod;
    });
  }
  return transformersPromise;
}

function onProgress(kind, event) {
  if (!event || typeof event !== 'object') return;
  const pct = Number(event.progress);
  state.progress = {
    kind,
    file: path.basename(String(event.file || event.name || 'model')),
    percent: Number.isFinite(pct) ? Math.max(0, Math.min(100, Math.round(pct))) : null
  };
}

async function loadAsr() {
  if (!transcriberPromise) {
    state.asr = 'loading';
    transcriberPromise = (async () => {
      await fsp.mkdir(path.join(cacheRoot, 'transformers'), { recursive: true });
      const { pipeline } = await transformers();
      const pipe = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
        dtype: 'q8',
        device: 'cpu',
        progress_callback: event => onProgress('asr', event)
      });
      state.asr = 'ready';
      state.progress = null;
      return pipe;
    })().catch(error => {
      state.asr = 'error';
      state.error = String(error && error.message || error);
      transcriberPromise = null;
      throw error;
    });
  }
  return transcriberPromise;
}

async function loadTts() {
  if (!kokoroPromise) {
    state.tts = 'loading';
    kokoroPromise = (async () => {
      await fsp.mkdir(path.join(cacheRoot, 'transformers'), { recursive: true });
      await transformers();
      // kokoro-js 1.2 checks a free `__dirname` before import.meta.dirname when locating its bundled voice
      // vectors. A CommonJS host exposes that name globally to the ESM bundle, so point it at Kokoro's dist
      // directory instead of the app entry point.
      const kokoroEntry = require.resolve('kokoro-js');
      global.__dirname = path.dirname(kokoroEntry);
      // Kokoro currently carries Transformers v3 while ASR uses v4. Configure that nested copy separately
      // so both model families live in the per-user cache rather than inside the repository.
      const kokoroTransformersEntry = require.resolve('@huggingface/transformers', {
        paths: [path.dirname(kokoroEntry)]
      });
      const kokoroTransformers = await import(pathToFileURL(kokoroTransformersEntry).href);
      (kokoroTransformers.env || kokoroTransformers.default.env).cacheDir =
        path.join(cacheRoot, 'transformers-kokoro');
      const { KokoroTTS } = await import('kokoro-js');
      const model = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
        // q4 is the stable CPU artifact on Windows; the current q8 ONNX export fails to initialize in
        // onnxruntime-node on some WebView2/Codex development machines.
        dtype: 'q4',
        device: 'cpu',
        progress_callback: event => onProgress('tts', event)
      });
      state.tts = 'ready';
      state.progress = null;
      return model;
    })().catch(error => {
      state.tts = 'error';
      state.error = String(error && error.message || error);
      kokoroPromise = null;
      throw error;
    });
  }
  return kokoroPromise;
}

async function warm(options = {}) {
  requireInstalled();
  const jobs = [];
  if (options.asr !== false) jobs.push(loadAsr());
  if (options.tts !== false) jobs.push(loadTts());
  const results = await Promise.allSettled(jobs);
  const failed = results.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;
  return status();
}

async function transcribe(buffer, options = {}) {
  const checkAbort = () => {
    if (options.signal && options.signal.aborted) {
      const error = new Error('transcription cancelled'); error.name = 'AbortError'; throw error;
    }
  };
  checkAbort();
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer.length % 4) {
    throw new Error('invalid 16 kHz Float32 PCM payload');
  }
  // Availability is checked BEFORE the silence gate: a build that cannot hear must say so, never return
  // an empty transcript that reads as "you said nothing".
  requireInstalled();
  const samples = new Float32Array(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  );
  let energy = 0;
  for (let i = 0; i < samples.length; i++) energy += samples[i] * samples[i];
  const rms = Math.sqrt(energy / samples.length);
  if (rms < 0.0025) return options.words ? { text: '', chunks: [] } : '';
  const run = async () => {
    checkAbort();
    asrBusy++;
    const started = monotonicMs();
    try {
      const pipe = await loadAsr();
      checkAbort();
      const result = await pipe(samples, { chunk_length_s: 20, stride_length_s: 3,
        ...(options.words ? { return_timestamps: 'word' } : {}) });
      checkAbort();
      let text = String(result && result.text || '').replace(/\[(?:blank_audio|blank audio|silence|music)\]/ig, '').trim();
      if (rms < 0.006 && /^(?:you|thank you|thanks for watching|the end)[.!]?$/i.test(text)) text = '';
      return options.words ? { text, chunks: text ? result.chunks || [] : [] } : text;
    } finally {
      lastAsrMs = monotonicMs() - started;
      asrBusy = Math.max(0, asrBusy - 1);
    }
  };
  // ONNX sessions are not safely concurrent on every Windows CPU backend. Serialize partial/final requests;
  // the browser permits only one partial in flight, so a final turn waits behind at most one preview.
  const queued = asrTail.then(run, run);
  asrTail = queued.catch(() => {});
  return queued;
}

async function synthesize(text, options = {}) {
  requireInstalled();
  const run = async () => {
    ttsBusy++;
    const started = monotonicMs();
    try {
      const model = await loadTts();
      const audio = await model.generate(String(text || '').slice(0, 1200), {
        voice: normalizeLocalVoice(options.voice) || DEFAULT_LOCAL_VOICE,
        speed: Number(options.speed) || 1
      });
      return Buffer.from(await audio.toBlob().arrayBuffer());
    } finally {
      lastTtsMs = monotonicMs() - started;
      ttsBusy = Math.max(0, ttsBusy - 1);
    }
  };
  const queued = ttsTail.then(run, run);
  ttsTail = queued.catch(() => {});
  return queued;
}

function status() {
  const ready = installed();
  return {
    available: ready,
    reason: ready ? '' : UNAVAILABLE_REASON,
    // 'unavailable' rather than 'cold': cold promises a warm-up that will never come.
    asr: ready ? state.asr : 'unavailable',
    tts: ready ? state.tts : 'unavailable',
    progress: ready ? state.progress : null,
    error: ready ? state.error : UNAVAILABLE_REASON,
    cacheRoot: state.cacheRoot,
    voice: DEFAULT_LOCAL_VOICE,
    voices: LOCAL_VOICES.slice(),
    asrBusy,
    lastAsrMs,
    ttsBusy,
    lastTtsMs
  };
}

module.exports = { warm, transcribe, synthesize, status, voices: () => LOCAL_VOICES.slice(), defaultVoice: () => DEFAULT_LOCAL_VOICE, normalizeLocalVoice, edgeVoiceFor, _hardenSharpImageDecoders: hardenSharpImageDecoders };
