#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const script = path.join(ROOT, 'scripts', 't1-signing.mjs');

function run(args, env) {
  return spawnSync(process.execPath, [script].concat(args || []), {
    cwd: ROOT,
    encoding: 'utf8',
    env: Object.assign({}, process.env, env || {})
  });
}

function mockSignatures(app, installer, status) {
  return JSON.stringify([
    { path: app, status, statusMessage: status, signerSubject: status === 'Valid' ? 'CN=StarNet Test' : '', signerThumbprint: status === 'Valid' ? 'ABC' : '' },
    { path: installer, status, statusMessage: status, signerSubject: status === 'Valid' ? 'CN=StarNet Test' : '', signerThumbprint: status === 'Valid' ? 'ABC' : '' }
  ]);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't1-signing-'));
try {
  const app = path.join(tmp, 'skynet-desktop.exe');
  const installer = path.join(tmp, 'StarNet_0.1.0_x64-setup.exe');
  const out = path.join(tmp, 'out');
  const latest = path.join(tmp, 'latest');
  fs.writeFileSync(app, 'fake app');
  fs.writeFileSync(installer, 'fake installer');

  {
    const res = run([], {
      STARNET_T1_APP_EXE: app,
      STARNET_T1_INSTALLER_EXE: installer,
      STARNET_T1_SIGNING_DIR: out,
      STARNET_T1_SIGNING_LATEST_DIR: latest,
      STARNET_T1_AUTHENTICODE_MOCK: mockSignatures(app, installer, 'NotSigned')
    });
    assert.equal(res.status, 0, res.stderr || res.stdout);
    const status = JSON.parse(fs.readFileSync(path.join(out, 't1-signing-status.json'), 'utf8'));
    assert.equal(status.invitedBetaReady, true);
    assert.equal(status.publicReleaseReady, false);
    assert.equal(status.leadTimeStarted, false);
    assert.equal(status.nextAction.id, 't1.4-cert-procurement');
    assert.ok(status.acceptedLeadTimeGaps.length >= 2, 'unsigned beta records accepted gaps');
  }

  {
    const publicOut = path.join(tmp, 'public-out');
    const res = run(['--public'], {
      STARNET_T1_APP_EXE: app,
      STARNET_T1_INSTALLER_EXE: installer,
      STARNET_T1_SIGNING_DIR: publicOut,
      STARNET_T1_SIGNING_LATEST_DIR: path.join(tmp, 'public-latest'),
      STARNET_T1_AUTHENTICODE_MOCK: mockSignatures(app, installer, 'NotSigned')
    });
    assert.equal(res.status, 2, res.stderr || res.stdout);
    const status = JSON.parse(fs.readFileSync(path.join(publicOut, 't1-signing-status.json'), 'utf8'));
    assert.equal(status.publicReleaseReady, false);
    assert.equal(status.verdict, 'blocked');
    assert.equal(status.nextAction.id, 't1.4-cert-procurement');
  }

  {
    const startedOut = path.join(tmp, 'started-out');
    const res = run([], {
      STARNET_T1_APP_EXE: app,
      STARNET_T1_INSTALLER_EXE: installer,
      STARNET_T1_SIGNING_DIR: startedOut,
      STARNET_T1_SIGNING_LATEST_DIR: path.join(tmp, 'started-latest'),
      STARNET_T1_AUTHENTICODE_MOCK: mockSignatures(app, installer, 'NotSigned'),
      STARNET_AUTHENTICODE_CERT_STATUS: 'started'
    });
    assert.equal(res.status, 0, res.stderr || res.stdout);
    const status = JSON.parse(fs.readFileSync(path.join(startedOut, 't1-signing-status.json'), 'utf8'));
    assert.equal(status.leadTimeStarted, true);
    assert.equal(status.nextAction.id, 't1.3-tauri-updater-signature');
  }

  {
    const staleSigOut = path.join(tmp, 'stale-sig-out');
    fs.writeFileSync(installer + '.sig', 'stale updater signature');
    fs.utimesSync(installer + '.sig', new Date('2026-06-28T00:00:00.000Z'), new Date('2026-06-28T00:00:00.000Z'));
    fs.utimesSync(installer, new Date('2026-06-29T00:00:00.000Z'), new Date('2026-06-29T00:00:00.000Z'));
    const res = run(['--public'], {
      STARNET_T1_APP_EXE: app,
      STARNET_T1_INSTALLER_EXE: installer,
      STARNET_T1_SIGNING_DIR: staleSigOut,
      STARNET_T1_SIGNING_LATEST_DIR: path.join(tmp, 'stale-sig-latest'),
      STARNET_T1_AUTHENTICODE_MOCK: mockSignatures(app, installer, 'Valid')
    });
    assert.equal(res.status, 2, res.stderr || res.stdout);
    const status = JSON.parse(fs.readFileSync(path.join(staleSigOut, 't1-signing-status.json'), 'utf8'));
    const updater = status.results.find(r => r.id === 't1.3-tauri-updater-signature');
    assert.equal(status.publicReleaseReady, false);
    assert.equal(updater.status, 'blocked');
    assert.match(updater.reason, /older than the current installer/);
    assert.equal(status.nextAction.id, 't1.3-tauri-updater-signature');
  }

  {
    const signedOut = path.join(tmp, 'signed-out');
    fs.writeFileSync(installer + '.sig', 'fake updater signature');
    fs.utimesSync(installer + '.sig', new Date('2026-06-29T00:01:00.000Z'), new Date('2026-06-29T00:01:00.000Z'));
    const res = run(['--public'], {
      STARNET_T1_APP_EXE: app,
      STARNET_T1_INSTALLER_EXE: installer,
      STARNET_T1_SIGNING_DIR: signedOut,
      STARNET_T1_SIGNING_LATEST_DIR: path.join(tmp, 'signed-latest'),
      STARNET_T1_AUTHENTICODE_MOCK: mockSignatures(app, installer, 'Valid')
    });
    assert.equal(res.status, 0, res.stderr || res.stdout);
    const status = JSON.parse(fs.readFileSync(path.join(signedOut, 't1-signing-status.json'), 'utf8'));
    assert.equal(status.publicReleaseReady, true);
    assert.equal(status.acceptedLeadTimeGaps.length, 0);
    assert.equal(status.nextAction, null);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('t1-signing.test: OK (20 assertions)');
