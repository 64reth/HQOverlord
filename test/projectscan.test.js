/* node test/projectscan.test.js — the bounded, harness-side PROJECT SNAPSHOT scan (NS-5b consumption of NS-5).

   When the night focus is a blessed project root and reach ≥ sandbox, the act beat READS the project before
   proposing — a DETERMINISTIC scan (git status/log/diff + TODO/FIXME grep + top-level tree) produced by harness
   code, NOT model tool-improv, injected as a PROJECT SNAPSHOT block. Proves:
     · an UN-blessed root is NEVER scanned (no exec runs) and never gets blessed — the guard is consulted directly
     · a git repo composes a bounded snapshot from git output (status/log/todos)
     · the snapshot text is hard-bounded (a pathological repo can't bloat the prompt) */
'use strict';
const A = require('./_assert.js');
const { makeProjectScan } = require('../sidecar/projectscan.js');

// a fake exec: maps a git subcommand (args[2]) to canned stdout. Records every call so we can assert "no exec".
function fakeExec(map) {
  const calls = [];
  return {
    calls,
    exec: async (cmd, args) => {
      calls.push([cmd].concat(args).join(' '));
      const sub = args[2] || args[0];
      if (Object.prototype.hasOwnProperty.call(map, sub)) return { stdout: map[sub], code: 0 };
      return { stdout: '', code: 0 };
    }
  };
}
const fsp = { readdir: async () => [] };
const pathMod = require('path');

async function neverScansUnblessed() {
  const fx = fakeExec({});
  const scan = makeProjectScan({ exec: fx.exec, fsp, pathMod, isBlessed: () => false });
  const r = await scan.scan('C:/not/blessed', {});
  A.eq(r.ok, false, 'an un-blessed root is refused');
  A.eq(r.reason, 'not-blessed', 'and reports why');
  A.eq(fx.calls.length, 0, 'NO exec ran for an un-blessed root (never touches the fs of an untrusted path)');
}

// ---- a git repo composes a bounded snapshot ----
async function gitSnapshot() {
  const fx = fakeExec({
    'rev-parse': 'true\n',
    'status': ' M src/app.js\n?? new.txt\n',
    'log': 'a1b2c3d fix export bug\nd4e5f6a add invoice csv\n',
    'diff': ' src/app.js | 4 ++--\n 1 file changed\n',
    'grep': 'src/app.js:12:// TODO: handle empty invoice list\nsrc/pay.js:88:// FIXME: rounding\n'
  });
  const scan = makeProjectScan({ exec: fx.exec, fsp, pathMod, isBlessed: () => true });
  const r = await scan.scan('C:/repo/alpha', { sinceMs: 0 });
  A.eq(r.ok, true, 'a blessed git repo scans');
  A.eq(r.isGit, true, 'detected as a git repo');
  A.ok(/PROJECT SNAPSHOT/i.test(r.text), 'the snapshot has a labeled header');
  A.ok(/TODO: handle empty invoice/.test(r.text), 'the planted TODO is surfaced (the evidence a focus cites)');
  A.ok(/fix export bug/.test(r.text), 'recent commits are surfaced');
  A.ok(/app\.js/.test(r.text), 'uncommitted changes are surfaced');
}

// ---- the snapshot is hard-bounded ----
async function bounded() {
  const huge = Array.from({ length: 5000 }, (_, i) => 'src/f' + i + '.js:' + i + ':// TODO x' + i).join('\n');
  const fx = fakeExec({ 'rev-parse': 'true\n', 'grep': huge, 'status': huge, 'log': huge, 'diff': huge });
  const scan = makeProjectScan({ exec: fx.exec, fsp, pathMod, isBlessed: () => true, maxChars: 1800 });
  const r = await scan.scan('C:/repo/alpha', {});
  A.ok(r.text.length <= 1800, 'the snapshot never exceeds maxChars (bounded like contextpack) — got ' + r.text.length);
}

(async () => { await neverScansUnblessed(); await gitSnapshot(); await bounded(); A.report(); })();
