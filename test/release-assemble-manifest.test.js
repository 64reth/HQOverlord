#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makeSigner } = require('./minisign-test-signer.js');

const ROOT = path.resolve(__dirname, '..');
const script = path.join(ROOT, 'scripts', 'release-assemble-manifest.mjs');

let assertions = 0;
function ok(cond, msg) { assert.ok(cond, msg); assertions++; }
function eq(a, b, msg) { assert.equal(a, b, msg); assertions++; }

function run(args) {
  return spawnSync(process.execPath, [script].concat(args || []), { cwd: ROOT, encoding: 'utf8' });
}

// One signer for the whole file — its pubkey stands in for the baked tauri.conf.json key.
const signer = makeSigner();

// Write an artifact and (by default) a REAL signature over its bytes. Pass sig:null for
// no .sig file, or a literal string to plant a specific (possibly bogus) sig.
function writeArtifact(dir, rel, sig) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const bytes = Buffer.from('fake artifact bytes for ' + rel);
  fs.writeFileSync(full, bytes);
  if (sig === undefined) {
    fs.writeFileSync(full + '.sig', signer.sign(bytes, { fileName: path.basename(rel) }).sigFileContent);
  } else if (sig !== null) {
    fs.writeFileSync(full + '.sig', sig);
  }
  return full;
}
// Build a full five-platform dist tree; caller may then mutate it. The mac bundles carry
// per-arch basenames, matching what the release train's rename step produces — release
// assets are a flat namespace, so identical basenames are a collision (see test 8).
function fullDist(base) {
  writeArtifact(base, 'StarNet_0.2.0_x64-setup.exe');
  writeArtifact(base, path.join('macos', 'aarch64', 'StarNet_darwin-arm64.app.tar.gz'));
  writeArtifact(base, path.join('macos', 'x86_64', 'StarNet_darwin-x64.app.tar.gz'));
  writeArtifact(base, 'StarNet_0.2.0_amd64.AppImage');
  writeArtifact(base, 'StarNet_0.2.0_amd64.deb');
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'release-assemble-'));
try {
  const pubFile = path.join(tmp, 'test.pub');
  fs.writeFileSync(pubFile, signer.pubkeyDoc);
  const COMMON = ['--version', '0.2.0', '--repo', 'androoAGI/starnet-releases',
    '--tag', 'v0.2.0', '--pubkey', pubFile];

  // 1. Happy 5-platform path (signatures cryptographically verified).
  {
    const dist = path.join(tmp, 'happy');
    fs.mkdirSync(dist);
    fullDist(dist);
    const out = path.join(tmp, 'happy-latest.json');
    const res = run(['--dist', dist, ...COMMON, '--out', out]);
    eq(res.status, 0, res.stderr || res.stdout);
    ok(/sig VERIFIED against baked pubkey/.test(res.stdout), 'summary shows crypto verification ran');
    const m = JSON.parse(fs.readFileSync(out, 'utf8'));
    eq(m.version, '0.2.0', 'version');
    ok(typeof m.pub_date === 'string' && m.pub_date.length > 0, 'pub_date present');
    eq(Object.keys(m.platforms).sort().join(','),
      'darwin-aarch64,darwin-x86_64,linux-x86_64,linux-x86_64-deb,windows-x86_64', 'all five platforms');
    eq(m.platforms['windows-x86_64'].signature,
      fs.readFileSync(path.join(dist, 'StarNet_0.2.0_x64-setup.exe.sig'), 'utf8').trim(), 'win sig is the .sig content');
    eq(m.platforms['windows-x86_64'].url,
      'https://github.com/androoAGI/starnet-releases/releases/download/v0.2.0/StarNet_0.2.0_x64-setup.exe',
      'win url points at versioned tag asset');
    ok(m.platforms['darwin-aarch64'].url.endsWith('/v0.2.0/StarNet_darwin-arm64.app.tar.gz'), 'mac-arm url basename');
    ok(m.platforms['darwin-x86_64'].url.endsWith('/v0.2.0/StarNet_darwin-x64.app.tar.gz'), 'mac-x64 url basename');
    ok(m.platforms['linux-x86_64'].url.endsWith('/v0.2.0/StarNet_0.2.0_amd64.AppImage'), 'appimage url basename');
    // The key the tauri-plugin-updater resolves for .deb installs — without it, .deb
    // users fall back to the AppImage and hard-fail at install time.
    ok(m.platforms['linux-x86_64-deb'].url.endsWith('/v0.2.0/StarNet_0.2.0_amd64.deb'), 'deb url basename');
    eq(m.platforms['linux-x86_64-deb'].signature,
      fs.readFileSync(path.join(dist, 'StarNet_0.2.0_amd64.deb.sig'), 'utf8').trim(), 'deb sig is the .sig content');
    ok(m.platforms['windows-x86_64'].url.startsWith('https://'), 'https url');
  }

  // 2. Missing platform → hard fail.
  {
    const dist = path.join(tmp, 'missing');
    fs.mkdirSync(dist);
    fullDist(dist);
    fs.rmSync(path.join(dist, 'StarNet_0.2.0_amd64.AppImage'));
    fs.rmSync(path.join(dist, 'StarNet_0.2.0_amd64.AppImage.sig'));
    const res = run(['--dist', dist, ...COMMON, '--out', path.join(tmp, 'missing-latest.json')]);
    eq(res.status, 1, 'missing platform should fail');
    ok(/missing artifacts for platform/i.test(res.stderr), 'missing message');
    ok(/linux-x86_64/.test(res.stderr), 'names missing platform');
  }

  // 2b. Missing .deb specifically → hard fail naming linux-x86_64-deb.
  {
    const dist = path.join(tmp, 'missing-deb');
    fs.mkdirSync(dist);
    fullDist(dist);
    fs.rmSync(path.join(dist, 'StarNet_0.2.0_amd64.deb'));
    fs.rmSync(path.join(dist, 'StarNet_0.2.0_amd64.deb.sig'));
    const res = run(['--dist', dist, ...COMMON, '--out', path.join(tmp, 'missing-deb-latest.json')]);
    eq(res.status, 1, 'missing .deb should fail');
    ok(/linux-x86_64-deb/.test(res.stderr), 'names linux-x86_64-deb as missing');
  }

  // 3. allow-missing → pass with a 4-platform manifest.
  {
    const dist = path.join(tmp, 'allow');
    fs.mkdirSync(dist);
    fullDist(dist);
    fs.rmSync(path.join(dist, 'StarNet_0.2.0_amd64.AppImage'));
    fs.rmSync(path.join(dist, 'StarNet_0.2.0_amd64.AppImage.sig'));
    const out = path.join(tmp, 'allow-latest.json');
    const res = run(['--dist', dist, ...COMMON, '--out', out, '--allow-missing', 'linux-x86_64']);
    eq(res.status, 0, res.stderr || res.stdout);
    const m = JSON.parse(fs.readFileSync(out, 'utf8'));
    ok(!m.platforms['linux-x86_64'], 'waived platform absent from manifest');
    eq(Object.keys(m.platforms).length, 4, 'four platforms emitted');
  }

  // 4. Missing sig → hard fail.
  {
    const dist = path.join(tmp, 'nosig');
    fs.mkdirSync(dist);
    fullDist(dist);
    fs.rmSync(path.join(dist, 'StarNet_0.2.0_x64-setup.exe.sig'));
    const res = run(['--dist', dist, ...COMMON, '--out', path.join(tmp, 'nosig-latest.json')]);
    eq(res.status, 1, 'artifact without sig should fail');
    ok(/without signature/i.test(res.stderr), 'no-sig message');
  }

  // 5. Duplicate platform match → hard fail.
  {
    const dist = path.join(tmp, 'dup');
    fs.mkdirSync(dist);
    fullDist(dist);
    // second AppImage in a subdir → two linux-x86_64 hits.
    writeArtifact(dist, path.join('extra', 'StarNet_0.2.0_amd64.AppImage'));
    const res = run(['--dist', dist, ...COMMON, '--out', path.join(tmp, 'dup-latest.json')]);
    eq(res.status, 1, 'duplicate match should fail');
    ok(/duplicate artifact for platform/i.test(res.stderr), 'duplicate message');
  }

  // 6. Empty sig → hard fail.
  {
    const dist = path.join(tmp, 'emptysig');
    fs.mkdirSync(dist);
    fullDist(dist);
    fs.writeFileSync(path.join(dist, 'StarNet_0.2.0_x64-setup.exe.sig'), '   \n');
    const res = run(['--dist', dist, ...COMMON, '--out', path.join(tmp, 'emptysig-latest.json')]);
    eq(res.status, 1, 'empty sig should fail');
    ok(/signature file is empty/i.test(res.stderr), 'empty-sig message');
  }

  // 7. Non-SemVer version → hard fail.
  {
    const dist = path.join(tmp, 'semver');
    fs.mkdirSync(dist);
    fullDist(dist);
    const res = run(['--dist', dist, '--version', '0.2', '--repo', 'a/b', '--tag', 'v0.2',
      '--pubkey', pubFile, '--out', path.join(tmp, 'semver-latest.json')]);
    eq(res.status, 1, 'non-semver should fail');
    ok(/SemVer/i.test(res.stderr), 'semver message');
  }
  // 8. Basename collision across platforms → hard fail (mac bundles not renamed per-arch:
  // both legs emit "StarNet.app.tar.gz", which is ONE flat release asset — one arch would
  // silently receive the other arch's binary).
  {
    const dist = path.join(tmp, 'collide');
    fs.mkdirSync(dist);
    writeArtifact(dist, 'StarNet_0.2.0_x64-setup.exe');
    writeArtifact(dist, path.join('macos', 'aarch64', 'StarNet.app.tar.gz'));
    writeArtifact(dist, path.join('macos', 'x86_64', 'StarNet.app.tar.gz'));
    writeArtifact(dist, 'StarNet_0.2.0_amd64.AppImage');
    writeArtifact(dist, 'StarNet_0.2.0_amd64.deb');
    const res = run(['--dist', dist, ...COMMON, '--out', path.join(tmp, 'collide-latest.json')]);
    eq(res.status, 1, 'same-basename mac bundles should fail');
    ok(/basename collision/i.test(res.stderr), 'collision message');
  }

  // 9. TAMPERED artifact (bytes changed after signing) → hard fail with the crypto message.
  // This is the exact "release passes shape checks, then bricks every user's update" hole.
  {
    const dist = path.join(tmp, 'tampered');
    fs.mkdirSync(dist);
    fullDist(dist);
    fs.appendFileSync(path.join(dist, 'StarNet_0.2.0_amd64.AppImage'), 'corruption');
    const res = run(['--dist', dist, ...COMMON, '--out', path.join(tmp, 'tampered-latest.json')]);
    eq(res.status, 1, 'tampered artifact should fail');
    ok(/SIGNATURE INVALID/.test(res.stderr), 'tamper message: ' + res.stderr);
    ok(/does not match the artifact/.test(res.stderr), 'names the mismatch');
  }

  // 10. Signed with the WRONG key (CI secret drift) → hard fail with key id mismatch.
  {
    const dist = path.join(tmp, 'wrongkey');
    fs.mkdirSync(dist);
    fullDist(dist);
    const other = makeSigner();
    const exe = path.join(dist, 'StarNet_0.2.0_x64-setup.exe');
    fs.writeFileSync(exe + '.sig', other.sign(fs.readFileSync(exe), { fileName: 'StarNet_0.2.0_x64-setup.exe' }).sigFileContent);
    const res = run(['--dist', dist, ...COMMON, '--out', path.join(tmp, 'wrongkey-latest.json')]);
    eq(res.status, 1, 'wrong-key signature should fail');
    ok(/key id mismatch/.test(res.stderr), 'wrong-key message: ' + res.stderr);
  }

  // 10b. --asset-base override (the local update canary's seam): urls re-root to the
  // given base, everything else — including crypto verification — is untouched.
  {
    const dist = path.join(tmp, 'assetbase');
    fs.mkdirSync(dist);
    fullDist(dist);
    const out = path.join(tmp, 'assetbase-latest.json');
    const res = run(['--dist', dist, ...COMMON, '--out', out, '--asset-base', 'http://127.0.0.1:8799']);
    eq(res.status, 0, res.stderr || res.stdout);
    const m = JSON.parse(fs.readFileSync(out, 'utf8'));
    eq(m.platforms['windows-x86_64'].url, 'http://127.0.0.1:8799/StarNet_0.2.0_x64-setup.exe',
      'asset-base re-roots the url (slash appended)');
    ok(/sig VERIFIED against baked pubkey/.test(res.stdout), 'crypto verification still runs under asset-base');
    const bad = run(['--dist', dist, ...COMMON, '--out', out, '--asset-base', 'ftp://nope']);
    eq(bad.status, 1, 'non-http asset-base fails');
    ok(/--asset-base must be an http/.test(bad.stderr), 'asset-base error message');
  }

  // 11. --skip-sig-verify (tests-only escape hatch) accepts bogus sigs but says so loudly.
  {
    const dist = path.join(tmp, 'skipverify');
    fs.mkdirSync(dist);
    writeArtifact(dist, 'StarNet_0.2.0_x64-setup.exe', 'SIG-WIN');
    writeArtifact(dist, path.join('macos', 'aarch64', 'StarNet_darwin-arm64.app.tar.gz'), 'SIG-MAC-ARM');
    writeArtifact(dist, path.join('macos', 'x86_64', 'StarNet_darwin-x64.app.tar.gz'), 'SIG-MAC-X64');
    writeArtifact(dist, 'StarNet_0.2.0_amd64.AppImage', 'SIG-LINUX');
    writeArtifact(dist, 'StarNet_0.2.0_amd64.deb', 'SIG-DEB');
    const out = path.join(tmp, 'skipverify-latest.json');
    const res = run(['--dist', dist, '--version', '0.2.0', '--repo', 'a/b', '--tag', 'v0.2.0',
      '--out', out, '--skip-sig-verify']);
    eq(res.status, 0, res.stderr || res.stdout);
    ok(/WARNING: --skip-sig-verify/.test(res.stdout), 'skip warning printed');
    ok(/NOT verified/.test(res.stdout), 'summary marks sigs unverified');
    const m = JSON.parse(fs.readFileSync(out, 'utf8'));
    eq(m.platforms['linux-x86_64-deb'].signature, 'SIG-DEB', 'literal sig passthrough');
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('release-assemble-manifest.test: OK (' + assertions + ' assertions)');
