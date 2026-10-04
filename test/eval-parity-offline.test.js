/* node test/eval-parity-offline.test.js — offline parity driver + gate-receipt honesty guards.
 *
 * Two layers, matching the campaign-script test pattern (fail-closed guards get real tests):
 *   1. Unit: the coverage guard and the two receipt honesty guards refuse every dishonest shape.
 *   2. End-to-end: the real driver spawns once and must pass all 32 scripted scenarios AND flag
 *      all 4 deliberate zero-tolerance violation probes through the real runAgentLoop +
 *      fixture MCP host + independent grader — with no credential and no public network.
 */
'use strict';
const A = require('./_assert.js');
const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');

(async () => {
  const root = resolve(__dirname, '..');
  const offline = await import('../scripts/eval/adapters/parity-offline.mjs');
  const gate = await import('../scripts/eval/write-gate-receipt.mjs');

  // ---- coverage guard: a pack scenario without a script must fail closed, never shrink silently ----
  const tasks = Object.keys(offline.SCRIPTS).map(id => ({ id }));
  A.notThrows(() => offline.assertScriptCoverage(tasks), 'full scripted coverage validates');
  A.eq(offline.assertScriptCoverage(tasks), { scripted: 32, total: 32 }, 'all 32 parity scenarios are scripted');
  A.throws(() => offline.assertScriptCoverage(tasks.concat([{ id: 'parity-added-later' }])),
    'a new pack scenario without a script fails the run instead of silently dropping coverage');
  A.throws(() => offline.assertScriptCoverage(tasks.slice(1)),
    'a script for a scenario missing from the pack fails closed too');
  A.eq(offline.PROBES.map(probe => probe.expectViolation).sort(),
    ['authorityEscape', 'duplicateMutation', 'falseDone', 'wrongDestination'],
    'one deliberate probe exists per zero-tolerance invariant class');

  // ---- plumbing-receipt honesty guard: no flag can be flipped, no contract path accepted ----
  const honest = { kind: 'parity-offline-plumbing', liveModel: false, candidateBound: false, satisfiesV090ContractGates: false };
  A.notThrows(() => offline.assertPlumbingReceipt(Object.assign({}, honest), 'out/plumbing.json'), 'honest plumbing receipt passes');
  A.throws(() => offline.assertPlumbingReceipt(Object.assign({}, honest, { kind: 'parity' })), 'a plumbing receipt may never claim kind parity');
  A.throws(() => offline.assertPlumbingReceipt(Object.assign({}, honest, { liveModel: true })), 'liveModel:true is refused — no live model runs offline');
  A.throws(() => offline.assertPlumbingReceipt(Object.assign({}, honest, { candidateBound: true })), 'candidateBound:true is refused for source-tree runs');
  A.throws(() => offline.assertPlumbingReceipt(Object.assign({}, honest, { satisfiesV090ContractGates: true })), 'the frozen contract gates can never be satisfied offline');
  A.throws(() => offline.assertPlumbingReceipt(Object.assign({}, honest), '.dogfood/eval/parity-receipt.json'),
    'writing a plumbing receipt over a contract parity receipt path is refused');

  // ---- gate-receipt honesty guard ----
  const honestGate = { kind: 'credential-free-eval-gate', honesty: { liveModel: false, candidateBound: false, signed: false, provesModelQuality: false, satisfiesV090ContractGates: false } };
  A.notThrows(() => gate.assertGateReceiptHonesty(honestGate), 'honest gate receipt passes');
  A.throws(() => gate.assertGateReceiptHonesty({ kind: 'credential-free-eval-gate' }), 'a gate receipt without an honesty block is refused');
  for (const flag of ['liveModel', 'candidateBound', 'provesModelQuality', 'satisfiesV090ContractGates']) {
    const bent = JSON.parse(JSON.stringify(honestGate));
    bent.honesty[flag] = true;
    A.throws(() => gate.assertGateReceiptHonesty(bent), `gate receipt honesty.${flag}:true is refused`);
  }
  const unsignedless = JSON.parse(JSON.stringify(honestGate));
  delete unsignedless.honesty.signed;
  A.throws(() => gate.assertGateReceiptHonesty(unsignedless), 'signed must be an explicit boolean, never implied');

  // ---- gate-receipt builder: verdict follows step exits; honesty flags are forced in code ----
  const fakeStep = (id, pack, pass) => ({ id, pack, command: 'node x', exitCode: pass ? 0 : 1, pass, durationMs: 1, parsed: {}, summaryLines: [], output: '' });
  const allPass = gate.STEPS.map(step => fakeStep(step.id, step.pack, true));
  const green = gate.buildGateReceipt(allPass);
  A.eq(green.verdict, { pass: true, perPack: { contract: true, quality: true, fault: true, parity: true } }, 'five green steps produce a green per-pack verdict');
  A.eq(green.honesty.liveModel, false, 'gate receipt is born with liveModel:false');
  A.ok(!('output' in green.steps[0]), 'raw step output is not embedded in the committed receipt');
  const oneRed = gate.STEPS.map((step, index) => fakeStep(step.id, step.pack, index !== 2));
  const red = gate.buildGateReceipt(oneRed);
  A.eq(red.verdict.pass, false, 'one red step turns the gate verdict red');
  A.eq(red.verdict.perPack.fault, false, 'the failing pack is named in the verdict');
  const short = gate.buildGateReceipt(allPass.slice(0, 3));
  A.eq(short.verdict.pass, false, 'a partial slice can never produce a green gate verdict');

  // ---- end-to-end: the real driver, once, must pass 32/32 and flag 4/4 probes ----
  const cli = spawnSync(process.execPath, ['scripts/eval/adapters/parity-offline.mjs'], { cwd: root, encoding: 'utf8', timeout: 120000 });
  A.eq(cli.status, 0, 'offline parity driver exits zero — ' + String(cli.stdout || '').split(/\r?\n/).filter(Boolean).pop());
  A.ok(/\[parity-offline\] PASS scenarios=32\/32 probes=4\/4 liveModel=false/.test(cli.stdout),
    'driver proves all 32 scenarios and all 4 violation probes with liveModel=false');
  A.ok(/PROBE FLAGGED probe-false-done/.test(cli.stdout) && /PROBE FLAGGED probe-wrong-destination/.test(cli.stdout)
    && /PROBE FLAGGED probe-duplicate-mutation/.test(cli.stdout) && /PROBE FLAGGED probe-authority-escape/.test(cli.stdout),
    'each zero-tolerance class was individually detected by the independent grader');

  A.report('eval-parity-offline.test');
})().catch(error => { console.error(error && error.stack || error); process.exit(1); });
