/* node test/shell-bg-io.test.js — a background process is TWO-WAY and readable past its tail (H2.3).

   shell-bg.test.js pins the lifecycle. This pins the I/O that was missing from it, which made a background
   process write-only in both directions:
     - no STDIN, so an installer asking one question or any REPL wedged until it was killed;
     - no PAGING, so `status`'s last-2000-characters tail was the whole visible world and a stack trace a few
       hundred lines back was simply unreachable.

   Deterministic: injected fake spawn + clock, no real processes. (The real-child round trip — prompt, answer,
   next prompt, answer, EOF, exit 0 — was verified live against `node` outside the gate; what a fake proves
   here is the plumbing and the refusals, which is what regresses.) */
'use strict';
const A = require('./_assert.js');
const { makeShellBg } = require('../sidecar/shellbg.js');

// Same fake as shell-bg.test.js, plus a writable stdin that RECORDS — the point under test is what reaches
// the child, so a sink that silently swallowed writes would pass while delivering nothing.
function makeFakeSpawn() {
  const spawn = function (cmd, opts) {
    if (cmd === 'taskkill') { spawn.taskkills++; return { pid: 0, on() {}, stdout: { on() {} }, stderr: { on() {} } }; }
    let dataCb = null, closeCb = null, errCb = null;
    const child = {
      cmd, opts, pid: 1000 + spawn.children.length, killed: false,
      stdin: { written: [], ended: false, write(s) { this.written.push(String(s)); }, end() { this.ended = true; } },
      stdout: { on: (ev, fn) => { if (ev === 'data') dataCb = fn; } },
      stderr: { on: () => {} },
      on: (ev, fn) => { if (ev === 'close') closeCb = fn; else if (ev === 'error') errCb = fn; },
      unref() {}, kill() { this.killed = true; },
      _emit: (s) => { if (dataCb) dataCb(Buffer.from(String(s))); },
      _close: (code) => { if (closeCb) closeCb(code); }
    };
    spawn.children.push(child);
    return child;
  };
  spawn.children = []; spawn.taskkills = 0;
  return spawn;
}
const clock = { now: () => 1000 };

// ---------- STDIN ----------
{
  const spawn = makeFakeSpawn();
  const bg = makeShellBg({ spawn, clock, isWin: true });
  const s = bg.start({ agentId: 'a', cmd: 'npm create vite@latest' });
  const child = spawn.children[0];

  const w = bg.write('a', s.bgId, { input: 'my-app' });
  A.ok(w.ok, 'write to a running process succeeds');
  A.eq(child.stdin.written, ['my-app\n'], 'the payload reaches the child WITH a newline (answering a prompt is the common case)');

  bg.write('a', s.bgId, { input: 'partial', submit: false });
  A.eq(child.stdin.written[1], 'partial', 'submit:false sends a partial line with no newline');

  // ownership is the only gate on a by-id op
  A.ok(!bg.write('b', s.bgId, { input: 'x' }).ok, 'another agent cannot write to a process it did not start');
  A.ok(!bg.read('b', s.bgId, {}).ok, 'another agent cannot read it either');
  A.ok(!bg.closeStdin('b', s.bgId).ok, 'nor close its stdin');

  // EOF is NOT kill: many commands only do their work once stdin closes
  const c = bg.closeStdin('a', s.bgId);
  A.ok(c.ok && child.stdin.ended, 'closeStdin ends the child stdin (EOF)');
  A.ok(!child.killed, 'and does NOT kill the process — killing it would destroy the result EOF was about to produce');
  A.ok(bg.closeStdin('a', s.bgId).alreadyClosed, 'a second close is idempotent');
  A.ok(!bg.write('a', s.bgId, { input: 'late' }).ok, 'writing after EOF is refused rather than silently dropped');

  // an exited process must say so instead of accepting a write into a dead pipe
  const s2 = bg.start({ agentId: 'a', cmd: 'echo hi' });
  spawn.children[1]._close(0);
  const dead = bg.write('a', s2.bgId, { input: 'x' });
  A.ok(!dead.ok && /already exited/.test(dead.error), 'writing to an exited process reports the exit, not a generic failure');

  // a child with no stdin pipe degrades to a reason, never a throw
  const bare = makeShellBg({ spawn: function () { return { pid: 9, on() {}, stdout: { on() {} }, stderr: { on() {} }, unref() {} }; }, clock, isWin: true });
  const s3 = bare.start({ agentId: 'a', cmd: 'x' });
  A.ok(!bare.write('a', s3.bgId, { input: 'x' }).ok, 'a process without writable stdin refuses cleanly');
}

// ---------- PAGED / SEARCHABLE OUTPUT ----------
{
  const spawn = makeFakeSpawn();
  const bg = makeShellBg({ spawn, clock, isWin: true });
  const s = bg.start({ agentId: 'a', cmd: 'npm run dev' });
  const child = spawn.children[0];
  let log = '';
  for (let i = 1; i <= 1200; i++) log += 'line ' + i + (i === 742 ? ' BOOM ReferenceError here' : '') + '\n';
  child._emit(log);

  // default = the END, which is what "show me the log" means; no round trip to learn totalLines first
  const tail = bg.read('a', s.bgId, { limit: 3 });
  A.eq(tail.lines, ['line 1198', 'line 1199', 'line 1200'], 'a read with no offset returns the LAST lines');
  A.eq(tail.totalLines, 1200, 'and reports the true held line count');
  A.eq(tail.firstLineNo, 1198, 'with real line numbers, so the caller can page from here');
  A.ok(!tail.truncatedStart, 'nothing was dropped at 1200 short lines inside a 256KB ring');

  // the whole point: reach a failure hundreds of lines back
  const hit = bg.read('a', s.bgId, { grep: 'BOOM' });
  A.eq(hit.lineNos, [742], 'grep finds the error line and keeps its REAL number');
  A.eq(hit.matchedLines, 1, 'and reports how many lines matched');
  A.eq(bg.read('a', s.bgId, { grep: 'boom' }).matchedLines, 1, 'grep is case-insensitive');
  A.eq(bg.read('a', s.bgId, { grep: 'nothing-here' }).matchedLines, 0, 'a miss is 0 matches, not an error');

  const around = bg.read('a', s.bgId, { offset: 739, limit: 4 });
  A.eq(around.firstLineNo, 740, 'offset pages to the lines around a hit');
  A.ok(around.lines[2].indexOf('BOOM') >= 0, 'and the hit sits where the line numbers said it would');

  const neg = bg.read('a', s.bgId, { offset: -2 });
  A.eq(neg.lines, ['line 1199', 'line 1200'], 'a negative offset counts back from the end');
  A.eq(bg.read('a', s.bgId, { limit: 99999 }).returned, 1200, 'an absurd limit is clamped, not honored');
  A.ok(!bg.read('a', 'bg_nope', {}).ok, 'reading an unknown id fails cleanly');
}

// ---------- RING HONESTY ----------
{
  const spawn = makeFakeSpawn();
  const bg = makeShellBg({ spawn, clock, isWin: true, ringBytes: 400 });
  const s = bg.start({ agentId: 'a', cmd: 'noisy' });
  let log = ''; for (let i = 1; i <= 300; i++) log += 'row ' + i + '\n';
  spawn.children[0]._emit(log);

  const r = bg.read('a', s.bgId, { offset: 0, limit: 2 });
  A.ok(r.truncatedStart, 'once the ring laps, the read SAYS the start is missing');
  A.ok(r.droppedBytes > 0, 'and reports how much was dropped');
  /* Line 1 of the buffer must be a WHOLE line. A ring that cut mid-line would hand back a fragment that
     reads like a real line, and nothing downstream could tell the difference. */
  A.ok(/^row \d+$/.test(r.lines[0]), 'the buffer starts on a line boundary, never a fragment');
  A.ok(r.totalLines < 300, 'and the held count is honestly smaller than what the process printed');
}

A.report('shell-bg-io');
