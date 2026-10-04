'use strict';
const A = require('./_assert.js');
const pairing = require('../sidecar/channels/owner-pairing.js');

function run() {
  const bytes = n => Buffer.alloc(n, 7);
  const issued = pairing.issue({ now: 1000, ttlMs: 5000, randomBytes: bytes });
  A.eq(issued.code, 'HHHHH-HHHHH', 'pairing code is locally displayable without storing it');
  A.ok(!JSON.stringify(issued.state).includes(issued.code.replace(/-/g, '')), 'durable state holds no raw pairing code');
  A.ok(pairing.active(issued.state, 5999), 'challenge is active before expiry');
  A.ok(pairing.verify(issued.state, 'hhhhh-hhhhh', 1001), 'code verification is case and separator insensitive');
  A.ok(!pairing.verify(issued.state, 'HHHHH-HHHHJ', 1001), 'wrong code is refused');
  A.ok(!pairing.verify(issued.state, issued.code, 6000), 'expired code is refused');
  A.ok(!pairing.active(issued.state, 6000), 'expired challenge is not reported active');
  A.report('channels.owner-pairing.test');
}
try { run(); } catch (e) { console.error(e.stack || e); process.exitCode = 1; }
