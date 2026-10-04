/* node test/credpool.test.js — credential pool ordering + cooldown (P0.2).
   Proves the rotation half the loop's fallback chain needs: order() dedupes + preserves order + caps,
   penalize() sinks a failed key to the back (cooldown), the cooldown EXPIRES on the injected clock, and an
   all-cooled pool still returns every key (never empties). Pure + deterministic. */
'use strict';
const A = require('./_assert.js');
const { makeCredPool } = require('../sidecar/credpool.js');

let clk = 1000;
const clock = { now: () => clk };

// ---- A. order(): dedupe, preserve first-seen order, drop empties ----
{
  const p = makeCredPool({ clock });
  A.eq(p.order(['a', 'b', 'a', '', null, 'c']), ['a', 'b', 'c'], 'deduped, ordered, empties dropped');
  A.eq(p.order([]), [], 'empty in -> empty out');
}

// ---- B. order(): cap at MAX_KEYS (8) ----
{
  const p = makeCredPool({ clock });
  const many = ['k0','k1','k2','k3','k4','k5','k6','k7','k8','k9'];
  A.eq(p.order(many).length, 8, 'capped to 8 keys');
}

// ---- C. penalize(): a failed key sinks to the end; available keys keep order ----
{
  const p = makeCredPool({ clock, cooldownMs: 1000 });
  clk = 5000;
  p.penalize('a');
  A.eq(p.order(['a', 'b', 'c']), ['b', 'c', 'a'], 'penalized key sinks to the back, others keep order');
  A.ok(p.coolingUntil('a') === 6000, 'coolingUntil = now + cooldownMs');
  A.ok(p.coolingUntil('b') === 0, 'un-penalized key is available');
}

// ---- D. cooldown EXPIRES on the injected clock -> key returns to its place ----
{
  const p = makeCredPool({ clock, cooldownMs: 1000 });
  clk = 5000; p.penalize('a');
  clk = 5999; A.eq(p.order(['a', 'b']), ['b', 'a'], 'still cooling just before expiry');
  clk = 6001; A.eq(p.order(['a', 'b']), ['a', 'b'], 'available again after the cooldown expires');
  A.ok(p.coolingUntil('a') === 0, 'coolingUntil clears after expiry');
}

// ---- E. multiple cooled keys ordered by SOONEST-available ----
{
  const p = makeCredPool({ clock, cooldownMs: 1000 });
  clk = 1000; p.penalize('a');   // cools until 2000
  clk = 1500; p.penalize('b');   // cools until 2500
  clk = 1600;
  A.eq(p.order(['a', 'b', 'c']), ['c', 'a', 'b'], 'available first, then cooled by soonest-available');
}

// ---- F. all keys cooled -> still returns every key (never empties), soonest-first ----
{
  const p = makeCredPool({ clock, cooldownMs: 1000 });
  clk = 1000; p.penalize('a');   // until 2000
  clk = 1200; p.penalize('b');   // until 2200
  clk = 1300;
  A.eq(p.order(['a', 'b']), ['a', 'b'], 'all cooled -> all returned, soonest-available first');
}

// ---- G. (H6.1) penalize(key, ttlMs): honor a server-stated wait; clamp a bogus one ----
{
  const p = makeCredPool({ clock, cooldownMs: 1000, maxCooldownMs: 10000 });
  clk = 0;
  p.penalize('a', 3000);                                   // explicit TTL overrides the default cooldown
  A.eq(p.coolingUntil('a'), 3000, 'explicit ttlMs cools for exactly that long (not the 1000 default)');
  p.penalize('b');                                         // no ttl -> default cooldown
  A.eq(p.coolingUntil('b'), 1000, 'no ttl -> default cooldown');
  p.penalize('c', 999999999);                              // absurd server value
  A.eq(p.coolingUntil('c'), 10000, 'a bogus huge ttl is clamped to maxCooldownMs (no all-session strand)');
  p.penalize('d', -5);                                     // garbage negative
  A.eq(p.coolingUntil('d'), 1000, 'a negative ttl falls back to the default cooldown');
}

A.report('credpool.test');
