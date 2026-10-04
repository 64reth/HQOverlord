/* node test/terminal-sessions.test.js — owned PTY lifecycle, I/O, bounded output, and restart truth. */
'use strict';
const A = require('./_assert.js');
const { makeTerminalSessions, _internals } = require('../sidecar/terminal-sessions.js');

function fakePty() {
  const api = { children: [] };
  api.spawn = function (file, args, opts) {
    let onData = null, onExit = null;
    const child = {
      pid: 4100 + api.children.length, file, args, opts, writes: [], sizes: [], killed: false,
      onData(fn) { onData = fn; }, onExit(fn) { onExit = fn; },
      write(s) { this.writes.push(String(s)); }, resize(c, r) { this.sizes.push([c, r]); }, kill() { this.killed = true; },
      emitData(s) { if (onData) onData(s); }, emitExit(exitCode, signal) { if (onExit) onExit({ exitCode, signal }); }
    };
    api.children.push(child); return child;
  };
  return api;
}

let t = 1000, seq = 0, saved = null, spilled = '';
const pty = fakePty();
const ledger = { rows: [], released: [], record(r) { this.rows.push(r); }, release(pid) { this.released.push(pid); }, pinIdentity() {} };
const manager = makeTerminalSessions({
  pty, platform: 'win32', clock: { now: () => t }, newId: () => 'id' + (++seq),
  load: () => ({ status: 'absent', value: null }), save: v => { saved = JSON.parse(JSON.stringify(v)); },
  redact: s => String(s).replace(/secret/g, '[redacted]'), ledger, ringChars: 4096,
  spill: e => { spilled += e.text; return { path: '.output/terminal-' + e.id + '.txt', bytes: Buffer.byteLength(spilled) }; }
});

A.ok(manager.available(), 'node-pty-shaped adapter makes terminals available');
const started = manager.start({ agentId: 'a1', name: 'repl', command: 'python -i secret', cwd: 'C:\\work', cols: 90, rows: 25, env: { ComSpec: 'cmd.exe' } });
A.ok(started.ok && started.persisted, 'start returns only after durable metadata write succeeds');
A.eq(started.session.state, 'running', 'new PTY is truthfully running and attached');
A.eq(started.session.name, 'repl', 'human session name is retained');
A.eq(started.session.command, 'python -i [redacted]', 'persisted/status command is redacted');
A.eq(pty.children[0].file, 'cmd.exe', 'Windows uses the configured command shell for ConPTY');
A.eq(pty.children[0].args, ['/d', '/s', '/c', 'python -i secret'], 'raw command reaches only the live spawn, not durable metadata');
A.eq(pty.children[0].opts.useConpty, true, 'Windows PTY explicitly requests ConPTY');
A.eq(ledger.rows[0].kind, 'terminal.pty', 'process is recorded in the shared orphan ledger');
A.ok(saved.sessions[0].command.indexOf('secret') < 0, 'durable terminal metadata never writes the redacted secret');

A.ok(!manager.status('a2', 'repl'), 'another agent cannot inspect a terminal it does not own');
A.ok(!manager.write('a2', 'repl', { data: 'x' }).ok, 'another agent cannot write to it');
A.ok(!manager.resize('a2', 'repl', 80, 20).ok, 'another agent cannot resize it');
A.ok(!manager.stop('a2', 'repl').ok, 'another agent cannot stop it');
A.ok(!manager.start({ agentId: 'a1', name: 'repl', command: 'node' }).ok, 'a live name cannot be silently replaced');

const written = manager.write('a1', 'repl', { data: '2+2' });
A.ok(written.ok, 'write reaches a running PTY');
A.eq(pty.children[0].writes, ['2+2\r'], 'submit appends terminal Enter');
manager.write('a1', 'repl', { data: 'x', submit: false });
A.eq(pty.children[0].writes[1], 'x', 'submit:false sends exact character input');
manager.interrupt('a1', 'repl');
A.eq(pty.children[0].writes[2], '\x03', 'interrupt sends Ctrl-C through the PTY rather than assuming a kill');
const resized = manager.resize('a1', 'repl', 140, 45);
A.eq(pty.children[0].sizes, [[140, 45]], 'resize reaches the live PTY');
A.eq([resized.session.cols, resized.session.rows], [140, 45], 'resize truth is reflected in status metadata');

pty.children[0].emitData('\x1b[32mgreen\x1b[0m\rprompt> ');
let read = manager.read('a1', 'repl', { offset: 0, maxChars: 100 });
A.eq(read.output, 'green\nprompt> ', 'scrollback strips terminal controls and normalizes redraw carriage returns');
A.eq(read.nextOffset, read.output.length, 'read returns an absolute continuation cursor');
A.eq(spilled, 'green\nprompt> ', 'sanitized terminal output is durably appended before the memory ring can drop it');
A.eq(read.session.outputPath, '.output/terminal-term_id1.txt', 'terminal read exposes the exact durable output path');

pty.children[0].emitData('z'.repeat(5000));
read = manager.read('a1', 'repl', { offset: 0, maxChars: 100 });
A.ok(read.truncatedStart, 'a read before the ring start explicitly reports dropped output');
A.ok(read.availableFrom > 0 && read.session.droppedChars > 0, 'bounded scrollback reports its real surviving range');
A.eq(read.session.outputSpillVerified, true, 'ring rollover retains a verified durable full-output receipt');
A.eq(read.session.outputBytes, Buffer.byteLength(spilled), 'terminal receipt reports exact full bytes beyond the ring');

const stop = manager.stop('a1', 'repl');
A.ok(stop.ok && stop.requested && stop.session.state === 'stopping', 'stop reports a request, not an invented exit');
A.ok(pty.children[0].killed, 'stop invokes the PTY stop primitive');
A.eq(manager.countRunning('a1'), 1, 'stopping remains active until an actual exit event arrives');
t = 1700; pty.children[0].emitExit(130, 2);
const ended = manager.status('a1', 'repl');
A.eq(ended.state, 'stopped', 'actual exit after a stop request settles as stopped');
A.eq(ended.exitCode, 130, 'real PTY exit code is retained');
A.eq(ended.pid, null, 'dead process identity is no longer exposed as controllable');
A.eq(ledger.released, [4100], 'clean exit releases the orphan ownership receipt');
A.eq(manager.countRunning(), 0, 'settled terminal no longer counts as live work');

// A clean, unrequested exit is distinct from a stop.
const second = manager.start({ agentId: 'a1', name: 'server', command: 'node server.js', cwd: 'C:\\work', env: { ComSpec: 'cmd.exe' } });
pty.children[1].emitExit(0, 0);
A.eq(manager.status('a1', second.session.sessionId).state, 'exited', 'natural exit stays distinct from stopped');

// Restart truth: persisted "running" metadata is history, never an attachable process handle. PID is cleared and
// outcome is unknown even if the numeric PID happens to exist in the new sidecar life.
const prior = { version: 1, sessions: [{
  sessionId: 'term_old', agentId: 'a1', name: 'old', command: 'npm test', cwd: 'C:\\work', state: 'running',
  pid: 999, cols: 80, rows: 24, startedAt: 50, endedAt: null, exitCode: null, exitSignal: null,
  totalOutputChars: 20, droppedChars: 0
}] };
let restartedSave = null;
const restarted = makeTerminalSessions({
  pty: fakePty(), platform: 'win32', clock: { now: () => 2000 }, newId: () => 'new',
  load: () => ({ status: 'ok', value: prior }), save: v => { restartedSave = v; }
});
const old = restarted.status('a1', 'old');
A.eq([old.state, old.attached, old.running, old.pid], ['unknown', false, false, null], 'prior-life active session degrades to non-attached unknown');
A.ok(/prior-life|restarted/.test(old.reason), 'unknown state explains why it cannot be reattached');
A.eq(restartedSave.sessions[0].state, 'unknown', 'restart downgrade is durably recorded immediately');
A.ok(!restarted.write('a1', 'old', { data: 'x' }).ok, 'prior-life metadata cannot control a possibly recycled PID');

const absent = makeTerminalSessions({ pty: null });
A.ok(!absent.available(), 'missing native binding is reported as unavailable');
A.ok(!absent.start({ agentId: 'a1', name: 'x', command: 'echo x' }).ok, 'missing binding refuses start without crashing sidecar boot');

A.eq(_internals.defaultSpawnSpec('echo x', 'linux', { SHELL: '/bin/bash' }), { file: '/bin/bash', args: ['-lc', 'echo x'] }, 'POSIX uses a real login shell under forkpty');
A.throws(() => _internals.cleanName('../other'), 'session names cannot escape their ownership namespace');

A.report('terminal-sessions');
