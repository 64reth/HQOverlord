/* node test/inputguard.test.js - the confinement observer is read-only. */
'use strict';
const A = require('./_assert.js');
const { makeInputGuard } = require('../sidecar/inputguard.js');

(async () => {
  const logs = [];
  let calls = 0;
  const g1 = makeInputGuard({
    platform: 'win32',
    log: (m) => logs.push(m),
    runPs: async () => { calls++; return JSON.stringify({ confined: true, mutated: true, rect: [27, 95, 773, 573] }); }
  });
  const r1 = await g1.observe('boot');
  A.ok(r1.confined, 'confinement detected');
  A.ok(r1.mutated === false, 'ambient output cannot turn observation into mutation');
  A.eq(r1.rect.join(','), '27,95,773,573', 'the confined rect is reported');
  A.eq(calls, 1, 'one probe per observation');
  A.ok(logs.length === 1 && /confined/.test(logs[0]) && /boot/.test(logs[0]) && /left untouched/.test(logs[0]), 'log names the reason and says state was untouched');

  const logs2 = [];
  const g2 = makeInputGuard({ platform: 'win32', log: (m) => logs2.push(m), runPs: async () => JSON.stringify({ confined: false, mutated: false, rect: [0, 0, 3840, 1080] }) });
  const r2 = await g2.observe('shutdown');
  A.ok(!r2.confined && !r2.mutated, 'free cursor is left alone');
  A.eq(logs2.length, 0, 'no log noise when not confined');

  const g3 = makeInputGuard({ platform: 'darwin', runPs: async () => { A.ok(false, 'must not probe off Windows'); } });
  const r3 = await g3.observe('boot');
  A.ok(r3.skipped && !r3.confined && !r3.mutated, 'non-Windows skips honestly');

  const g4 = makeInputGuard({ platform: 'win32', runPs: async () => { throw new Error('powershell exploded'); } });
  const r4 = await g4.observe('halt');
  A.ok(!r4.confined && !r4.mutated && /powershell exploded/.test(r4.error), 'probe failure is reported without fake recovery');

  const g5 = makeInputGuard({ platform: 'win32', runPs: async () => 'not json' });
  const r5 = await g5.observe('boot');
  A.ok(!r5.mutated && r5.error, 'non-JSON probe output is an error');

  A.ok(!/ClipCursor\s*\(\s*\[IntPtr\]::Zero\s*\)/.test(g1._internals.SCRIPT), 'production observer contains no cursor-release call');
  A.ok(!/extern bool ClipCursor/.test(g1._internals.SCRIPT), 'production observer does not import the mutating API');

  A.report('inputguard.test');
})().catch(e => { console.error(e); process.exit(1); });
