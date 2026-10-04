/* node test/packaged-lifecycle.test.js
   Locks the G1 packaged-lifecycle gate's classification + verdict logic (scripts/qa/packaged-lifecycle.mjs)
   with fakes — no PowerShell, no user32, no installed app, virtual clock. Proves:
     - process classification uses the shell's full-path rule (foreign node.exe never counts)
     - window detection = visible + exact "StarNet" title + shell-owned (the `-siw` single-instance
       window and hidden windows never count)
     - startup.log parsing takes the LAST spawn record after a marker and names the close branch
     - idle-close verdict fails on a lingering shell, an orphan sidecar, the wrong branch, or a
       relaunch without a window / health
     - close-to-tray verdict fails on a replaced resident, a killed sidecar, a visible window, or a
       second launch that reveals nothing (the 0.10.x windowless-resident escape)
     - updater verdict pins exe version, tag feed, and public feed
     - the orchestrator, driven by a scripted fake world, passes a correct shell and FAILS the
       zombie shell whose idle close leaves the process alive. */
'use strict';
const A = require('./_assert.js');

(async () => {
  const M = await import('../scripts/qa/packaged-lifecycle.mjs');
  const INSTALL = 'C:\\Users\\runneradmin\\AppData\\Local\\StarNet';
  const EXE = INSTALL + '\\skynet-desktop.exe';
  const NODE = INSTALL + '\\node.exe';

  // ---- classifyProcesses
  {
    const c = M.classifyProcesses([
      { pid: 100, name: 'skynet-desktop.exe', path: EXE, ppid: 1 },
      { pid: 101, name: 'node.exe', path: NODE, ppid: 100 },
      { pid: 102, name: 'node.exe', path: 'C:\\hostedtoolcache\\node\\22\\node.exe', ppid: 5 },
      { pid: 103, name: 'NODE.EXE', path: INSTALL.toUpperCase() + '/node.exe', ppid: 100 },
      { pid: 'x', name: 'node.exe', path: NODE },
      null,
    ], INSTALL);
    A.eq(c.shell.map((p) => p.pid), [100], 'shell = skynet-desktop.exe');
    A.eq(c.sidecar.map((p) => p.pid), [101, 103], 'sidecar = node.exe under the install dir (case/slash-insensitive)');
    A.eq(c.foreign.map((p) => p.pid), [102], 'a node.exe elsewhere is foreign, never an orphan');
    A.eq(M.classifyProcesses([{ pid: 7, name: 'node.exe', path: null }], INSTALL).sidecar.length, 0, 'node.exe without a path never counts as sidecar');
  }

  // ---- starnetWindows
  {
    const wins = [
      { hwnd: 1, pid: 100, visible: true, title: 'StarNet' },
      { hwnd: 2, pid: 100, visible: false, title: 'StarNet' },
      { hwnd: 3, pid: 100, visible: true, title: 'ai.skynet.harness-siw' },
      { hwnd: 4, pid: 999, visible: true, title: 'StarNet' },
      { hwnd: 5, pid: 100, visible: true, title: ' StarNet ' },
    ];
    A.eq(M.starnetWindows(wins, [100]).map((w) => w.hwnd), [1, 5], 'visible + exact title + shell-owned only');
    A.eq(M.starnetWindows(wins, []).length, 0, 'no shell pids → no windows');
  }

  // ---- parseStartupLog / closeBranch
  {
    const log = [
      'startup exe=... port=50001 start_minimized=false close_to_tray=false',
      'spawn_sidecar pid=11 port=50001 listening=true',
      'close-request: close_to_tray=false',
      'startup exe=... port=50002',
      'spawn_sidecar pid=12 port=50002 listening=false',
    ].join('\r\n');
    const all = M.parseStartupLog(log);
    A.eq([all.port, all.listening, all.sidecarPid, all.lineCount], [50002, false, 12, 5], 'last spawn record wins');
    A.eq(M.parseStartupLog(log + '\r\n').lineCount, 5, 'a trailing newline does not count as a line (marker off-by-one)');
    A.eq(M.parseStartupLog(log, 3).closeLines, [], 'a marker slices off earlier close lines');
    A.eq(M.parseStartupLog(log, 3).port, 50002, 'port after the marker');
    A.eq(M.parseStartupLog('', 0).port, null, 'empty log → no port');
    A.eq(M.closeBranch(['close-request: close_to_tray=false']), 'idle-quit', 'idle branch');
    A.eq(M.closeBranch(['close-request: close_to_tray=true', 'close-request: staying resident (close-to-tray preference)']), 'tray-preference', 'tray branch');
    A.eq(M.closeBranch(['close-request: close_to_tray=false', 'close-request: staying resident (armed state ambiguous)']), 'ambiguous', 'ambiguous fail-open branch named');
    A.eq(M.closeBranch(['close-request: close_to_tray=true', 'close-request: staying resident (close-to-tray preference)', 'close-request: close_to_tray=false']), 'idle-quit', 'only the LAST decision counts');
    A.eq(M.closeBranch(['close-request: close_to_tray=true', 'close-request: close-to-tray preference, but the main window is gone — unrevealable residency; quitting fully']), 'unrevealable-quit', 'unrevealable quit named');
    A.eq(M.closeBranch([]), 'unknown', 'no lines → unknown');
  }

  const snap = (o) => Object.assign({ shell: [], sidecar: [], windows: [], health: null }, o);
  const shell = (pid) => ({ pid, path: EXE, ppid: 1 });
  const side = (pid) => ({ pid, path: NODE, ppid: 100 });
  const win = (pid) => ({ hwnd: 9, pid, visible: true, title: 'StarNet' });
  const idleLog = { closeLines: ['close-request: close_to_tray=false'] };
  const trayLog = { closeLines: ['close-request: close_to_tray=true', 'close-request: staying resident (close-to-tray preference)'] };

  // ---- judgeIdleClose
  {
    const good = M.judgeIdleClose({ after: snap(), relaunch: snap({ shell: [shell(200)], sidecar: [side(201)], windows: [win(200)], health: true }), log: idleLog });
    A.eq(good.pass, true, 'idle-close passes: gone, idle branch, relaunch visible + healthy — ' + good.reasons.join('|'));
    A.eq(good.branch, 'idle-quit', 'idle verdict names its branch');
    const zombie = M.judgeIdleClose({ after: snap({ shell: [shell(100)] }), relaunch: snap({ shell: [shell(100)], windows: [win(100)], health: true }), log: idleLog });
    A.eq(zombie.pass, false, 'a shell that survives idle close FAILS');
    A.ok(zombie.reasons.some((r) => /shell still alive/.test(r)), 'names the lingering shell');
    const orphan = M.judgeIdleClose({ after: snap({ sidecar: [side(101)] }), relaunch: snap({ shell: [shell(200)], windows: [win(200)], health: true }), log: idleLog });
    A.ok(!orphan.pass && orphan.reasons.some((r) => /orphan sidecar/.test(r)), 'an orphan node.exe FAILS');
    const wrongBranch = M.judgeIdleClose({ after: snap(), relaunch: snap({ shell: [shell(200)], windows: [win(200)], health: true }), log: trayLog });
    A.ok(!wrongBranch.pass && wrongBranch.reasons.some((r) => /branch was "tray-preference"/.test(r)), 'idle case that took the tray branch FAILS (the 08-19 wrong-branch lesson)');
    const noWin = M.judgeIdleClose({ after: snap(), relaunch: snap({ shell: [shell(200)], windows: [], health: true }), log: idleLog });
    A.ok(!noWin.pass && noWin.reasons.some((r) => /no visible "StarNet" window after relaunch/.test(r)), 'relaunch without a window FAILS');
    const noHealth = M.judgeIdleClose({ after: snap(), relaunch: snap({ shell: [shell(200)], windows: [win(200)], health: false }), log: idleLog });
    A.ok(!noHealth.pass && noHealth.reasons.some((r) => /health/.test(r)), 'relaunch without health FAILS');
    A.eq(M.judgeIdleClose({ after: null, relaunch: null, log: null }).pass, false, 'missing snapshots FAIL loudly');
  }

  // ---- judgeTrayClose
  {
    const resident = snap({ shell: [shell(100)], sidecar: [side(101)], windows: [], health: true });
    const revealed = snap({ shell: [shell(100)], sidecar: [side(101)], windows: [win(100)], health: true });
    const good = M.judgeTrayClose({ launchedPid: 100, resident, revealed, log: trayLog });
    A.eq(good.pass, true, 'close-to-tray passes: stays, hidden, sidecar alive, second launch reveals — ' + good.reasons.join('|'));
    const windowless = M.judgeTrayClose({ launchedPid: 100, resident, revealed: snap({ shell: [shell(100)], sidecar: [side(101)], windows: [] }), log: trayLog });
    A.ok(!windowless.pass && windowless.reasons.some((r) => /windowless resident/.test(r)), 'a resident the second launch cannot reveal FAILS');
    const replaced = M.judgeTrayClose({ launchedPid: 100, resident, revealed: snap({ shell: [shell(300)], windows: [win(300)] }), log: trayLog });
    A.ok(!replaced.pass && replaced.reasons.some((r) => /replaced, not revealed/.test(r)), 'a second launch that replaced the resident FAILS');
    const twoShells = M.judgeTrayClose({ launchedPid: 100, resident, revealed: snap({ shell: [shell(100), shell(300)], windows: [win(300)] }), log: trayLog });
    A.ok(!twoShells.pass && twoShells.reasons.some((r) => /single-instance/.test(r)), 'two shells after the second launch FAILS (single-instance broken)');
    const quit = M.judgeTrayClose({ launchedPid: 100, resident: snap(), revealed, log: { closeLines: ['close-request: close_to_tray=true'] } });
    A.ok(!quit.pass && quit.reasons.some((r) => /expected the shell to STAY/.test(r)), 'a shell that quit despite closeToTray FAILS');
    const killedSidecar = M.judgeTrayClose({ launchedPid: 100, resident: snap({ shell: [shell(100)], sidecar: [], windows: [], health: false }), revealed, log: trayLog });
    A.ok(!killedSidecar.pass && killedSidecar.reasons.some((r) => /sidecar node.exe was killed/.test(r)), 'resident shell with a dead sidecar FAILS');
    const stillVisible = M.judgeTrayClose({ launchedPid: 100, resident: snap({ shell: [shell(100)], sidecar: [side(101)], windows: [win(100)], health: true }), revealed, log: trayLog });
    A.ok(!stillVisible.pass && stillVisible.reasons.some((r) => /remained after close-to-tray/.test(r)), 'window still visible after close FAILS');
  }

  // ---- judgeUpdater
  {
    const feed = { version: '0.10.7', platforms: { 'windows-x86_64': { url: 'https://x/StarNet_0.10.7_x64-setup.exe', signature: 'sig' } } };
    A.eq(M.judgeUpdater({ expectedVersion: '0.10.7', exeVersion: '0.10.7.0', tagFeed: feed, publicFeed: feed, feedMustMatch: true }).pass, true, 'updater passes when exe, tag feed, and public feed agree (trailing .0 tolerated)');
    A.eq(M.judgeUpdater({ expectedVersion: 'v0.10.7', exeVersion: '0.10.7', tagFeed: feed, publicFeed: { version: '0.10.6', platforms: feed.platforms }, feedMustMatch: false }).pass, true, 'public feed may lag when the tag is a draft (feedMustMatch=false)');
    const lag = M.judgeUpdater({ expectedVersion: '0.10.7', exeVersion: '0.10.7', tagFeed: feed, publicFeed: { version: '0.10.6' }, feedMustMatch: true });
    A.ok(!lag.pass && lag.reasons.some((r) => /public feed is pinned to "0.10.6"/.test(r)), 'public feed must be pinned when the tag is the published latest');
    const wrongExe = M.judgeUpdater({ expectedVersion: '0.10.7', exeVersion: '0.10.6', tagFeed: feed, publicFeed: feed, feedMustMatch: true });
    A.ok(!wrongExe.pass && wrongExe.reasons.some((r) => /installed exe reports version "0.10.6"/.test(r)), 'wrong installed version FAILS');
    const unsigned = M.judgeUpdater({ expectedVersion: '0.10.7', exeVersion: '0.10.7', tagFeed: { version: '0.10.7', platforms: { 'windows-x86_64': { url: 'u' } } }, publicFeed: feed, feedMustMatch: false });
    A.ok(!unsigned.pass && unsigned.reasons.some((r) => /no signed windows-x86_64/.test(r)), 'tag feed without a windows signature FAILS');
    const down = M.judgeUpdater({ expectedVersion: '0.10.7', exeVersion: '0.10.7', tagFeed: feed, publicFeed: null, publicFeedError: 'ECONNREFUSED', feedMustMatch: false });
    A.ok(!down.pass && down.reasons.some((r) => /unreachable/.test(r)), 'unreachable public feed FAILS');
  }

  // ---- buildReceipt
  {
    const r = M.buildReceipt({ meta: { tag: 'v0.10.7' }, cases: [{ name: 'idle-close', result: 'PASS' }, { name: 'close-to-tray', result: 'FAIL', reasons: ['x'] }], startedAt: 1000, finishedAt: 4000 });
    A.eq([r.schema, r.verdict, r.failedCases, r.durationMs], [M.RECEIPT_SCHEMA, 'FAIL', ['close-to-tray'], 3000], 'receipt: schema, verdict, failed cases, duration');
    A.eq(M.buildReceipt({ cases: [] }).verdict, 'FAIL', 'an empty matrix is never a PASS');
    A.ok(Array.isArray(r.notCovered) && r.notCovered.some((n) => /tray menu Quit/.test(n)), 'receipt states what is NOT covered');
  }

  // ---- pollUntil with a virtual clock
  {
    let t = 0; let n = 0;
    const clock = { now: () => t, sleep: async (ms) => { t += ms; } };
    const r = await M.pollUntil(async () => ({ ok: ++n >= 3, value: n }), Object.assign({ timeoutMs: 10_000, intervalMs: 500 }, clock));
    A.eq([r.ok, r.value, r.elapsedMs], [true, 3, 1000], 'pollUntil resolves when the predicate turns ok');
    const to = await M.pollUntil(async () => ({ ok: false, value: 'last' }), Object.assign({ timeoutMs: 2_000, intervalMs: 500 }, clock));
    A.eq([to.ok, to.value, to.elapsedMs], [false, 'last', 2000], 'pollUntil times out with the last value');
  }

  // ---- the orchestrator against a scripted fake world
  // `world` models the installed app: launch spawns a shell (+ sidecar after a delay, + a window),
  // WM_CLOSE runs the shell's decision with the configured prefs. `zombie` reproduces the 0.10.x
  // escape: the idle close hides the window but never exits.
  function fakeWorld({ zombie = false, windowlessResident = false } = {}) {
    let t = 0; let nextPid = 100; let log = 'startup\n';
    const procs = []; const windows = []; const prefs = { closeToTray: false };
    const killed = []; const launches = [];
    const spawnApp = () => {
      const existing = procs.find((p) => p.name === 'skynet-desktop.exe');
      if (existing) { // single-instance: signal the resident, then bail
        launches.push('second');
        const w = windows.find((x) => x.pid === existing.pid);
        if (w && !windowlessResident) w.visible = true;
        return nextPid++;
      }
      launches.push('first');
      const pid = nextPid++;
      procs.push({ pid, name: 'skynet-desktop.exe', path: EXE, ppid: 1 });
      windows.push({ hwnd: pid * 10, pid, visible: true, title: 'StarNet' });
      windows.push({ hwnd: pid * 10 + 1, pid, visible: true, title: 'ai.skynet.harness-siw' });
      const sp = nextPid++;
      procs.push({ pid: sp, name: 'node.exe', path: NODE, ppid: pid });
      log += `spawn_sidecar pid=${sp} port=${40000 + pid} listening=true\n`;
      return pid;
    };
    const drivers = {
      now: () => t,
      sleep: async (ms) => { t += ms; },
      listProcesses: async () => procs.map((p) => Object.assign({}, p)),
      listWindows: async () => windows.map((w) => Object.assign({}, w)),
      launch: async () => spawnApp(),
      health: async (port) => procs.some((p) => p.name === 'node.exe' && 40000 + p.ppid === port),
      readStartupLog: async () => log,
      writePrefs: async (o) => { prefs.closeToTray = !!o.closeToTray; },
      closeWindow: async (hwnd) => {
        const w = windows.find((x) => x.hwnd === hwnd); if (!w) throw new Error('no hwnd');
        const shellPid = w.pid;
        windows.filter((x) => x.pid === shellPid).forEach((x) => { x.visible = false; });
        log += `close-request: close_to_tray=${prefs.closeToTray}\n`;
        if (prefs.closeToTray) { log += 'close-request: staying resident (close-to-tray preference)\n'; return; }
        if (zombie) return; // the escape: hidden, alive, unrevealable
        for (let i = procs.length - 1; i >= 0; i--) if (procs[i].pid === shellPid || procs[i].ppid === shellPid) procs.splice(i, 1);
        for (let i = windows.length - 1; i >= 0; i--) if (windows[i].pid === shellPid) windows.splice(i, 1);
      },
      exeVersion: async () => '0.10.7',
      fetchJson: async (url) => ({ version: '0.10.7', platforms: { 'windows-x86_64': { url, signature: 's' } } }),
      kill: async (pids) => {
        killed.push(...pids);
        for (const pid of pids) {
          for (let i = procs.length - 1; i >= 0; i--) if (procs[i].pid === pid || procs[i].ppid === pid) procs.splice(i, 1);
          for (let i = windows.length - 1; i >= 0; i--) if (windows[i].pid === pid) windows.splice(i, 1);
        }
      },
    };
    return { drivers, state: { procs, windows, killed, launches, prefs } };
  }
  const ctx = (extra) => Object.assign({ exe: EXE, installDir: INSTALL, expectedVersion: '0.10.7', tagFeedUrl: 'https://t/latest.json', publicFeedUrl: 'https://p/latest.json', feedMustMatch: true, meta: { tag: 'v0.10.7' } }, extra || {});

  {
    const { drivers, state } = fakeWorld();
    const receipt = await M.runMatrix(drivers, ctx());
    A.eq(receipt.verdict, 'PASS', 'correct shell passes the full matrix — ' + JSON.stringify(receipt.cases.map((c) => [c.name, c.result, c.reasons])));
    A.eq(receipt.cases.map((c) => c.name), ['idle-close', 'close-to-tray', 'updater-smoke'], 'all three cases ran in order');
    A.eq(receipt.cases[0].branch, 'idle-quit', 'idle case proved the idle branch');
    A.eq(receipt.cases[1].branch, 'tray-preference', 'tray case proved the tray branch');
    A.eq(state.procs.length, 0, 'matrix leaves nothing running');
    A.eq(state.launches, ['first', 'first', 'first', 'second'], 'launch sequence: boot, relaunch, tray boot, single-instance signal');
    A.ok(typeof receipt.cases[0].timings.goneMs === 'number', 'timings recorded');
  }
  {
    const { drivers } = fakeWorld({ zombie: true });
    const receipt = await M.runMatrix(drivers, ctx({ cases: ['idle-close'] }));
    A.eq(receipt.verdict, 'FAIL', 'the 0.10.x zombie shell FAILS idle-close');
    A.ok(receipt.cases[0].reasons.some((r) => /shell still alive/.test(r)), 'zombie reason: ' + receipt.cases[0].reasons.join('|'));
  }
  {
    const { drivers } = fakeWorld({ windowlessResident: true });
    const receipt = await M.runMatrix(drivers, ctx({ cases: ['close-to-tray'] }));
    A.eq(receipt.verdict, 'FAIL', 'a resident the second launch cannot reveal FAILS close-to-tray');
    A.ok(receipt.cases[0].reasons.some((r) => /windowless resident/.test(r)), 'windowless reason: ' + receipt.cases[0].reasons.join('|'));
  }
  {
    const { drivers } = fakeWorld();
    drivers.listWindows = async () => { throw new Error('user32 exploded'); };
    const receipt = await M.runMatrix(drivers, ctx({ cases: ['idle-close'] }));
    A.eq(receipt.verdict, 'FAIL', 'a driver crash is a loud FAIL, never a skip');
    A.ok(/runner error: .*user32 exploded/.test(receipt.cases[0].reasons[0]), 'crash reason recorded');
  }
  {
    const r = M.parseArgs(['--exe=C:\\x.exe', '--cases=idle-close,updater-smoke', '--feed-must-match', '--tag=v0.10.7']);
    A.eq([r.exe, r.cases, r['feed-must-match'], r.tag], ['C:\\x.exe', 'idle-close,updater-smoke', true, 'v0.10.7'], 'parseArgs');
  }

  // ---- the hosted workflow + package script + runbook are wired (string lock; no YAML parser in the repo)
  {
    const fs = require('node:fs');
    const path = require('node:path');
    const root = path.resolve(__dirname, '..');
    const yml = fs.readFileSync(path.join(root, '.github', 'workflows', 'g1-packaged-lifecycle.yml'), 'utf8');
    A.ok(/^name: g1-packaged-lifecycle$/m.test(yml), 'workflow is named g1-packaged-lifecycle');
    A.ok(/workflow_dispatch:\s*\n\s*inputs:\s*\n\s*tag:/.test(yml), 'workflow_dispatch exposes a `tag` input');
    A.ok(/runs-on: windows-latest/.test(yml), 'runs on a hosted Windows VM (fresh machine per run)');
    A.ok(/androoAGI\/starnet-releases/.test(yml), 'pulls the installer from the releases repo');
    A.ok(/gh release download \$env:TAG .*--pattern '\*-setup\.exe'/.test(yml), 'downloads the tag installer');
    A.ok(/-ArgumentList '\/S'/.test(yml), 'silent install');
    A.ok(/scripts\/qa\/packaged-lifecycle\.mjs/.test(yml), 'the workflow calls the reusable runner (no inline case logic)');
    A.ok(/--tag-feed-path=/.test(yml) && /--feed-must-match/.test(yml), 'updater smoke receives the tag feed + the pinned flag');
    const upload = yml.slice(yml.indexOf('upload-artifact@v4'));
    A.ok(/if: always\(\)/.test(upload) && /if-no-files-found: error/.test(upload), 'receipt artifact is uploaded even on failure');
    const matrixStep = yml.split('Run the packaged-lifecycle matrix')[1].split('- name:')[0];
    A.ok(!/taskkill|Stop-Process/.test(matrixStep), 'no force-kill inside the matrix step (cleanup lives outside the assertions)');
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    A.eq(pkg.scripts['qa:lifecycle:packaged'], 'node scripts/qa/packaged-lifecycle.mjs', 'package script qa:lifecycle:packaged is wired');
    const runbook = fs.readFileSync(path.join(root, 'docs', 'RELEASE_RUNBOOK.md'), 'utf8');
    A.ok(/g1-packaged-lifecycle/.test(runbook) && /packaged-lifecycle-receipt\.json/.test(runbook), 'RELEASE_RUNBOOK documents the G1 gate + its receipt');
  }

  A.report();
})().catch((e) => { console.log('FAIL: ' + (e && e.stack || e)); process.exit(1); });
