'use strict';
// autonomy-write.test.js — autonomy B2. Exercises the EXACT write mechanism the /api/autonomy/write handler uses
// (a one-off registry + fs tools + the REAL consent broker on the autonomous surface), proving the security comes
// from REUSE: no grant → default-deny; granted cabinet:write → write lands in the jail; .env/.git blocked by the
// hardline floor even WITH the grant; a path escape is jailed. Deterministic (real fs in an isolated temp dir).
const assert = require('assert');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { makeRegistry } = require('../sidecar/tools/registry.js');
const { makeFsTools } = require('../sidecar/tools/builtin/fs.js');
const { makeConsentBroker } = require('../sidecar/permissions.js');

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// the SAME hardline floor index.js wires (blocks .env/.git at any depth) — replicated so the test proves the
// handler's broker construction denies them even under a grant. (Kept in lock-step with sidecar/index.js hardlineFloor.)
function hardlineFloor(call) {
  const p = call && call.args && call.args.path;
  if (typeof p === 'string' && (/(^|[\\/])\.env(\.|$)/i.test(p) || /(^|[\\/])\.git([\\/]|$)/i.test(p))) return 'protected-file floor';
  return null;
}

// Per-process root — a fixed name lets two concurrent gate runs rm -rf each other's fixtures.
const ROOT = path.join(os.tmpdir(), 'starnet-b2-write-test-' + process.pid);
try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (_) {}
fs.mkdirSync(ROOT, { recursive: true });

// build the mechanism EXACTLY as handleAutonomyWrite does, then dispatch one fs.write.
async function write(grants, rel, content) {
  const reg = makeRegistry();
  makeFsTools({ fsp, pathMod: path, root: ROOT, limits: { writeBytes: 1 << 20 } }).register(reg);
  const consent = makeConsentBroker({ bypass: false, hardline: hardlineFloor, sessionKey: 'k', grantsPermanent: new Set(grants || []), surface: 'autonomous' });
  return reg.dispatch({ name: 'fs.write', args: { path: rel, content: content }, id: '1' }, { agentId: 'agent', consent: consent, emit() {}, timeoutMs: 10000 });
}
const ws = (...p) => path.join(ROOT, 'agent', ...p);

(async () => {
  // 1. NO grant → autonomous default-deny ("silence is not consent")
  let r = await write([], 'drafts/x.md', 'hi');
  ok(r && !r.ok && r.summary === 'denied', 'no cabinet:write grant → autonomous write default-denied');
  ok(!fs.existsSync(ws('drafts', 'x.md')), 'a denied write leaves NO file');

  // 2. granted → write succeeds, file lands INSIDE the agent jail with exact content
  r = await write(['cabinet:write'], 'drafts/x.md', '# T\n\nbody\n');
  ok(r && r.ok, 'granted cabinet:write → autonomous write allowed (cache tier)');
  ok(fs.existsSync(ws('drafts', 'x.md')) && fs.readFileSync(ws('drafts', 'x.md'), 'utf8') === '# T\n\nbody\n', 'file written verbatim inside <root>/agent/drafts/');

  // 3. hardline .env blocked even WITH the grant
  r = await write(['cabinet:write'], '.env', 'SECRET=1');
  ok(r && !r.ok, '.env write blocked by the hardline floor even with the grant');
  ok(!fs.existsSync(ws('.env')), 'no .env written');

  // 4. .git blocked even with the grant
  r = await write(['cabinet:write'], '.git/config', 'x');
  ok(r && !r.ok, '.git write blocked by the hardline floor');

  // 5. path escape is jailed (resolveInside throws → isError, never escapes)
  r = await write(['cabinet:write'], '../escape.md', 'x');
  ok(r && !r.ok, 'a ".." path escape is jailed');
  ok(!fs.existsSync(path.join(ROOT, 'escape.md')), 'nothing escaped the workspace root');

  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (_) {}
  console.log('autonomy-write.test.js OK —', n, 'assertions');
})().catch(e => { console.error(e); process.exit(1); });
