/* node test/logbound.test.js — bounded boot-load + rotation for the append-only JSONL logs (P3).

   Proves boot stays bounded with a HUGE history: tailLines reads only the last N bytes of a giant file
   (never the whole thing) and returns complete lines with the newest intact; rotateIfLarge rolls the
   live file once it passes the cap; loadBounded reads archive+live bounded to ~N; and an end-to-end
   makeRunStore wired exactly like the sidecar boots bounded from a multi-thousand-line file while its
   newest-first list() is byte-correct. Uses the REAL node fs on a temp dir so the positional-read fast
   path (open/fstat/read/close) is exercised, not just the in-memory fallback. */
'use strict';
const A = require('./_assert.js');
const realFs = require('fs');
const os = require('os');
const pathMod = require('path');
const { tailLines, loadBounded, rotateIfLarge, appendJsonlDurable } = require('../sidecar/logbound.js');
const { makeRunStore } = require('../sidecar/runstore.js');

const DIR = pathMod.join(os.tmpdir(), 'starnet-logbound-' + process.pid);
realFs.mkdirSync(DIR, { recursive: true });
const cleanup = () => { try { for (const f of realFs.readdirSync(DIR)) realFs.unlinkSync(pathMod.join(DIR, f)); realFs.rmdirSync(DIR); } catch (_) {} };

try {
  // ---- A. tailLines reads only the bounded tail of a HUGE file (boot never loads the whole thing) ----
  {
    const file = pathMod.join(DIR, 'huge.jsonl');
    const N = 200000;                                  // ~200k lines
    const fd = realFs.openSync(file, 'w');
    for (let i = 0; i < N; i++) realFs.writeSync(fd, JSON.stringify({ i, pad: 'xxxxxxxxxxxxxxxx' }) + '\n');
    realFs.fsyncSync(fd); realFs.closeSync(fd);
    const sizeMB = realFs.statSync(file).size / (1024 * 1024);
    A.ok(sizeMB > 5, 'built a multi-MB file (' + sizeMB.toFixed(1) + ' MB)');

    const cap = 256 * 1024;                            // 256 KB tail
    const lines = tailLines({ fs: realFs }, file, cap);
    A.ok(lines.length > 0, 'tailLines returned lines');
    A.ok(lines.length < N / 10, 'tailLines loaded only a small tail (' + lines.length + ' of ' + N + '), not the whole file');
    // every returned line is COMPLETE json (the sheared partial first line was dropped)
    let allParse = true; for (const l of lines) { try { JSON.parse(l); } catch (_) { allParse = false; } }
    A.ok(allParse, 'every returned line is a complete JSON record (partial leading line dropped)');
    // the NEWEST record is intact at the tail
    A.eq(JSON.parse(lines[lines.length - 1]).i, N - 1, 'newest record preserved at the tail');
    // bounded: total bytes returned are within ~the cap
    const bytes = lines.reduce((t, l) => t + l.length + 1, 0);
    A.ok(bytes <= cap + 1024, 'returned tail is within the byte cap (bounded boot RAM)');
  }

  // ---- B. rotateIfLarge rolls the live file to .1 once it passes the cap ----
  {
    const file = pathMod.join(DIR, 'rot.jsonl');
    realFs.writeFileSync(file, 'a'.repeat(5000) + '\n');
    A.eq(rotateIfLarge({ fs: realFs }, file, 1000), true, 'oversized file rotates');
    A.ok(realFs.existsSync(file + '.1'), 'archive segment <file>.1 created');
    A.ok(!realFs.existsSync(file), 'live file rolled away (next append starts fresh)');
    // a small file does NOT rotate
    realFs.writeFileSync(file, 'tiny\n');
    A.eq(rotateIfLarge({ fs: realFs }, file, 1000), false, 'small file does not rotate');
  }

  // ---- C. loadBounded reads archive + live, bounded to ~maxBytes of the newest lines ----
  {
    const file = pathMod.join(DIR, 'seg.jsonl');
    realFs.writeFileSync(file + '.1', Array.from({ length: 100 }, (_, i) => 'old' + i).join('\n') + '\n');
    realFs.writeFileSync(file, Array.from({ length: 100 }, (_, i) => 'new' + i).join('\n') + '\n');
    const all = loadBounded({ fs: realFs }, file, 1 << 20);   // generous cap -> both segments fit
    A.eq(all[0], 'old0', 'archive segment comes first');
    A.eq(all[all.length - 1], 'new99', 'live segment newest comes last');
    A.eq(all.length, 200, 'both segments loaded when within budget');
    // tight cap -> only the newest lines survive, still bounded
    const tight = loadBounded({ fs: realFs }, file, 200);
    A.ok(tight.length < 200, 'tight cap keeps only the newest lines (' + tight.length + ')');
    A.eq(tight[tight.length - 1], 'new99', 'newest line always kept under a tight cap');
  }

  // ---- D. END-TO-END: a runStore wired like the sidecar boots BOUNDED from a huge history ----
  {
    const file = pathMod.join(DIR, 'runs.jsonl');
    const N = 50000;
    const fd = realFs.openSync(file, 'w');
    for (let i = 0; i < N; i++) realFs.writeSync(fd, JSON.stringify({ runId: 'r' + i, agentId: 'hero', reason: 'done', turns: 1, tokens: 1, usd: 0.001, title: 't' + i, ts: 1000 + i }) + '\n');
    realFs.closeSync(fd);
    const LOG_MAX = 512 * 1024;
    const io = {
      readAll() { return loadBounded({ fs: realFs }, file, LOG_MAX).map(l => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean); },
      append() {}
    };
    const t0 = process.hrtime.bigint();
    const store = makeRunStore({ io, clock: { now: () => 0 } });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    A.ok(store.count() > 0 && store.count() < N, 'runStore booted a BOUNDED subset (' + store.count() + ' of ' + N + ')');
    A.ok(ms < 500, 'boot stayed fast (' + ms.toFixed(0) + ' ms) despite a ' + N + '-line history');
    // the NEWEST runs are intact and list() is newest-first
    const top = store.list('hero', { limit: 3 });
    A.eq(top[0].runId, 'r' + (N - 1), 'newest run present after bounded boot');
    A.eq(top[1].runId, 'r' + (N - 2), 'list() is newest-first and contiguous at the tail');
  }

  // ---- E. durable append completes short writes and rejects without carrying a partial row forward ----
  {
    const file = pathMod.join(DIR, 'short-write.jsonl');
    let calls = 0;
    const shortFs = new Proxy(realFs, { get(target, prop) {
      if (prop === 'writeSync') return (fd, buffer, offset, length) => {
        calls++;
        return target.writeSync(fd, buffer, offset, Math.min(length, 3));
      };
      return target[prop];
    } });
    appendJsonlDurable({ fs: shortFs }, file, { id: 'complete', ok: true });
    A.ok(calls > 1, 'a short write is completed with subsequent writes');
    A.eq(JSON.parse(realFs.readFileSync(file, 'utf8')).id, 'complete', 'the completed row remains valid JSON');

    let first = true;
    const stalledFs = new Proxy(realFs, { get(target, prop) {
      if (prop === 'writeSync') return (fd, buffer, offset, length) => {
        if (!first) return 0;
        first = false;
        return target.writeSync(fd, buffer, offset, Math.min(length, 4));
      };
      return target[prop];
    } });
    const before = realFs.readFileSync(file);
    A.throws(() => appendJsonlDurable({ fs: stalledFs }, file, { id: 'rejected' }), 'a zero-progress short write is rejected');
    A.eq(realFs.readFileSync(file).toString('hex'), before.toString('hex'), 'a rejected partial append rolls back to the prior byte boundary');
  }

  cleanup();
  A.report('logbound.test');
} catch (e) {
  cleanup();
  console.log('FAIL: logbound.test threw — ' + (e && e.stack || e));
  process.exit(1);
}
