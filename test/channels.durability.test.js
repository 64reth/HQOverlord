/* node test/channels.durability.test.js — crash-safe durability + last-known-good recovery for the
   per-chat channel store (P2), and the synchronous-RMW concurrency guarantee (P1).

   Proves: a write goes through the injected durable path AND keeps a .bak; a torn (zero-length) or
   corrupt main history file is recovered from its .bak rather than loading amnesiac; a genuinely-absent
   chat still loads []; and N concurrent appendTurn() callers to ONE chat lose ZERO turns (the RMW is
   synchronous, so the event loop serializes it per file — no committed turn is dropped). */
'use strict';
const A = require('./_assert.js');
const pathMod = require('path');
const { makeChannelStore } = require('../sidecar/channels/store.js');
const { writeFileDurable } = require('../sidecar/durable-write.js');

// in-memory fs WITH the durable path (openSync/writeSync/fsyncSync/closeSync) so the injected
// writeFileDurable takes its real fsync-before-rename branch; counts fsyncs to assert durability.
function memFs() {
  const files = new Map();
  const fds = new Map();
  let nextFd = 10;
  const stats = { fsync: 0 };
  return {
    files, stats,
    readFileSync(p) { if (!files.has(p)) { const e = new Error('ENOENT: ' + p); e.code = 'ENOENT'; throw e; } return files.get(p); },
    writeFileSync(p, data) { files.set(p, String(data)); },
    renameSync(a, b) { if (!files.has(a)) { const e = new Error('ENOENT: ' + a); e.code = 'ENOENT'; throw e; } files.set(b, files.get(a)); files.delete(a); },
    mkdirSync() {},
    openSync(p, flags) { const fd = nextFd++; if (flags === 'r') { if (!files.has(p)) { const e = new Error('ENOENT: ' + p); e.code = 'ENOENT'; throw e; } fds.set(fd, { path: p, read: true }); } else { fds.set(fd, { path: p, buf: '' }); files.set(p, ''); } return fd; },
    writeSync(fd, data) { const h = fds.get(fd); h.buf += String(data); files.set(h.path, h.buf); },
    fsyncSync() { stats.fsync++; },
    closeSync(fd) { fds.delete(fd); }
  };
}

let clk = 100;
const clock = { now: () => clk };
const ROOT = '/ws/channels';
const mk = (fs) => makeChannelStore({ fs, pathMod, root: ROOT, clock, writeDurable: writeFileDurable, limits: { maxTurns: 200, maxChars: 1 << 20 } });
const histFile = id => pathMod.join(ROOT, id + '.history.json');

// ---- A. DURABILITY: writes fsync before rename and keep a .bak last-known-good ----
{
  const fs = memFs();
  const s = mk(fs);
  s.appendTurn('tg_1', 'user', 'first');
  A.ok(fs.stats.fsync > 0, 'first append fsync()d before rename (durable path taken)');
  s.appendTurn('tg_1', 'assistant', 'second');
  const bak = fs.files.get(histFile('tg_1') + '.bak');
  A.ok(bak && JSON.parse(bak).messages.length === 1, 'second append snapshotted the prior history to .bak (last-known-good)');
  A.ok(![...fs.files.keys()].some(k => /\.tmp$/.test(k)), 'no .tmp left behind');
}

// ---- B. RECOVERY: a torn (zero-length) main history recovers from .bak instead of loading empty ----
{
  const fs = memFs();
  const s = mk(fs);
  s.appendTurn('tg_2', 'user', 'keep me');           // v1
  s.appendTurn('tg_2', 'assistant', 'and me');       // v2  (.bak = v1)
  fs.files.set(histFile('tg_2'), '');                // simulate a hard kill mid-rename: main left zero-length
  const h = s.loadHistory('tg_2');
  A.ok(h.length >= 1, 'zero-length main recovered from .bak (not amnesiac)');
  A.eq(h[0].content, 'keep me', 'recovered the last-known-good turn');
}

// ---- C. RECOVERY: a corrupt main history recovers from .bak ----
{
  const fs = memFs();
  const s = mk(fs);
  s.appendTurn('tg_3', 'user', 'alpha');
  s.appendTurn('tg_3', 'assistant', 'beta');         // .bak holds the 1-message version
  fs.files.set(histFile('tg_3'), '{ corrupt json');
  const h = s.loadHistory('tg_3');
  A.eq(h.length, 1, 'corrupt main recovered the 1-message .bak');
  A.eq(h[0].content, 'alpha', 'recovered content correct');
}

// ---- D. ABSENT: a genuinely-new chat (no main, no .bak) still loads [] ----
{
  const s = mk(memFs());
  A.eq(s.loadHistory('tg_new'), [], 'absent chat loads empty (the only allowed empty)');
}

// ---- E. CONCURRENCY: N concurrent appendTurn() to one chat lose ZERO turns ----
{
  const fs = memFs();
  const s = mk(fs);
  const N = 40;
  // appendTurn is synchronous, so even fired "concurrently" the event loop runs each to completion before the
  // next — no interleaved read-modify-write. Every committed turn must survive.
  return Promise.all(Array.from({ length: N }, (_, i) => Promise.resolve().then(() => s.appendTurn('tg_race', 'user', 'm' + i))))
    .then(() => {
      const h = s.loadHistory('tg_race');
      A.eq(h.length, N, 'all ' + N + ' concurrent appendTurn() turns persisted (zero lost updates)');
      const contents = new Set(h.map(t => t.content));
      A.eq(contents.size, N, 'every distinct turn survived');
      A.report('channels.durability.test');
    });
}
