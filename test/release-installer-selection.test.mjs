import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  currentTauriVersion,
  findCurrentNsisInstaller,
  findVersionedNsisInstaller,
} from '../scripts/lib/release-installer.mjs';

const root = mkdtempSync(join(tmpdir(), 'starnet-release-installer-'));
try {
  const nsis = join(root, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
  mkdirSync(nsis, { recursive: true });
  mkdirSync(join(root, 'src-tauri'), { recursive: true });
  writeFileSync(join(root, 'src-tauri', 'tauri.conf.json'), JSON.stringify({ version: '0.10.5' }));

  const stale = join(nsis, 'StarNet_0.8.0_x64-setup.exe');
  const exact = join(nsis, 'StarNet_0.10.5_x64-setup.exe');
  writeFileSync(stale, 'stale');
  writeFileSync(exact, 'exact');

  assert.equal(findVersionedNsisInstaller(nsis, '0.10.5'), exact,
    'the exact current version wins even when a stale filename sorts later');
  assert.equal(findVersionedNsisInstaller(nsis, '0.10.6'), '',
    'a missing exact version fails closed instead of falling back');
  assert.equal(findVersionedNsisInstaller(nsis, '../0.10.5'), '',
    'version input cannot escape the NSIS directory');
  assert.equal(currentTauriVersion(root), '0.10.5', 'the helper reads the canonical Tauri version pin');
  assert.equal(findCurrentNsisInstaller(root), exact, 'the release gates bind discovery to the canonical current version');
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('release-installer-selection.test: OK (5 assertions)');
