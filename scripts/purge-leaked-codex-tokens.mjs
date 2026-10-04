#!/usr/bin/env node
/*
 * purge-leaked-codex-tokens.mjs — remediation for the codex token-migration leak (P0, 2026-07-29).
 *
 * WHAT HAPPENED. sidecar/providers/codex-token-store.js migrated the user's ChatGPT OAuth tokens into
 * whatever workspace root the sidecar was pointed at, guarded only by "the destination has no token yet" —
 * which is true of every empty directory. Every test run, dev seed, and QA script that sets
 * SKYNET_WORKSPACES to a temp dir therefore received a copy of the LIVE access + refresh token. One machine
 * had 2063 of them under %TEMP%. The copier is fixed; the copies it already made are still on disk, and
 * this removes them.
 *
 * SAFETY. It only ever deletes files named exactly `tokens.json` (and its `.bak`) sitting in a directory
 * named exactly `codex`, and only under the scan roots given — which default to the OS temp dir. It
 * REFUSES to touch anything under the real install root (%LOCALAPPDATA%\StarNet\workspaces or wherever
 * defaultWorkspaces() resolves), because that is the copy the user actually signed in with: deleting it
 * would be [[secret-durability-escape]] — destroying the last copy — which is the opposite failure.
 *
 * Dry-run by default. Nothing is deleted without --confirm.
 *
 *   node scripts/purge-leaked-codex-tokens.mjs                  # report only
 *   node scripts/purge-leaked-codex-tokens.mjs --confirm        # delete
 *   node scripts/purge-leaked-codex-tokens.mjs --root D:\scratch --confirm
 *
 * ROTATE AFTERWARDS. Purging deletes the copies; it cannot un-expose a credential that sat readable in an
 * unencrypted directory. Sign out of ChatGPT everywhere and reconnect StarNet.
 */
import { readdirSync, statSync, rmSync, readFileSync } from 'node:fs';
import { join, basename, dirname, resolve, sep } from 'node:path';
import { tmpdir, homedir } from 'node:os';

const argv = process.argv.slice(2);
const CONFIRM = argv.includes('--confirm');
const MAX_DEPTH = 8;

const roots = [];
for (let i = 0; i < argv.length; i++) if (argv[i] === '--root' && argv[i + 1]) roots.push(resolve(argv[++i]));
if (!roots.length) roots.push(tmpdir());

// The install's own token — the one copy that must SURVIVE. Cover the desktop shell, raw sidecar,
// legacy app-data roots, and an explicitly configured current workspace.
function protectedRoots() {
  const bases = [
    process.env.LOCALAPPDATA,
    process.env.APPDATA,
    process.env.XDG_DATA_HOME
  ].filter(Boolean);
  if (!bases.length) bases.push(join(homedir() || '.', '.local', 'share'));

  const roots = [];
  for (const base of bases) {
    roots.push(
      join(base, 'StarNet', 'workspaces'),
      join(base, 'Skynet', 'workspaces'),
      join(base, 'ai.skynet.harness', 'workspaces')
    );
  }
  for (const configured of [process.env.STARNET_WORKSPACES, process.env.SKYNET_WORKSPACES]) {
    if (configured) roots.push(configured);
  }
  return Array.from(new Set(roots.map(p => resolve(p).toLowerCase())));
}
const PROTECTED = protectedRoots();
const isProtected = (file) => {
  const f = resolve(file).toLowerCase();
  return PROTECTED.some(p => f === p || f.startsWith(p + sep.toLowerCase()));
};

const found = [];
function walk(dir, depth) {
  if (depth > MAX_DEPTH) return;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of entries) {
    const p = join(dir, e.name);
    try {
      if (e.isDirectory()) { walk(p, depth + 1); continue; }
      if (!/^tokens\.json(\.bak)?$/.test(e.name)) continue;
      if (basename(dirname(p)) !== 'codex') continue;   // a tokens.json elsewhere is not ours to judge
      if (isProtected(p)) continue;                     // never the signed-in copy
      let live = false;
      try { const j = JSON.parse(readFileSync(p, 'utf8')); live = !!(j && (j.refresh_token || j.access_token)); } catch (_) {}
      found.push({ path: p, live, bytes: (() => { try { return statSync(p).size; } catch (_) { return 0; } })() });
    } catch (_) { /* unreadable entry — skip, never abort the sweep */ }
  }
}

for (const r of roots) walk(r, 0);

const live = found.filter(f => f.live).length;
console.log('scan roots      : ' + roots.join(', '));
console.log('protected (kept): ' + PROTECTED.join(', '));
console.log('found           : ' + found.length + ' codex token file(s), ' + live + ' carrying a live credential');

if (!found.length) { console.log('\nnothing to purge.'); process.exit(0); }
for (const f of found.slice(0, 10)) console.log('  · ' + f.path + (f.live ? '  [LIVE CREDENTIAL]' : ''));
if (found.length > 10) console.log('  … and ' + (found.length - 10) + ' more');

if (!CONFIRM) {
  console.log('\nDRY RUN — nothing deleted. Re-run with --confirm to delete these ' + found.length + ' file(s).');
  process.exit(0);
}

let removed = 0, failed = 0;
for (const f of found) {
  try { rmSync(f.path, { force: true }); removed++; } catch (_) { failed++; }
}
// Best-effort: drop the now-empty `codex` dirs so a later scan reads clean.
for (const d of new Set(found.map(f => dirname(f.path)))) {
  try { if (!readdirSync(d).length) rmSync(d, { recursive: true, force: true }); } catch (_) {}
}
console.log('\ndeleted: ' + removed + (failed ? ('  (failed: ' + failed + ' — likely in use or locked)') : ''));
console.log('NOW ROTATE: purging removes the copies, it cannot un-expose a credential that was readable on disk.');
console.log('Sign out of ChatGPT everywhere, then reconnect StarNet.');
