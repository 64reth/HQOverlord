/* node test/desktop.test.js - desktop.open contract:
   url/app classification, URL safety reuse (private/loopback refused),
   app-name allowlist, consent/execute posture, capability projection under
   the web/dish object, and no-shell-injection in the opener argv. */
'use strict';
const A = require('./_assert.js');
const { makeRegistry } = require('../sidecar/tools/registry.js');
const { resolveTools } = require('../sidecar/capability/resolve.js');
const { makeCapCtx } = require('../sidecar/capability/capGate.js');
const { makeDesktopTools, _internals: T } = require('../sidecar/tools/builtin/desktop.js');

const call = (name, args) => ({ id: 'c_' + name, name, args: args || {}, argsRaw: JSON.stringify(args || {}), parseError: null });
async function rejects(p, re, msg) {
  try { await p; A.ok(false, msg + ' - did not reject'); }
  catch (e) { A.ok(re.test((e && e.message) || String(e)), msg); }
}
function fakeOpener() {
  const log = [];
  return { log, open: async ({ kind, target }) => { log.push({ kind, target }); return 'launched'; } };
}

(async () => {
  // classification
  A.eq(T.classify('https://youtube.com').kind, 'url', 'full https URL -> url');
  A.eq(T.classify('youtube.com').target, 'https://youtube.com', 'bare host -> https:// prefixed url');
  A.eq(T.classify('www.youtube.com/watch?v=x').kind, 'url', 'bare host with path -> url');
  A.eq(T.classify('notepad').kind, 'app', 'bare token -> app');
  A.eq(T.classify('  notepad  ').target, 'notepad', 'app name trimmed');

  // opener + tool posture
  const opener = fakeOpener();
  const D = makeDesktopTools({ opener: opener.open, allowRemoteDesktop: true });
  const tool = D.tools[0];
  const REMOTE_OWNER = { surface: 'interactive', ownerTrusted: true, remoteDesktopAuthorized: true, inputMode: 'remote-owner' };
  A.eq(tool.name, 'desktop.open', 'tool is desktop.open');
  A.eq(tool.scope, 'execute', 'desktop.open is execute scoped');
  A.eq(tool.requiresConsent, true, 'desktop.open requires consent');
  A.ok(/real screen|user/i.test(tool.description) && /visible/i.test(tool.description), 'description promises a visible window on the user screen');

  await rejects(tool.run({ target: 'youtube.com' }), /remote-owner desktop lease/i, 'direct calls without the remote-owner lease stay denied');
  A.eq(opener.log.length, 0, 'inert tool never reaches the opener');

  const leased = await tool.run({ target: 'youtube.com' }, REMOTE_OWNER);
  A.ok(/desktop\.open ok/.test(leased.content), 'paired owner lease may launch a visible desktop target');
  A.eq(opener.log.length, 1, 'leased remote desktop call reaches the opener');

  const out = await D._internals.open('youtube.com');
  A.eq(out.target, 'https://youtube.com/', 'internal user-click helper normalizes a bare host');
  A.eq(opener.log[1].kind, 'url', 'opener received a url kind');
  A.eq(opener.log[1].target, 'https://youtube.com/', 'opener received the assertSafeUrl-normalized href');

  const appOut = await D._internals.open('notepad');
  A.eq(appOut.target, 'notepad', 'internal user-click helper preserves the app name');
  A.eq(opener.log[2].kind, 'app', 'opener received an app kind');

  // URL safety is reused from browser.js — private/loopback/intranet refused
  await rejects(D._internals.open('http://localhost:8787'), /private|loopback|intranet/i, 'localhost URL refused');
  await rejects(D._internals.open('127.0.0.1'), /private|loopback|intranet|not a valid/i, 'loopback IP refused');
  await rejects(D._internals.open('http://192.168.1.5/admin'), /private|loopback|intranet/i, 'LAN IP refused');
  await rejects(D._internals.open('file:///etc/passwd'), /http\(s\)|not a valid/i, 'non-http scheme refused');
  A.eq(opener.log.length, 3, 'refused targets never reach the opener');

  // app-name allowlist rejects paths / args / shell metacharacters
  await rejects(D._internals.open('notepad.exe & calc'), /not a valid/i, 'app name with shell metachar refused');
  await rejects(D._internals.open('C:/Windows/System32/cmd.exe'), /http\(s\)|not a valid/i, 'app path refused (parsed as c: scheme, not http(s))');
  await rejects(D._internals.open('cmd /c rd /s /q C:'), /not a valid/i, 'command line refused');

  // the shell opener passes target as a discrete argv token, never a shell string
  {
    const seen = [];
    const spawnSync = (cmd, args) => { seen.push({ cmd, args }); return { status: 0, stdout: '', stderr: '' }; };
    const win = T.makeShellOpener({ spawnSync, platform: 'win32', timeoutMs: 1000 });
    await win({ kind: 'url', target: 'https://example.com/' });
    A.ok(/powershell/i.test(seen[0].cmd), 'win32 opener shells to powershell');
    A.ok(seen[0].args.indexOf('-NonInteractive') >= 0, 'win32 opener runs non-interactive');
    A.ok(seen[0].args.some(x => /Start-Process -FilePath 'https:\/\/example\.com\/'/.test(x)), 'target is a quoted literal, not concatenated into a shell command');

    const mac = T.makeShellOpener({ spawnSync, platform: 'darwin' });
    await mac({ kind: 'app', target: 'Safari' });
    A.eq(seen[1].cmd, 'open', 'mac opener uses open');
    A.eq(seen[1].args.join(' '), '-a Safari', 'mac app open uses -a with app as its own arg');

    const lin = T.makeShellOpener({ spawnSync, platform: 'linux' });
    await lin({ kind: 'url', target: 'https://example.com/' });
    A.eq(seen[2].cmd, 'xdg-open', 'linux opener uses xdg-open');
    A.eq(seen[2].args[0], 'https://example.com/', 'linux url is its own arg');

    // the opener is ASYNC now (execFile, off event loop): it returns a Promise, and a non-zero exit from the
    // injected spawnSync adapter still rejects with the stderr message shape (no longer a synchronous throw).
    const failing = () => ({ status: 1, stdout: '', stderr: 'boom' });
    const bad = T.makeShellOpener({ spawnSync: failing, platform: 'linux' });
    const p = bad({ kind: 'url', target: 'https://example.com/' });
    A.ok(p && typeof p.then === 'function', 'the opener returns a Promise (async, off the event loop)');
    await rejects(p, /boom/, 'a non-zero exit rejects async with the stderr message');
  }

  // capability projection: desktop.open is absent even with a dish; the implementation is
  // retained only behind a future separate attended host channel.
  {
    const reg = makeRegistry();
    makeDesktopTools({ opener: fakeOpener().open }).register(reg);
    const withDish = resolveTools('ag', {
      agents: { ag: { id: 'ag', room: 'r' } },
      rooms: { r: { id: 'r', objects: [{ objectType: 'dish' }] } }
    });
    A.eq(withDish.tools.indexOf('desktop.open'), -1, 'ordinary dish capability never advertises a real-screen opener');
    A.eq(withDish.approvalRules['desktop.open'], undefined, 'ordinary resolver has no real-screen approval rule');

    const noDish = resolveTools('ag', {
      agents: { ag: { id: 'ag', room: 'r' } },
      rooms: { r: { id: 'r', objects: [] } }
    });
    const denied = await reg.dispatch(call('desktop.open', { target: 'youtube.com' }), makeCapCtx(noDish));
    A.eq(denied.summary, 'user-control-denied', 'desktop.open fails closed even when no run authority was attached');
  }

  A.report('desktop.test');
})();
