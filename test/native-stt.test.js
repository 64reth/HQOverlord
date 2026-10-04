'use strict';

const assert = require('node:assert/strict');
const {
  WINDOWS_SCRIPT, WINDOWS_WAV_SCRIPT, DEFAULT_MIN_CONFIDENCE, parseRecognition, gateTranscript, makeNativeStt
} = require('../sidecar/native-stt.js');

const win = (stdout, env) => makeNativeStt({
  platform: 'win32', env,
  execFile(file, args, options, callback) { callback(null, stdout); }
});

(async () => {
  assert.match(WINDOWS_SCRIPT, /System\.Speech/);
  assert.equal(WINDOWS_SCRIPT.includes('$args'), false);
  // Confidence must reach us, and as a culture-proof integer: `{0:N3}` would emit "0,842" on a
  // decimal-comma machine and every parse of it would read as 0, muting the whole gate.
  assert.match(WINDOWS_SCRIPT, /Confidence/);
  assert.match(WINDOWS_SCRIPT, /\[int\]\(\$x\.Confidence\*1000\)/);
  assert.equal(/N3/.test(WINDOWS_SCRIPT), false);
  assert.match(WINDOWS_WAV_SCRIPT, /SetInputToWaveFile\(\$env:STARNET_NATIVE_STT_WAV\)/, 'captured takes use a sidecar-owned environment value, never command interpolation');

  const unsupported = makeNativeStt({ platform: 'linux', execFile() {} });
  assert.equal(unsupported.status().available, false);
  assert.equal((await unsupported.recognize()).ok, false);

  // ---- parsing ----
  assert.deepEqual(parseRecognition('842|hello world\r\n'), { text: 'hello world', confidence: 0.842 });
  // No separator = an unknown confidence, NOT zero. Treating "not reported" as "not confident" would drop
  // every utterance from an older or future script.
  assert.deepEqual(parseRecognition('hello world'), { text: 'hello world', confidence: null });
  assert.deepEqual(parseRecognition(''), { text: '', confidence: null });

  // ---- the gate ----
  const floor = DEFAULT_MIN_CONFIDENCE;
  assert.equal(gateTranscript('open the taskboard', 0.9, floor), 'open the taskboard');
  assert.equal(gateTranscript('  spaced   out  ', 0.9, floor), 'spaced out');
  // room noise the dictation grammar dresses up as a word — dropped at ANY confidence
  for (const noise of ['Mm.', 'mmm', 'hmm', 'uh', 'um', 'ahh', 'oh', 'huh', 'er']) {
    assert.equal(gateTranscript(noise, 0.99, floor), '', `"${noise}" must never reach a run`);
  }
  assert.equal(gateTranscript('...', 0.99, floor), '', 'punctuation-only is not speech');
  assert.equal(gateTranscript('run the build', 0.1, floor), '', 'the engine itself was unsure');
  assert.equal(gateTranscript('run the build', null, floor), 'run the build', 'unknown confidence still passes');
  // a real single-word command must survive
  assert.equal(gateTranscript('stop', 0.8, floor), 'stop');

  // ---- end to end through recognize() ----
  let call = null;
  const engine = makeNativeStt({
    platform: 'win32',
    execFile(file, args, options, callback) { call = { file, args, options }; callback(null, '842|hello from local speech\r\n'); }
  });
  assert.equal(engine.status().available, true);
  assert.equal(engine.status().minConfidence, DEFAULT_MIN_CONFIDENCE);
  assert.deepEqual(await engine.recognize(), { ok: true, text: 'hello from local speech', confidence: 0.842 });
  assert.equal(call.file, 'powershell.exe');
  assert.equal(call.options.windowsHide, true);
  assert.ok(call.args.includes(WINDOWS_SCRIPT));

  // Standard voice owns endpointing: the exact WAV captured between the two clicks is written, recognized,
  // and removed. Local Live still calls recognize() without audio and keeps the default-microphone script.
  {
    const writes = [], unlinks = [];
    let wavCall = null;
    const wavEngine = makeNativeStt({
      platform: 'win32', tempDir: 'C:\\safe-temp', randomUUID: () => 'take-id',
      fsp: {
        async writeFile(file, bytes) { writes.push([file, Buffer.from(bytes)]); },
        async unlink(file) { unlinks.push(file); }
      },
      execFile(file, args, options, callback) { wavCall = { file, args, options }; callback(null, '910|manual endpoint\r\n'); }
    });
    const wav = Buffer.from('RIFF-test-wave');
    assert.deepEqual(await wavEngine.recognize({ audioWav: wav }), { ok: true, text: 'manual endpoint', confidence: 0.91 });
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0][1], wav, 'the captured WAV reaches the recognizer byte-for-byte');
    assert.ok(wavCall.args.includes(WINDOWS_WAV_SCRIPT));
    assert.equal(wavCall.options.env.STARNET_NATIVE_STT_WAV, writes[0][0], 'the generated path is passed out-of-band from the static command');
    assert.deepEqual(unlinks, [writes[0][0]], 'the temporary take is removed after recognition');
  }

  // A dropped utterance reports ok:true with an EMPTY text and NO `error` — the caller reads that as
  // "silence, listen again". An `error` here would paint a red failure in the panel for a quiet room.
  const noisy = await win('980|Mm.\r\n').recognize();
  assert.equal(noisy.ok, true);
  assert.equal(noisy.text, '');
  assert.equal(noisy.error, undefined);
  assert.equal(noisy.dropped, 'below-threshold');
  assert.deepEqual(await win('').recognize(), { ok: true, text: '' }, 'a completed quiet audio file is silence, not a native-engine failure');

  const unsure = await win('120|maybe words\r\n').recognize();
  assert.equal(unsure.text, '', 'a low-confidence transcript never becomes a run');
  assert.equal(unsure.error, undefined);

  // the override is honoured, and a junk override must not disable the gate
  assert.equal((await win('120|maybe words\r\n', { STARNET_NATIVE_STT_MIN_CONFIDENCE: '0.05' }).recognize()).text, 'maybe words');
  assert.equal((await win('120|maybe words\r\n', { STARNET_NATIVE_STT_MIN_CONFIDENCE: 'nonsense' }).recognize()).text, '');

  const failed = makeNativeStt({
    platform: 'win32',
    execFile(file, args, options, callback) { callback(new Error('private OS detail'), ''); }
  });
  assert.deepEqual(await failed.recognize(), { ok: false, text: '', error: 'native speech failed' });

  console.log('native-stt.test.js: ok');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
