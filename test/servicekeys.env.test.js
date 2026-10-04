/* node test/servicekeys.env.test.js — the KEYS-tab → shell-child COMPOSITION (servicekeys.js × environment.js).

   WHY THIS FILE EXISTS (regression, 2026-07-24): servicekeys.test.js proved applyEnv against a FAKE env
   object and environment.test.js proved sanitizeChildEnv in isolation — both green, while the seam BETWEEN
   them was severed. sanitizeChildEnv strips every name matching _KEY/_TOKEN/_SECRET/…, and
   deriveEnvVar ALWAYS ends in _API_KEY, so 100% of KEYS-tab entries were scrubbed out of the shell child's
   environment while servicekeys.promptBlock still told the model "available to your shell commands as an
   environment variable — use it to call that service's API directly (curl etc.)". Every pasted key expanded
   to an empty string and the agent got a 401. A user hit this trying to connect Printify.

   The prompt PROMISES the variable is there. These tests are what make that promise true. */
'use strict';
const A = require('./_assert.js');
const OS = require('os');
const K = require('../sidecar/servicekeys.js');
const { makeEnvironmentManager, sanitizeChildEnv } = require('../sidecar/environment.js');

const RESERVED = new Set(['OPENROUTER_API_KEY']);   // stands in for the host's model-provider keyEnv set

// A local backend whose spawn is captured, so we assert on the REAL env a shell child would receive.
function harness(hostEnv, getKeys) {
  let captured = null;
  const child = { on() {}, kill() {}, stdout: { on() {} }, stderr: { on() {} } };
  // runProcess calls spawn(file, opts) when args is not an Array, spawn(file, args, opts) when it is.
  const spawn = (file, a, b) => { captured = (Array.isArray(a) ? b : a).env; return child; };
  const env = makeEnvironmentManager({
    spawn, fs: require('fs'), pathMod: require('path'), root: OS.tmpdir() + '/starnet-sk-env-test',
    env: hostEnv,
    // the sidecar edge wires the RUN's surface through (index.js): the backend forwards execute({surface}).
    serviceEnv: (surface) => K.runEnv(getKeys(), hostEnv, { reservedEnv: RESERVED, surface: surface })
  });
  return {
    shellEnv(surface) {
      captured = null;
      env.execute({ agentId: 'a', cmd: 'echo hi', surface: surface }).catch(() => {});
      return captured || {};
    }
  };
}

// ---- A. the scrub that caused the bug is still in force for everything else ----
{
  const out = sanitizeChildEnv({ PATH: 'p', SOME_API_KEY: 'v', A_TOKEN: 'v', B_SECRET: 'v', PLAIN: 'v' });
  A.eq(out.PATH, 'p', 'ordinary vars pass through');
  A.eq(out.PLAIN, 'v', 'non-secret-shaped vars pass through');
  A.ok(!('SOME_API_KEY' in out), 'sanitizeChildEnv still strips *_API_KEY by default');
  A.ok(!('A_TOKEN' in out), 'sanitizeChildEnv still strips *_TOKEN');
  A.ok(!('B_SECRET' in out), 'sanitizeChildEnv still strips *_SECRET');
}

// ---- B. runEnv is a pure selector over the host env ----
{
  const host = { PRINTIFY_API_KEY: 'tok', GONE_API_KEY: 'x' };
  const keys = [
    { id: 'printify', name: 'Printify', envVar: 'PRINTIFY_API_KEY', key: 'tok', enabled: true },
    { id: 'off', name: 'Off', envVar: 'OFF_API_KEY', key: 'y', enabled: false },
    { id: 'unset', name: 'Unset', envVar: 'UNSET_API_KEY', key: 'z', enabled: true }
  ];
  const out = K.runEnv(keys, host, { reservedEnv: RESERVED });
  A.eq(out.PRINTIFY_API_KEY, 'tok', 'enabled key present, value resolved from the host env');
  A.ok(!('OFF_API_KEY' in out), 'disabled key excluded');
  A.ok(!('UNSET_API_KEY' in out), 'a row whose var is absent from the host env is not invented');
  A.eq(Object.keys(host).length, 2, 'runEnv never mutates the host env');

  const reserved = K.runEnv(
    [{ id: 'o', name: 'O', envVar: 'OPENROUTER_API_KEY', key: 'k', enabled: true }],
    { OPENROUTER_API_KEY: 'BILLING' }, { reservedEnv: RESERVED });
  A.ok(!('OPENROUTER_API_KEY' in reserved), 'a reserved provider/billing var is never handed to a shell');
}

// ---- B2. THE UNATTENDED GRANT IS ENFORCED ON THE SHELL ROUTE TOO (bug-sweep P0) ----
// resolveForRequest refuses an ungranted key on a non-interactive surface; runEnv used to hand EVERY enabled
// key to an unattended shell child, so the same key was refused to web_request and given to curl in one run.
{
  const host = { GRANTED_API_KEY: 'g', UNGRANTED_API_KEY: 'u' };
  const keys = [
    { id: 'g', name: 'Granted', envVar: 'GRANTED_API_KEY', key: 'g', enabled: true, autonomous: true },
    { id: 'u', name: 'Ungranted', envVar: 'UNGRANTED_API_KEY', key: 'u', enabled: true }
  ];
  const inter = K.runEnv(keys, host, { reservedEnv: RESERVED, surface: 'interactive' });
  A.eq(inter.GRANTED_API_KEY, 'g', 'a watched run still gets a granted key');
  A.eq(inter.UNGRANTED_API_KEY, 'u', 'a watched run still gets an ungranted key — the grant is about UNATTENDED use');

  const auto = K.runEnv(keys, host, { reservedEnv: RESERVED, surface: 'autonomous' });
  A.eq(auto.GRANTED_API_KEY, 'g', 'an unattended run gets the key the Commander granted for unattended use');
  A.ok(!('UNGRANTED_API_KEY' in auto), 'an unattended run NEVER receives a key without the unattended grant');
  // the same rule the request route already enforced — one key, one answer, both routes
  A.eq(K.resolveForRequest(keys, 'UNGRANTED_API_KEY', 'autonomous').reason, 'unattended',
    'web_request refuses the same key on the same surface (the two routes now agree)');

  A.eq(K.runEnv(keys, host, { reservedEnv: RESERVED }).UNGRANTED_API_KEY, 'u',
    'an un-wired caller (no surface) behaves exactly as before');

  const watchedOnly = [{
    id: 'etsy', name: 'Etsy', envVar: 'ETSY_API_KEY', key: 'e', enabled: true,
    autonomous: true, unattendedSupported: false
  }];
  A.ok(!('ETSY_API_KEY' in K.runEnv(watchedOnly, { ETSY_API_KEY: 'e' }, { surface: 'autonomous' })),
    'watched-only policy overrides a stale autonomous=true record on the shell route');

  // and through the REAL composition: the surface travels execute() -> backend -> serviceEnv hook
  const h = harness(host, () => keys);
  const shellAuto = h.shellEnv('autonomous');
  A.eq(shellAuto.GRANTED_API_KEY, 'g', 'the granted key still reaches an unattended shell child');
  A.ok(!('UNGRANTED_API_KEY' in shellAuto), 'THE FIX: an unattended shell child no longer receives an ungranted key');
  A.eq(h.shellEnv('interactive').UNGRANTED_API_KEY, 'u', 'a watched shell child is unchanged');
}

// ---- C. THE REGRESSION: a pasted key actually reaches the shell child ----
{
  const host = { PATH: 'p', OPENROUTER_API_KEY: 'BILLING-SECRET' };
  let keys = [];
  let owned = {};
  const apply = () => { owned = K.applyEnv(keys, host, owned, { reservedEnv: RESERVED }); };
  const h = harness(host, () => keys);

  A.ok(!('PRINTIFY_API_KEY' in h.shellEnv()), 'no key pasted -> var absent');

  keys = K.upsert(keys, { name: 'Printify', key: 'tok-123' }, 1, { reservedEnv: RESERVED }).list;
  apply();
  const withKey = h.shellEnv();
  A.eq(withKey.PRINTIFY_API_KEY, 'tok-123',
    'a KEYS-tab paste REACHES the shell child (the promptBlock promise) — and with NO sidecar restart, ' +
    'so the boot-time childEnv snapshot is not the source of truth');

  // the general scrub must still hold for everything the Commander did NOT paste
  A.ok(!('OPENROUTER_API_KEY' in withKey), 'a model-provider/billing key still never reaches a shell child');
  A.eq(withKey.PATH, 'p', 'ordinary inherited vars survive the merge');

  // host authority is not overridable by a pasted row
  A.eq(withKey.STARNET_USER_CONTROL_MODE, 'preserve', 'reserved safety pin intact after the merge');
  A.eq(withKey.STARNET_COMPUTER_DRIVER, '0', 'computer-driver pin intact after the merge');

  keys = K.setEnabled(keys, 'printify', false, 2).list;
  apply();
  A.ok(!('PRINTIFY_API_KEY' in h.shellEnv()), 'disabling a key removes it from the very next run');

  keys = K.setEnabled(keys, 'printify', true, 3).list;
  apply();
  keys = K.remove(keys, 'printify').list;
  apply();
  A.ok(!('PRINTIFY_API_KEY' in h.shellEnv()), 'removing a key removes it from the very next run');
}

// ---- D. a pasted row can never smuggle in host authority or an execution hook ----
{
  const host = { PATH: 'p' };
  // hand the merge a hostile map directly — runEnv's reserved filter is one guard, mergeServiceEnv is the other.
  const hostile = {
    STARNET_COMPUTER_DRIVER: '1',        // would re-enable physical input
    STARNET_MCP_STDIO: '1',              // would re-enable unsandboxed local MCP children
    NODE_OPTIONS: '--require=/tmp/evil',  // would hijack every node child
    COMSPEC: 'C:\\evil.exe',
    GOOD_API_KEY: 'ok'
  };
  const h = harness(host, () => []);
  const { mergeServiceEnv } = makeEnvironmentManager({
    spawn: () => ({ on() {}, kill() {}, stdout: { on() {} }, stderr: { on() {} } }),
    fs: require('fs'), pathMod: require('path'), root: OS.tmpdir() + '/starnet-sk-env-test', env: host
  })._internals;

  const merged = mergeServiceEnv(sanitizeChildEnv(host), hostile);
  A.eq(merged.STARNET_COMPUTER_DRIVER, '0', 'a pasted var cannot re-enable the computer driver');
  A.eq(merged.STARNET_MCP_STDIO, '0', 'a pasted var cannot re-enable local MCP children');
  A.ok(!('NODE_OPTIONS' in merged), 'a pasted var cannot set an execution hook');
  A.ok(!merged.COMSPEC || !/evil/i.test(merged.COMSPEC), 'a pasted var cannot repoint COMSPEC');
  A.eq(merged.GOOD_API_KEY, 'ok', 'an ordinary service var still merges');
  A.ok(h, 'harness constructed');
}

// ---- E. the DOCKER backend gets the same keys, without ever putting one on the command line ----
async function dockerKeyCase() {
  const host = { PATH: 'p', OPENROUTER_API_KEY: 'BILLING-SECRET' };
  let keys = K.upsert([], { name: 'Printify', key: 'docker-secret-xyz' }, 1, { reservedEnv: RESERVED }).list;
  // runEnv RESOLVES values out of the host env (that is what preserves applyEnv's ambient-wins rule), so the
  // host must be populated first — exactly as the sidecar does on every save via applyServiceKeysEnv().
  let owned = K.applyEnv(keys, host, {}, { reservedEnv: RESERVED });
  const calls = [];
  const spawn = (file, a, b) => {
    const EventEmitter = require('events').EventEmitter;
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
    const call = { file, args: Array.isArray(a) ? a : null, opts: Array.isArray(a) ? b : a };
    calls.push(call);
    setImmediate(() => {
      let out = 'ok\n', code = 0;
      if (call.args && call.args[0] === 'inspect') code = 1;
      if (call.args && call.args[0] === 'exec' && call.args[call.args.length - 1].indexOf('starnet-ready') >= 0) out = 'starnet-ready';
      child.stdout.emit('data', Buffer.from(out)); child.emit('close', code);
    });
    return child;
  };
  const env = makeEnvironmentManager({
    spawn, fs: require('fs'), pathMod: require('path'), root: OS.tmpdir() + '/starnet-sk-docker-test',
    env: host, config: { backend: 'docker' },
    serviceEnv: () => K.runEnv(keys, host, { reservedEnv: RESERVED })
  });
  A.eq(env.backendId, 'docker', 'the docker backend is under test');

  await env.execute({ agentId: 'a', cmd: 'echo hi' });
  let captured = calls.find(c => c.args && c.args[0] === 'exec' && c.args[c.args.length - 1] === 'echo hi');
  const argv = (captured.args || []).join(' ');
  // `-e NAME` (no =value) tells docker to forward the variable from its OWN env. This is the whole point:
  // the name is safe in a `ps` listing, the value never touches argv or a temp file on disk.
  A.ok(/-e PRINTIFY_API_KEY/.test(argv), 'the container is told to inherit the key BY NAME');
  A.ok(argv.indexOf('docker-secret-xyz') < 0, 'THE CORE PROPERTY: the secret is NEVER on the docker argv');
  A.eq(captured.opts.env.PRINTIFY_API_KEY, 'docker-secret-xyz', 'the value rides the docker client env instead');
  A.ok(!('OPENROUTER_API_KEY' in captured.opts.env), 'a provider/billing key still never reaches a container');
  A.eq(captured.opts.env.STARNET_USER_CONTROL_MODE, 'preserve', 'host safety pins survive the merge');

  // revoked -> gone on the very next call, and with no keys the argv gains no -e flags at all
  keys = K.setEnabled(keys, 'printify', false).list;
  owned = K.applyEnv(keys, host, owned, { reservedEnv: RESERVED });   // scrubs the var it owns, as the sidecar does
  await env.execute({ agentId: 'a', cmd: 'echo hi' });
  captured = calls.filter(c => c.args && c.args[0] === 'exec' && c.args[c.args.length - 1] === 'echo hi').pop();
  A.ok((captured.args || []).join(' ').indexOf('-e PRINTIFY_API_KEY') < 0, 'disabling removes it from the next container');
}

// report() LAST — it is what calls process.exit(fail?1:0); a file ending in a bare console.log prints FAIL
// and still exits 0. test/lint-gate-can-fail.js now enforces this across every gate step.
dockerKeyCase().then(() => A.report('servicekeys.env.test.js')).catch((e) => {
  console.log('FAIL: servicekeys docker case threw - ' + (e && e.stack || e));
  process.exit(1);
});
