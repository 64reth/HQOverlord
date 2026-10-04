/* dev/onboard-fresh.js — boot a FRESH (un-onboarded) sidecar, for testing onboarding itself.

   dev/seed.js exists so you can skip the first-run ceremony; this is its inverse: an EMPTY workspace so
   you get the REAL first run — title screen, create screen, the wake ceremony, the interview — but with
   the API key held server-side from dev/.env.dev, so the live-mind awakening beats fire
   without ever pasting a key into the page. Fresh wipe each launch by default; --keep reuses the state.

   Dev-only, no secrets in this file. The scratch workspace lives under the repo root's gitignored
   .dev-workspaces-onboard/ (covered by the .dev-workspaces* ignore rule). */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
const ENV_DEV = path.join(__dirname, '.env.dev');
const SCRATCH = path.join(REPO, '.dev-workspaces-onboard');
const KEEP = process.argv.includes('--keep');

// same minimal .env parser as dev/seed.js: KEY=VALUE, # comments, shell env wins.
(function loadEnvDev() {
  if (!fs.existsSync(ENV_DEV)) return;
  for (const raw of fs.readFileSync(ENV_DEV, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'"))) v = v.slice(1, -1);
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
})();

if (!KEEP && fs.existsSync(SCRATCH)) fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });

const key = String(process.env.SKYNET_OPENROUTER_KEY || '').trim();
const port = String(process.env.SKYNET_PORT || process.env.PORT || '8991').trim();
if (!key) console.warn('[onboard-fresh] WARNING: no SKYNET_OPENROUTER_KEY in dev/.env.dev — the awakening will run all-scripted (quiet mind).');

const env = Object.assign({}, process.env, {
  SKYNET_WORKSPACES: SCRATCH,
  SKYNET_PORT: port
});
console.log('[onboard-fresh] FRESH first-run station: http://127.0.0.1:' + port
  + '  key ' + (key ? 'server-held' : 'NOT SET') + '  ws=' + SCRATCH + (KEEP ? ' [kept]' : ' [wiped]'));

const child = spawn(process.execPath, [path.join(REPO, 'sidecar', 'index.js')], { cwd: REPO, env, stdio: 'inherit' });
const fwd = sig => { try { child.kill(sig); } catch (_) {} };
process.on('SIGINT', () => fwd('SIGINT'));
process.on('SIGTERM', () => fwd('SIGTERM'));
child.on('exit', c => process.exit(c == null ? 0 : c));
