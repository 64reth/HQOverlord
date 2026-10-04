'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const localVoice = require('../sidecar/local-voice.js');

// Offline speech needs `@huggingface/transformers` + `kokoro-js`, which the shipped desktop bundle does
// NOT carry (Tauri ships sidecar/ frontend/ shared/ and no node_modules). So this test may not assume
// either environment: it independently decides whether the packages are on disk and then holds the module
// to the matching contract. The previous version asserted `available === true` unconditionally and never
// touched an import, so it stayed green on a machine with the packages absent — the exact state of every
// installed build — while the panel told users the capability was there.
function packageOnDisk(name) {
  const parts = name.split('/');
  let dir = path.resolve(__dirname, '..');
  for (;;) {
    if (fs.existsSync(path.join(dir, 'node_modules', ...parts, 'package.json'))) return true;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

(async () => {
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(localVoice.transcribe(Buffer.alloc(16000), {signal:cancelled.signal}), {name:'AbortError'},
    'a cancelled preview is rejected before checking or loading speech models');
  const expected = packageOnDisk('@huggingface/transformers') && packageOnDisk('kokoro-js');
  const status = localVoice.status();

  assert.equal(
    status.available, expected,
    `status().available must match whether the model packages are actually installed (expected ${expected})`
  );
  assert.equal(typeof status.cacheRoot, 'string');
  assert.ok(status.cacheRoot.length > 3);
  assert.ok(
    !/[\\/]node_modules[\\/]/.test(status.cacheRoot),
    'downloaded weights live in the per-user data root, never inside the checkout'
  );
  assert.equal(status.asrBusy, 0);
  assert.equal(status.lastAsrMs, null);
  assert.equal(status.ttsBusy, 0);
  assert.equal(status.lastTtsMs, null);

  {
    const policies = [];
    localVoice._hardenSharpImageDecoders({ block: policy => policies.push(policy) });
    assert.deepEqual(policies, [{ operation: [
      'VipsForeignLoadNsgif',
      'VipsForeignLoadTiff',
      'VipsForeignLoadVips'
    ] }], 'offline voice blocks the vulnerable Sharp/libvips image loaders before Transformers imports');
    assert.throws(
      () => localVoice._hardenSharpImageDecoders({}),
      /image-decoder hardening is unavailable/,
      'offline voice fails closed when the Sharp mitigation cannot be applied'
    );
  }

  // Payload validation runs before anything else, installed or not.
  await assert.rejects(() => localVoice.transcribe(Buffer.alloc(3)), /invalid 16 kHz/);

  if (expected) {
    assert.equal(status.reason, '');
    assert.equal(status.asr, 'cold');
    assert.equal(status.tts, 'cold');
    const silence = await localVoice.transcribe(Buffer.alloc(16000 * 4));
    assert.equal(silence, '', 'digital silence is rejected before Whisper can hallucinate');
  } else {
    // The honest-refusal contract: no state that implies a warm-up is coming, and a reason the UI can print.
    assert.equal(status.asr, 'unavailable');
    assert.equal(status.tts, 'unavailable');
    assert.match(status.reason, /not installed in this build/);
    assert.match(status.error, /not installed in this build/);
    // Silence must NOT resolve to '' here — an empty transcript reads as "you said nothing", which is a
    // claim this build cannot make.
    await assert.rejects(
      () => localVoice.transcribe(Buffer.alloc(16000 * 4)),
      error => error && error.unavailable === true && /not installed in this build/.test(error.message)
    );
    await assert.rejects(() => localVoice.warm(), error => error && error.unavailable === true);
    await assert.rejects(() => localVoice.synthesize('hello'), error => error && error.unavailable === true);
  }

  /* ---- THE SHIPPED FALLBACK IDENTITY: every catalogue voice maps to a real Edge neural ------------------
     An installed build carries no node_modules, so the Kokoro engine can never load there. Before this
     mapping, /api/tts silently fell through to the KEYED provider voice — the picker was inert and the
     station spoke with a different identity than the one chosen (found by ear, 2026-07-30). The mapping
     lives ON the catalogue row precisely so this test can refuse any future voice added without one. */
  {
    const voices = localVoice.voices();
    assert.ok(voices.length >= 18, 'the catalogue did not shrink');
    const EDGE_NAME = /^en-(US|GB)-[A-Za-z]+Neural$/;
    for (const v of voices) {
      assert.match(String(v.edge || ''), EDGE_NAME, v.id + ' carries a shipped Edge fallback voice');
      assert.equal(localVoice.edgeVoiceFor(v.id), v.edge, v.id + ' resolves through edgeVoiceFor');
      // identity honesty: the fallback keeps WHO the voice is — a male pick must never ship female, and a
      // British pick must never ship American. (Coarser within sex+accent is honest; the wrong person is not.)
      const MALE = new Set(['en-US-ChristopherNeural', 'en-US-GuyNeural', 'en-US-RogerNeural', 'en-US-EricNeural', 'en-US-SteffanNeural', 'en-GB-RyanNeural', 'en-GB-ThomasNeural']);
      const FEMALE = new Set(['en-US-JennyNeural', 'en-US-AriaNeural', 'en-US-MichelleNeural', 'en-US-AnaNeural', 'en-GB-SoniaNeural', 'en-GB-LibbyNeural', 'en-GB-MaisieNeural']);
      assert.ok((v.sex === 'male' ? MALE : FEMALE).has(v.edge), v.id + ' (' + v.sex + ') maps to a ' + v.sex + ' Edge voice, got ' + v.edge);
      assert.ok(v.edge.indexOf(v.accent === 'British' ? 'en-GB-' : 'en-US-') === 0, v.id + ' keeps its ' + v.accent + ' accent in the fallback');
    }
    // unknown/empty picks resolve through the DEFAULT voice — always a real name, never undefined and never
    // some other provider's identity.
    const def = voices.find(v => v.id === 'am_onyx').edge;
    assert.equal(localVoice.edgeVoiceFor(''), def, 'an empty pick maps through the default voice');
    assert.equal(localVoice.edgeVoiceFor('not-a-voice'), def, 'an unknown pick maps through the default voice');
  }

  /* ---- the kill-switch: STARNET_LOCAL_VOICE=0 forces the installed-build shape on a dev checkout --------
     This is how tests (and users opting out of on-disk models) reproduce the environment the keyed-
     fallthrough bug only showed on. Dynamic, so a spawned server's env always wins. */
  {
    const before = process.env.STARNET_LOCAL_VOICE;
    process.env.STARNET_LOCAL_VOICE = '0';
    try {
      const off = localVoice.status();
      assert.equal(off.available, false, 'STARNET_LOCAL_VOICE=0 forces the engine unavailable');
      await assert.rejects(() => localVoice.synthesize('hello'), error => error && error.unavailable === true, 'synthesis refuses under the kill-switch');
    } finally {
      if (before === undefined) delete process.env.STARNET_LOCAL_VOICE; else process.env.STARNET_LOCAL_VOICE = before;
    }
    assert.equal(localVoice.status().available, expected, 'clearing the switch restores the probed truth');
  }

  console.log(`local-voice.test.js: ok (models ${expected ? 'installed' : 'absent'})`);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
