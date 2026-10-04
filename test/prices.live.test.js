/* node test/prices.live.test.js — the LIVE pricing layer (models.dev aggregate) and its seam into
   prices.js. This feeds the SPEND SEATBELT, so the tests are mostly about what happens when the
   catalog is hostile, absent, or stale: operator overrides always win, garbage is validated away,
   and the built-in snapshot remains the offline floor. Offline + deterministic (fetch injected,
   disk cache in a temp dir). */
'use strict';
const A = require('./_assert.js');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { makeLivePrices } = require('../sidecar/providers/liveprices.js');
const prices = require('../sidecar/providers/prices.js');

const PAYLOAD = {
  anthropic: { models: {
    'claude-test-9': { cost: { input: 7, output: 42, cache_read: 0.7, cache_write: 8.75 } },
    'claude-garbage': { cost: { input: 'NaN', output: -3 } },
    'claude-absurd': { cost: { input: 99999, output: 5 } }
  } },
  google: { models: {
    'gemini-test-9': { cost: { input: 1.5, output: 9 } }
  } },
  // 2026-08-21: the other metered families ride the same seam (keys as models.dev spells them)
  openai: { models: {
    'gpt-test-9': { cost: { input: 2.5, output: 15, cache_read: 0.25 } },
    'gpt-garbage': { cost: { input: -1, output: 'x' } }
  } },
  xai: { models: { 'grok-test-9': { cost: { input: 2, output: 6 } } } },
  togetherai: { models: { 'org/Model-Test-9': { cost: { input: 0.5, output: 1.5 } } } },
  'fireworks-ai': { models: { 'accounts/fireworks/models/test-9': { cost: { input: 1, output: 4 } } } },
  'some-other-provider': { models: { x: { cost: { input: 1, output: 1 } } } }
};

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'liveprices-'));
  const file = path.join(dir, 'cache.json');

  // ---- A. a fetched catalog maps into per-family tables, garbage rates validated away ----
  {
    const lp = makeLivePrices({ file, fetchImpl: async () => ({ json: async () => PAYLOAD }) });
    A.eq(lp.state().loaded, false, 'nothing loaded before the first refresh');
    A.ok(await lp.refresh(), 'refresh ingests the catalog');
    A.eq(lp.lookup('anthropic', 'claude-test-9'), { in: 7, out: 42 }, 'an anthropic rate resolves');
    A.eq(lp.lookup('gemini', 'gemini-test-9'), { in: 1.5, out: 9 }, 'the google provider maps to our gemini family');
    A.eq(lp.lookup('anthropic', 'claude-garbage'), null, 'a non-numeric/negative rate is dropped, never guessed at');
    A.eq(lp.lookup('anthropic', 'claude-absurd'), null, 'an absurd rate (>$10k/Mtok) is dropped — hostile payloads cannot inflate the seatbelt');
    A.eq(lp.lookup('anthropic', 'claude-test-9-20991231'), { in: 7, out: 42 }, 'a dated/suffixed local id prefix-matches its base entry');
    A.eq(lp.lookup('gemini', 'models/gemini-test-9'), { in: 1.5, out: 9 }, 'the models/ prefix Google APIs carry is stripped');
    A.eq(lp.lookup('anthropic', 'entirely-unknown'), null, 'an unknown model stays unpriced here (the snapshot answers downstream)');
    // the 2026-08-21 families
    A.eq(lp.lookup('openai', 'gpt-test-9'), { in: 2.5, out: 15 }, 'an openai rate resolves');
    A.eq(lp.lookup('openai', 'gpt-garbage'), null, 'openai garbage is dropped');
    A.eq(lp.lookup('xai', 'grok-test-9'), { in: 2, out: 6 }, 'an xai rate resolves');
    A.eq(lp.lookup('together', 'org/Model-Test-9'), { in: 0.5, out: 1.5 }, 'together maps to the togetherai key, case-insensitive org-prefixed id');
    A.eq(lp.lookup('fireworks', 'accounts/fireworks/models/test-9'), { in: 1, out: 4 }, 'fireworks maps to the fireworks-ai key');
    A.eq(lp.lookup('groq', 'anything'), null, 'a family absent from the payload answers null, not a guess');
  }

  // ---- B. the disk cache warms a fresh instance with no fetch at all ----
  {
    const lp2 = makeLivePrices({ file, fetchImpl: async () => { throw new Error('offline'); } });
    A.eq(lp2.state().loaded, true, 'a new instance boots warm from the disk cache');
    A.eq(lp2.lookup('anthropic', 'claude-test-9'), { in: 7, out: 42 }, 'cached rates answer offline');
    A.eq(lp2.lookup('openai', 'gpt-test-9'), { in: 2.5, out: 15 }, 'disk-cache revalidation keeps the new families (openai)');
    A.eq(lp2.lookup('fireworks', 'accounts/fireworks/models/test-9'), { in: 1, out: 4 }, 'disk-cache revalidation keeps the new families (fireworks)');
    A.eq(await lp2.refresh(true), false, 'a failed forced refresh reports false and keeps last-good');
    A.eq(lp2.lookup('anthropic', 'claude-test-9'), { in: 7, out: 42 }, 'last-good survives a dead network');
  }

  // ---- C. a corrupted cache file is survivable ----
  {
    fs.writeFileSync(file, '{ not json');
    const lp3 = makeLivePrices({ file, fetchImpl: async () => ({ json: async () => PAYLOAD }) });
    A.eq(lp3.state().loaded, false, 'a torn cache file loads nothing (never throws)');
    A.ok(await lp3.refresh(), 'and a refresh rebuilds it');
  }

  // ---- D. a drifted payload shape keeps last-good and reports failure ----
  {
    const lp4 = makeLivePrices({ file: null, fetchImpl: async () => ({ json: async () => ({ totally: 'different' }) }) });
    A.eq(await lp4.refresh(), false, 'a shape-drifted payload is rejected wholesale');
    A.eq(lp4.lookup('anthropic', 'claude-test-9'), null, 'and nothing bogus was ingested');
  }

  // ---- E. the prices.js seam: live beats snapshot, operator override beats live, snapshot is the floor ----
  {
    const lp = makeLivePrices({ file: null, fetchImpl: async () => ({ json: async () => PAYLOAD }) });
    await lp.refresh();
    prices.setLiveLookup((family, id) => lp.lookup(family, id));
    try {
      const live = prices.priceOf('anthropic', 'claude-test-9');
      A.eq(live.in, 7, 'a live rate answers through priceOf');
      A.ok(live.cache && live.cache.read === 0.10, 'the family cache multipliers still ride the live rate');
      const snap = prices.priceOf('anthropic', 'claude-opus-4-5');
      A.ok(snap && snap.in > 0, 'a model absent from the live table falls through to the built-in snapshot');
      prices.setLiveLookup(() => { throw new Error('boom'); });
      const survived = prices.priceOf('anthropic', 'claude-opus-4-5');
      A.ok(survived && survived.in > 0, 'a THROWING live lookup never wedges the seatbelt — snapshot answers');
    } finally { prices.setLiveLookup(null); }
    const back = prices.priceOf('anthropic', 'claude-test-9');
    A.eq(back, null, 'unwiring the live layer restores exactly the old behavior (unknown id -> unpriced)');
  }

  fs.rmSync(dir, { recursive: true, force: true });
  A.report('prices.live.test');
})();
