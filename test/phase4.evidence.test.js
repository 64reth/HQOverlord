#!/usr/bin/env node
'use strict';

const A = require('./_assert.js');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const script = path.join(ROOT, 'scripts', 'phase4-evidence.mjs');

function run(args, dir) {
  return spawnSync(process.execPath, [script].concat(args, ['--dir', dir]), {
    cwd: ROOT,
    encoding: 'utf8'
  });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'phase4-evidence-'));
try {
  {
    const res = run(['init', '--operator', 'tester'], tmp);
    A.eq(res.status, 0, 'init exits 0');
    const file = path.join(tmp, 'phase4-attended-evidence.json');
    A.ok(fs.existsSync(file), 'init writes attended evidence template');
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    A.eq(doc.operator, 'tester', 'init records operator');
    A.eq(doc.sameWorkTrial.passed, false, 'init does not auto-pass same-work trial');
    A.eq(doc.soak.freshPass, false, 'init does not auto-pass soak');
  }

  {
    const res = run(['check'], tmp);
    A.eq(res.status, 2, 'check exits 2 when evidence is incomplete');
    A.ok(/sameWorkTrial\.passed/.test(res.stdout), 'check names missing same-work pass');
    A.ok(/phase4-decision\.json/.test(res.stdout), 'check names missing decision file');
  }

  {
    const res = run(['init-decision', '--operator', 'tester'], tmp);
    A.eq(res.status, 0, 'init-decision exits 0');
    const decision = JSON.parse(fs.readFileSync(path.join(tmp, 'phase4-decision.json'), 'utf8'));
    A.eq(decision.decision, 'blocked', 'decision placeholder starts blocked');
  }

  {
    const attended = {
      generatedAt: new Date().toISOString(),
      operator: 'tester',
      sameWorkTrial: {
        passed: true,
        screenshots: ['screens/p4.png'],
        runIds: ['run-1'],
        transcriptIds: ['stream-1'],
        artifactPaths: ['artifact.md'],
        ledgerRows: ['ledger-row-1'],
        notes: 'ok'
      },
      soak: {
        freshPass: true,
        restartPass: true,
        transcriptPreserved: true,
        ledgerPreserved: true,
        artifactsPreserved: true,
        memoryPreserved: true,
        stationStatePreserved: true,
        notes: 'ok'
      },
      failureRecovery: {
        cancelPassed: true,
        budgetPassed: true,
        deniedConsentPassed: true,
        toolErrorPassed: true,
        checkpointRestorePassed: true,
        notes: 'ok'
      }
    };
    fs.writeFileSync(path.join(tmp, 'phase4-attended-evidence.json'), JSON.stringify(attended, null, 2));
    const res = run(['check'], tmp);
    A.eq(res.status, 0, 'check exits 0 when evidence and decision are complete enough');
    A.ok(/complete/.test(res.stdout), 'check prints complete verdict');
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

A.report('phase4.evidence.test');
