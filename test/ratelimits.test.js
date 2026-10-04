/* node test/ratelimits.test.js — PROACTIVE rate-limit accounting.

   Quota used to be learned only by hitting it: errorClass.js reads retry-after / x-ratelimit-*reset* off a 429
   and nothing else was kept. Every adapter's success path is `if (res.ok && res.body) return res`, so the
   *-remaining counters of ordinary successful calls — the ones that say how close the NEXT call is to failing —
   were dropped five times over. A station whose promise is truthful telemetry could only report a wall it had
   already walked into.

   The traps pinned here are the ones that make a quota readout quietly WRONG rather than absent: three live
   header dialects, four encodings of `reset` that are not distinguishable by "is it a number", and a merge
   rule without which a bucket disappears from the display as though the limit had been lifted. */
'use strict';
const A = require('./_assert.js');
const { makeRateLimits } = require('../sidecar/providers/ratelimits.js');

const T = 1700000000000;
const clock = { now: () => T };
const mk = () => makeRateLimits({ clock });

// ---- dialect 1: Anthropic (RFC3339 reset), headers as a real Map-like ----
{
  const rl = mk();
  rl.observe('anthropic', new Map(Object.entries({
    'anthropic-ratelimit-requests-limit': '50',
    'anthropic-ratelimit-requests-remaining': '49',
    'anthropic-ratelimit-requests-reset': new Date(T + 60000).toISOString(),
    'anthropic-ratelimit-input-tokens-limit': '40000',
    'anthropic-ratelimit-input-tokens-remaining': '1200',
    'anthropic-ratelimit-input-tokens-reset': new Date(T + 30000).toISOString()
  })));
  const b = rl.get('anthropic').buckets;
  A.eq(b.requests.remaining, 49, 'anthropic request bucket is read');
  A.eq(b.requests.resetInMs, 60000, 'an RFC3339 reset becomes a real countdown');
  A.eq(b['input-tokens'].limit, 40000, 'the input-token bucket is tracked separately from requests');

  const adv = rl.advise('anthropic');
  A.ok(adv && adv.tight, 'a bucket at 3% of its limit is flagged tight BEFORE the 429');
  A.eq(adv.resource, 'input-tokens', 'and names the resource that is actually short, not the roomy one');
  A.ok(!adv.exhausted, 'tight is distinct from exhausted');
}

// ---- dialect 2: OpenAI (Go-duration reset) ----
{
  const rl = mk();
  rl.observe('openai', {
    'x-ratelimit-limit-requests': '500', 'x-ratelimit-remaining-requests': '499', 'x-ratelimit-reset-requests': '6m0s',
    'x-ratelimit-limit-tokens': '30000', 'x-ratelimit-remaining-tokens': '29000', 'x-ratelimit-reset-tokens': '20ms'
  });
  const b = rl.get('openai').buckets;
  A.eq(b.requests.resetInMs, 360000, 'a Go-style "6m0s" duration is parsed, not silently dropped');
  A.eq(b.tokens.resetInMs, 20, 'and so is "20ms"');
  A.eq(rl.advise('openai'), null, 'a healthy provider advises nothing');
}

// ---- dialect 3: OpenRouter (unqualified triple, epoch-ms reset) ----
{
  const rl = mk();
  rl.observe('openrouter', { 'x-ratelimit-limit': '200', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(T + 3600000) });
  const adv = rl.advise('openrouter');
  A.ok(adv.exhausted, 'a spent bucket reads as exhausted');
  A.eq(adv.resetInMs, 3600000, 'with the REAL wait — an hour, not the "a few seconds" a bare 429 implies');
}

// ---- the four encodings of `reset` ----
{
  const { parseReset } = require('../sidecar/providers/ratelimits.js')._internals;
  A.eq(parseReset(String(T + 5000), T), T + 5000, 'a >1e12 number is epoch MILLIseconds');
  A.eq(parseReset(String((T + 5000) / 1000), T), T + 5000, 'a >1e9 number is epoch SECONDS');
  A.eq(parseReset('20', T), T + 20000, 'a small bare number is DELTA seconds — read as a timestamp it would be 1970');
  A.eq(parseReset('1h30m', T), T + 5400000, 'a compound duration sums its parts');
  A.eq(parseReset('', T), null, 'an empty reset is null, not 0');
  A.eq(parseReset('not-a-time', T), null, 'and so is garbage');
}

// ---- MERGE, never replace ----
{
  const rl = mk();
  rl.observe('anthropic', {
    'anthropic-ratelimit-requests-limit': '50', 'anthropic-ratelimit-requests-remaining': '49',
    'anthropic-ratelimit-input-tokens-limit': '40000', 'anthropic-ratelimit-input-tokens-remaining': '39000'
  });
  // a later response carrying ONLY the request counters (a cached call can omit token buckets entirely)
  rl.observe('anthropic', { 'anthropic-ratelimit-requests-limit': '50', 'anthropic-ratelimit-requests-remaining': '48' });
  const b = rl.get('anthropic').buckets;
  A.ok(b['input-tokens'], 'a partial response does NOT erase a bucket it did not mention — wholesale replacement would read as "the limit was lifted"');
  A.eq(b.requests.remaining, 48, 'and the bucket it did mention is updated');
}

// ---- no data must never look like good news ----
{
  const rl = mk();
  A.eq(rl.observe('gemini', { 'content-type': 'application/json' }), null, 'a provider that sends no quota headers records nothing rather than a row of nulls');
  A.eq(rl.snapshot().length, 0, 'so it never appears in the readout');
  A.eq(rl.get('gemini'), null, 'and get() is null');
  A.eq(rl.advise('gemini'), null, 'advise is null for NO DATA — the caller must not render that as "plenty left"');
  A.eq(rl.observe('x', null), null, 'missing headers are survivable');
}

// ---- an unqualified header alongside a qualified one must not double-count ----
{
  const rl = mk();
  rl.observe('mixed', {
    'x-ratelimit-limit-requests': '500', 'x-ratelimit-remaining-requests': '10',
    'x-ratelimit-limit': '500', 'x-ratelimit-remaining': '10'
  });
  A.eq(Object.keys(rl.get('mixed').buckets).length, 1, 'the same budget reported twice yields ONE bucket, not two rows of the same number');
}

// ---- the wrapper is transparent ----
{
  const rl = mk();
  const res = { ok: true, body: 'B', headers: { 'x-ratelimit-limit': '100', 'x-ratelimit-remaining': '3', 'x-ratelimit-reset': '30' } };
  const wrapped = rl.wrapFetch('wrapped', async () => res);
  wrapped('u').then(function (r) {
    A.ok(r === res, 'wrapFetch hands back the EXACT response object — observation may not alter the wire');
    A.eq(rl.get('wrapped').buckets.requests.remaining, 3, 'and the headers of a SUCCESSFUL call are recorded (this is the whole point)');

    const boom = rl.wrapFetch('x', async () => { throw new Error('net down'); });
    boom('u').then(
      () => { A.ok(false, 'a throwing fetch should still reject'); A.report('ratelimits'); },
      (e) => {
        A.eq(e.message, 'net down', 'a fetch rejection passes through untouched');
        A.eq(rl.wrapFetch('y', null), null, 'wrapping a non-function is a no-op');

        // recomputed on READ: a stored countdown is a lie the moment it is stored
        const late = makeRateLimits({ clock: { now: () => T } });
        late.observe('p', { 'x-ratelimit-limit': '10', 'x-ratelimit-remaining': '1', 'x-ratelimit-reset': String(T + 10000) });
        const moved = makeRateLimits({ clock: { now: () => T } });
        moved.observe('p', { 'x-ratelimit-limit': '10', 'x-ratelimit-remaining': '1', 'x-ratelimit-reset': String(T + 10000) });
        A.eq(late.get('p').buckets.requests.resetInMs, 10000, 'resetInMs is derived from the absolute resetAt at read time');

        A.report('ratelimits');
      }
    );
  });
}
