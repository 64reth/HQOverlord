/* node test/terminal-tools.test.js — workbench registration and host-side safety/checkpoint wiring. */
'use strict';
const A = require('./_assert.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makeTerminalTools } = require('../sidecar/tools/builtin/terminal.js');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-terminal-tools-'));
  const workspace = path.join(root, 'a1'); fs.mkdirSync(workspace, { recursive: true });
  const calls = [];
  const manager = {
    start(o) { calls.push(['start', o]); return { ok: true, persisted: true, session: { sessionId: 'term_1', name: o.name, state: 'running', cols: o.cols || 120, rows: o.rows || 30, pid: 8, cwd: o.cwd, command: o.command } }; },
    status(agent, ref) {
      calls.push(['status', agent, ref]);
      if (ref) return { sessionId: 'term_1', name: 'repl', state: 'running', cols: 120, rows: 30, pid: 8, cwd: workspace, command: 'python -i' };
      return [];
    },
    read() { return { ok: true, output: 'ready', offset: 0, nextOffset: 5, endOffset: 5, truncatedStart: false, hasMore: false, session: { name: 'repl', state: 'running', cols: 120, rows: 30 } }; },
    write(agent, ref, o) { calls.push(['write', agent, ref, o]); return { ok: true, bytes: o.data.length + 1, session: { name: 'repl' } }; },
    resize() { return { ok: true, persisted: true, session: { name: 'repl', cols: 100, rows: 40 } }; },
    interrupt() { return { ok: true, sent: true, session: { name: 'repl' } }; },
    stop() { return { ok: true, requested: true, session: { name: 'repl' } }; },
    storeHealth() { return { loaded: 'ok', persisted: true, error: null }; }
  };
  const environment = {
    backendId: 'local', ensureWorkspace: () => workspace, getCwd: () => workspace
  };
  const family = makeTerminalTools({ manager, environment, fs, pathMod: path, root, platform: process.platform, envFor: () => ({ PATH: 'safe-path' }) });
  const names = family.tools.map(t => t.name);
  A.eq(names, ['terminal.start', 'terminal.status', 'terminal.read', 'terminal.write', 'terminal.resize', 'terminal.interrupt', 'terminal.stop'], 'complete terminal control surface is registered');
  A.ok(family.tools.every(t => t.capability === 'workbench'), 'every terminal tool is capability-gated by the existing Workbench object');
  A.ok(family.tools.find(t => t.name === 'terminal.start').requiresConsent, 'starting arbitrary terminal code requires consent');
  A.ok(family.tools.find(t => t.name === 'terminal.write').requiresConsent, 'terminal input requires consent because it can execute code');
  A.ok(!family.tools.find(t => t.name === 'terminal.read').requiresConsent, 'reading owned scrollback needs no new approval');

  let checkpoints = 0;
  const ctx = { agentId: 'a1', surface: 'interactive', checkpointMutation: async (cwd, label) => { checkpoints++; calls.push(['checkpoint', cwd, label]); } };
  const start = family.tools.find(t => t.name === 'terminal.start');
  const result = await start.run({ name: 'repl', command: 'python -i', cols: 100, rows: 40 }, ctx);
  A.ok(/Started as term_1/.test(result.content), 'start returns the real manager session identity');
  A.eq(checkpoints, 1, 'terminal start checkpoints before process creation');
  A.eq(calls.find(x => x[0] === 'start')[1].cwd, workspace, 'terminal starts in the agent-owned workspace');
  A.eq(calls.find(x => x[0] === 'start')[1].env, { PATH: 'safe-path' }, 'host-sanitized child environment is passed to PTY spawn');

  let refused = false;
  try { await start.run({ name: 'bad', command: 'explorer.exe .' }, ctx); } catch (e) { refused = /refused/.test(e.message); }
  A.ok(refused, 'visible-window commands are refused before PTY creation');
  A.eq(calls.filter(x => x[0] === 'start').length, 1, 'refused terminal command never reaches the manager');

  const write = family.tools.find(t => t.name === 'terminal.write');
  const wrote = await write.run({ session: 'repl', data: 'hello' }, ctx);
  A.ok(/Sent 6 byte/.test(wrote.content), 'terminal input reports manager-confirmed bytes');
  A.eq(checkpoints, 2, 'terminal input checkpoints before it can mutate workspace state');

  const read = family.tools.find(t => t.name === 'terminal.read').run({ session: 'repl' }, ctx);
  A.ok(/ready/.test(read.content) && /offset 0→5/.test(read.content), 'scrollback result carries output and continuation cursor');
  const interrupt = family.tools.find(t => t.name === 'terminal.interrupt').run({ session: 'repl' }, ctx);
  A.ok(/resulting state is not assumed/.test(interrupt.content), 'interrupt copy does not falsely claim the process stopped');
  const stop = family.tools.find(t => t.name === 'terminal.stop').run({ session: 'repl' }, ctx);
  A.ok(/awaiting its exit event/.test(stop.content), 'stop copy waits for observed exit truth');

  try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  A.report('terminal-tools');
})().catch(e => { console.error(e); process.exit(1); });
