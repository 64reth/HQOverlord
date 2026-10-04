'use strict';
/* Lane C — a requested sandbox is honored or refused, never faked.
   shell.exec / verify.run dispatched under a router that cannot honor SAFE CELL return a tool_precondition
   and spawn NOTHING; terminal.start refuses any non-local effective backend with the same framing. */
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { makeClock } = require('../shared/clock-rng.js');
const { makeRegistry } = require('../sidecar/tools/registry.js');
const { makeShellTool } = require('../sidecar/tools/builtin/shell.js');
const { makeVerifyTool } = require('../sidecar/tools/builtin/verify.js');
const { makeTerminalTools } = require('../sidecar/tools/builtin/terminal.js');
const { makeExecutionRouter } = require('../sidecar/execution-router.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-sandbox-'));
const ws = path.join(root, 'a1'); fs.mkdirSync(ws, { recursive: true });
let spawned = 0;
const spawnSpy = function () { spawned++; throw new Error('spawn must not be reached'); };
const local = {
  id: 'local', backendId: 'local', supports: { shell: true },
  describe: () => ({ backend: 'local', availability: { state: 'ready' } }),
  ensureWorkspace: () => ws, getCwd: () => ws, rememberCwd: () => {}, workspaceRoot: () => ws,
  execute: () => { spawned++; return Promise.resolve({ out: '', exitCode: 0 }); },
  startBackground: () => { spawned++; return { ok: true, bgId: 'bg_x' }; }
};
const profiles = { a1: 'safe-cell', r1: 'remote-ssh', t1: 'trusted-project' };
const router = makeExecutionRouter({ environments: { local }, defaultBackendId: 'local', profileForAgent: id => profiles[id] || 'station-gear', env: {} });

(async () => {
  const reg = makeRegistry();
  makeShellTool({ spawn: spawnSpy, fs, pathMod: path, root, clock: makeClock(0), redact: s => s, environment: router }).register(reg);
  makeVerifyTool({ spawn: spawnSpy, fs, pathMod: path, root, clock: makeClock(0), environment: router }).register(reg);
  const consent = async () => ({ allow: true });
  const ctx = (agentId) => ({ agentId, emit() {}, timeoutMs: 10000, consent, checkpointMutation: async () => { throw new Error('checkpoint must not run before the refusal'); } });

  let r = await reg.dispatch({ name: 'shell.exec', args: { cmd: 'echo hi' }, id: '1' }, ctx('a1'));
  A.ok(r && !r.ok && r.isError, 'shell.exec under an unhonorable SAFE CELL is an error result');
  A.eq(r.summary, 'precondition', 'it is framed as a precondition, not a generic failure');
  A.ok(/<tool_precondition>.*sandbox_unavailable/.test(r.content), 'content carries the sandbox_unavailable precondition frame');
  A.ok(/SAFE CELL/.test(r.content) && /Docker is not available/.test(r.content) && /Start Docker, or change the agent's execution profile/.test(r.content), 'copy names the profile, the reason, and the fix');
  A.eq(r.precondition && r.precondition.code, 'sandbox_unavailable', 'structured precondition rides the result');
  A.eq(spawned, 0, 'NOTHING was spawned on the host');

  r = await reg.dispatch({ name: 'shell.exec', args: { cmd: 'sleep 5', background: true }, id: '2' }, ctx('a1'));
  A.eq(r.summary, 'precondition', 'background shell.exec refuses the same way');
  A.eq(spawned, 0, 'still no spawn');

  r = await reg.dispatch({ name: 'verify.run', args: { cmd: 'npm test' }, id: '3' }, ctx('a1'));
  A.eq(r.summary, 'precondition', 'verify.run refuses with a precondition');
  A.ok(/sandbox_unavailable/.test(r.content), 'verify.run names sandbox_unavailable');
  A.eq(spawned, 0, 'verify.run spawned nothing');

  r = await reg.dispatch({ name: 'shell.exec', args: { cmd: 'echo hi' }, id: '4' }, ctx('r1'));
  A.ok(/REMOTE SSH/.test(r.content) && /sandbox_unavailable/.test(r.content), 'remote-ssh without ssh refuses too');

  const tctx = Object.assign(ctx('t1'), { checkpointMutation: async () => {} });
  r = await reg.dispatch({ name: 'shell.exec', args: { cmd: 'echo hi' }, id: '5' }, tctx);
  A.ok(r.ok, 'trusted-project still executes: ' + (r.content || '').slice(0, 80));
  A.eq(spawned, 1, 'trusted-project reached the local backend');

  // terminal.start: PTY lives on the host — any non-local effective backend is refused honestly.
  const calls = [];
  const manager = { start(o) { calls.push(o); return { ok: true, persisted: true, session: { sessionId: 'term_1', name: o.name, state: 'running', pid: 1, cols: 120, rows: 30, cwd: ws } }; } };
  const docker = Object.assign({}, local, { id: 'docker', backendId: 'docker', describe: () => ({ backend: 'docker', availability: { state: 'ready' } }) });
  const withDocker = makeExecutionRouter({ environments: { local, docker }, defaultBackendId: 'local', profileForAgent: id => profiles[id] || 'station-gear', env: {} });
  const fam = makeTerminalTools({ manager, environment: withDocker, fs, pathMod: path, root, platform: process.platform, envFor: () => ({}) });
  const start = fam.tools.find(t => t.name === 'terminal.start');
  let err = null;
  try { await start.run({ name: 'repl', command: 'python -i' }, { agentId: 'a1', checkpointMutation: async () => {} }); } catch (e) { err = e; }
  A.ok(err && /interactive terminals run on the host; this agent is sandboxed/.test(err.message), 'terminal.start refuses a sandboxed agent with the honest copy');
  A.eq(err.precondition && err.precondition.code, 'terminal_requires_local_backend', 'terminal refusal is a typed precondition');
  A.eq(calls.length, 0, 'no PTY was spawned');
  const fam2 = makeTerminalTools({ manager, environment: router, fs, pathMod: path, root, platform: process.platform, envFor: () => ({}) });
  err = null;
  try { await fam2.tools.find(t => t.name === 'terminal.start').run({ name: 'repl', command: 'python -i' }, { agentId: 'a1', checkpointMutation: async () => {} }); } catch (e) { err = e; }
  A.eq(err && err.code, 'sandbox_unavailable', 'terminal.start under an unhonorable sandbox refuses with sandbox_unavailable (never escapes to the host)');
  A.eq(calls.length, 0, 'still no PTY');
  const ok = await fam2.tools.find(t => t.name === 'terminal.start').run({ name: 'repl', command: 'python -i' }, { agentId: 't1', checkpointMutation: async () => {} });
  A.ok(/term_1/.test(ok.content), 'trusted-project terminal still starts');
  A.report('sandbox-no-silent-fallback.test');
})().catch(e => { console.error(e); process.exitCode = 1; });
