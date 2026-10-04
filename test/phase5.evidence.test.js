#!/usr/bin/env node
'use strict';

const A = require('./_assert.js');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const script = path.join(ROOT, 'scripts', 'phase5-evidence.mjs');

function run(args, dir) {
  return spawnSync(process.execPath, [script].concat(args, ['--dir', dir]), {
    cwd: ROOT,
    encoding: 'utf8'
  });
}

function completeEvidence(overrides) {
  const base = {
    generatedAt: new Date().toISOString(),
    operator: 'tester',
    workloads: {
      passed: true,
      proofLevel: 'live-ui',
      screenshots: ['screens/p5.png'],
      runIds: ['run-1'],
      transcriptIds: ['stream-1'],
      artifactPaths: ['artifact.md'],
      ledgerRows: ['ledger-row-1'],
      modelNames: ['model-1'],
      toolCalls: ['fs_write', 'notebook_write', 'shell_exec'],
      notes: 'ok'
    },
    surface: {
      browser: { status: 'contract-green', proofLevel: 'automated-contract', logs: ['browser.log'], notes: 'contract green, not ref-proven' },
      computer: { status: 'contract-green', proofLevel: 'automated-contract', logs: ['computer.log'], notes: 'contract green, not ref-proven' }
    },
    soak: {
      phase4LiveGreen: true,
      phase5WorkloadGreen: true,
      restartPreserved: true,
      notes: 'ok'
    },
    recovery: {
      phase4RecoveryGreen: true,
      phase5RecoveryGreen: true,
      notes: 'ok'
    },
    desktop: {
      status: 'toolchain-blocked',
      logs: ['desktop.log'],
      notes: 'cargo missing on this machine'
    }
  };
  return Object.assign(base, overrides || {});
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'phase5-evidence-'));
try {
  {
    const res = run(['init', '--operator', 'tester'], tmp);
    A.eq(res.status, 0, 'init exits 0');
    const file = path.join(tmp, 'phase5-evidence.json');
    A.ok(fs.existsSync(file), 'init writes phase5 evidence template');
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    A.eq(doc.operator, 'tester', 'init records operator');
    A.eq(doc.workloads.passed, false, 'init does not auto-pass workloads');
  }

  {
    const res = run(['check'], tmp);
    A.eq(res.status, 2, 'check exits 2 when evidence is incomplete');
    A.ok(/workloads\.passed/.test(res.stdout), 'check names missing workload pass');
    A.ok(/phase5-decision\.json/.test(res.stdout), 'check names missing decision file');
  }

  {
    const res = run(['init-decision', '--operator', 'tester'], tmp);
    A.eq(res.status, 0, 'init-decision exits 0');
    const decision = JSON.parse(fs.readFileSync(path.join(tmp, 'phase5-decision.json'), 'utf8'));
    A.eq(decision.decision, 'blocked', 'decision placeholder starts blocked');
  }

  {
    fs.writeFileSync(path.join(tmp, 'phase5-evidence.json'), JSON.stringify(completeEvidence(), null, 2));
    fs.writeFileSync(path.join(tmp, 'phase5-decision.json'), JSON.stringify({
      decision: 'limited-pilot',
      acceptedBy: 'tester',
      acceptedAt: new Date().toISOString(),
      notes: 'contract-green surfaces are accepted for pilot only',
      acceptedReplacementGaps: ['browser/computer are not ref-proven']
    }, null, 2));
    const res = run(['check'], tmp);
    A.eq(res.status, 0, 'limited-pilot evidence can be complete');
    A.ok(/replacementReady: false/.test(res.stdout), 'limited pilot is not replacement-ready');
  }

  {
    fs.writeFileSync(path.join(tmp, 'phase5-decision.json'), JSON.stringify({
      decision: 'ready-to-replace',
      acceptedBy: 'tester',
      acceptedAt: new Date().toISOString(),
      notes: 'should be rejected',
      acceptedReplacementGaps: []
    }, null, 2));
    const res = run(['check'], tmp);
    A.eq(res.status, 2, 'ready-to-replace is rejected without strict proof');
    A.ok(/strict P5 evidence/.test(res.stdout), 'check explains strict evidence rule');
  }

  {
    const strict = completeEvidence({
      surface: {
        browser: { status: 'ref-proven', proofLevel: 'live-ui', logs: ['browser-live.log'], notes: 'live browser proof' },
        computer: { status: 'ref-proven', proofLevel: 'live-desktop', logs: ['computer-live.log'], notes: 'live computer-use proof' }
      },
      desktop: { status: 'green', logs: ['desktop.log'], notes: 'desktop build verified' }
    });
    fs.writeFileSync(path.join(tmp, 'phase5-evidence.json'), JSON.stringify(strict, null, 2));
    const res = run(['check'], tmp);
    A.eq(res.status, 0, 'ready-to-replace is accepted with strict proof');
    A.ok(/replacementReady: true/.test(res.stdout), 'strict proof marks replacementReady true');
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

A.report('phase5.evidence.test');

