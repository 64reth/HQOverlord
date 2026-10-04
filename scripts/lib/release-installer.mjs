import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function findVersionedNsisInstaller(nsisDir, version) {
  const v = String(version || '').trim();
  if (!/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(v)) return '';
  const expected = join(nsisDir, 'StarNet_' + v + '_x64-setup.exe');
  try {
    return statSync(expected).isFile() ? expected : '';
  } catch (_) {
    return '';
  }
}

export function currentTauriVersion(root) {
  try {
    const conf = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8').replace(/^\uFEFF/, ''));
    return String((conf && conf.version) || '').trim();
  } catch (_) {
    return '';
  }
}

export function findCurrentNsisInstaller(root) {
  const version = currentTauriVersion(root);
  const nsisDir = join(root, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
  return findVersionedNsisInstaller(nsisDir, version);
}
