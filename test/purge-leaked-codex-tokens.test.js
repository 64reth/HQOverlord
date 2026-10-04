/* node test/purge-leaked-codex-tokens.test.js — the remediation script DELETES CREDENTIALS, so its
   refusals are the part that needs a gate.

   scripts/purge-leaked-codex-tokens.mjs cleans up the copies the codex token migration made before it was
   fixed (2000+ copies of a live ChatGPT refresh token under %TEMP% on one machine). The dangerous failure is
   not "misses a copy" — it is "deletes the copy the user actually signed in with", which is
   [[secret-durability-escape]]: destroying the last copy. So these assertions pin, in order of severity:
   the install roots are never touched, only codex/tokens.json is ever considered, and nothing at all is
   deleted without --confirm. */
'use strict';
const A = require('./_assert.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'purge-leaked-codex-tokens.mjs');
const TOKENS = JSON.stringify({ access_token: 'A', refresh_token: 'R', auth_mode: 'chatgpt' });

function write(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body == null ? TOKENS : body);
  return file;
}
function run(args, env) {
  return execFileSync(process.execPath, [SCRIPT].concat(args), {
    encoding: 'utf8',
    env: Object.assign({}, process.env, env || {})
  });
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'purgetest-'));
// FAKE, deliberately distinct app-data bases, so the test mirrors normal Windows without depending on
// (or endangering) the real install. Tauri uses Roaming while the raw sidecar fallback uses Local.
const localBase = path.join(root, 'localappdata');
const appBase = path.join(root, 'appdata');
const xdgBase = path.join(root, 'xdg');
const configuredRoot = path.join(root, 'configured-workspaces');
const env = {
  LOCALAPPDATA: localBase,
  APPDATA: appBase,
  XDG_DATA_HOME: xdgBase,
  STARNET_WORKSPACES: configuredRoot,
  SKYNET_WORKSPACES: ''
};

// the signed-in copy — must SURVIVE
const installToken = write(path.join(appBase, 'ai.skynet.harness', 'workspaces', 'codex', 'tokens.json'));
const configuredToken = write(path.join(configuredRoot, 'codex', 'tokens.json'));
// leaked copies — must GO
const scratch = path.join(root, 'scratch');
const leaked1 = write(path.join(scratch, 'ws-a', 'codex', 'tokens.json'));
const leaked2 = write(path.join(scratch, 'deep', 'x', 'y', 'ws-b', 'codex', 'tokens.json'));
const leakedBak = write(path.join(scratch, 'ws-a', 'codex', 'tokens.json.bak'));
// bystanders — must be IGNORED entirely
const notCodex = write(path.join(scratch, 'other', 'tokens.json'));                 // right name, wrong folder
const notTokens = write(path.join(scratch, 'ws-c', 'codex', 'settings.json'), '{}'); // right folder, wrong name

// ---- 1. DRY RUN deletes nothing ----
{
  const out = run(['--root', scratch], env);
  A.ok(/DRY RUN/.test(out), 'the default run is a dry run');
  A.ok(fs.existsSync(leaked1) && fs.existsSync(leaked2), 'no file is deleted without --confirm');
  A.ok(/found\s+:\s*3\b/.test(out), 'it reports the 3 real leaked files (2 tokens.json + 1 .bak)');
}

// ---- 2. the install copy is never even a candidate ----
{
  const out = run(['--root', appBase], env);
  A.ok(/found\s+:\s*0\b/.test(out), 'scanning the INSTALL root itself finds nothing to purge');
  A.ok(fs.existsSync(installToken), 'the signed-in token is untouched — deleting it would be the opposite failure');
}

// ---- 3. --confirm removes the leaked copies and only those ----
{
  run(['--root', scratch, '--confirm'], env);
  A.ok(!fs.existsSync(leaked1), 'a leaked copy is deleted');
  A.ok(!fs.existsSync(leaked2), 'including one nested several directories deep');
  A.ok(!fs.existsSync(leakedBak), 'and its .bak, which carries the same credential');
  A.ok(fs.existsSync(notCodex), 'a tokens.json OUTSIDE a codex/ folder is not ours to judge — left alone');
  A.ok(fs.existsSync(notTokens), 'a non-token file inside codex/ is left alone');
  A.ok(fs.existsSync(installToken), 'and the install copy STILL survives a confirmed purge');
}

// ---- 4. an install root passed explicitly as a scan root is still refused ----
{
  // the belt-and-braces case: someone points --root at the parent of the real install and confirms.
  const out = run(['--root', root, '--confirm'], env);
  A.ok(fs.existsSync(installToken), 'even scanning a PARENT of the install root cannot delete the signed-in token');
  A.ok(fs.existsSync(configuredToken), 'an explicitly configured current workspace is protected too');
  A.ok(/protected \(kept\)/.test(out), 'and the protected roots are named in the output so the refusal is visible');
}

fs.rmSync(root, { recursive: true, force: true });
A.report('purge-leaked-codex-tokens');
