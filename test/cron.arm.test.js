/* node test/cron.arm.test.js — boot-level end-to-end test of the cron ARM toggle (G4.6: honest
   disabled-state + one-click enable). Spawns the real Node host (sidecar/index.js) against an
   ISOLATED temp workspace on an ephemeral port, with NO key (zero model spend), and proves:

     - INERT-WHEN-OFF (must NOT regress): boot with NEITHER SKYNET_CRON_ENABLED nor a persisted
       cronArmed flag -> GET /api/cron reports enabled:false, NO cron.armed file is written, and a
       routine that is DUE NOW never fires (no 'cron tick armed' / no cron tick log) — the off-path
       is fully inert (the byte-identical-when-off guarantee).
     - RUNTIME ARM (no restart): POST /api/cron/arm {enabled:true} flips GET /api/cron enabled:true,
       persists a cron.armed.json flag, ARMS the live timer NOW, and a routine DUE NOW is processed
       by the tick within ONE tick window (proven by a non-mockable cron tick log line — the timer
       is genuinely live, not a code-read). POST /api/cron/arm {enabled:false} flips it back off,
       clears the timer, and persists armed:false.
     - ARM AT BOOT: a persisted cronArmed:true causes the scheduler to arm at boot even with NO
       SKYNET_CRON_ENABLED env var ('cron tick armed' appears at boot; a DUE routine is ticked).
     - TOKEN GUARD: POST /api/cron/arm WITHOUT the X-StarNet-Token header is rejected 403 (same
       privileged-POST gate as the cron CRUD routes), so a browser-driven cross-site call can't arm.

   A SHORT tick (SKYNET_CRON_TICK_MS=300) is used so "fires within one tick" resolves in well under
   a second deterministically. Mirrors cron.api.test.js. NOT in test:fast (a child-process boot test
   shouldn't gate other agents). Run via `npm run test:http`. */
'use strict';
const A = require('./_assert.js');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { bootToken } = require('./_httpToken.js');

const HOST = '127.0.0.1';
const INDEX = path.resolve(__dirname, '..', 'sidecar', 'index.js');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// boot the real host; resolves { child, port, out:()=>string } once it prints its listen URL. `extraEnv`
// lets a case set SKYNET_CRON_ENABLED / a short tick. `out()` returns the accumulated stdout+stderr so a
// test can assert a non-mockable log signal (e.g. 'cron tick armed', '[cron] cron.tick ...').
function boot(port, workspaces, attemptsLeft, extraEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [INDEX], {
      env: Object.assign({}, process.env, { SKYNET_PORT: String(port), SKYNET_WORKSPACES: workspaces }, extraEnv || {}),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '', settled = false;
    const onData = d => {
      out += d.toString();
      if (!settled && out.indexOf('http://' + HOST + ':' + port) >= 0) { settled = true; resolve({ child, port, out: () => out }); }
      if (!settled && /already in use/i.test(out)) {
        settled = true; try { child.kill(); } catch (_) {}
        if (attemptsLeft > 0) resolve(boot(port + 1, workspaces, attemptsLeft - 1, extraEnv));
        else reject(new Error('no free port'));
      }
    };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    child.on('error', e => { if (!settled) { settled = true; reject(e); } });
    setTimeout(() => { if (!settled) { settled = true; try { child.kill(); } catch (_) {} reject(new Error('boot timeout; output:\n' + out)); } }, 9000);
  });
}

(async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-cronarm-'));
  const ARMED_FILE = path.join(ws, 'cron.armed.json');
  // short tick so "fires within one tick" resolves fast + deterministically; NO env-arm (default OFF).
  let booted = await boot(8950 + (process.pid % 40), ws, 20, { SKYNET_CRON_TICK_MS: '300' });
  let child = booted.child, port = booted.port, getOut = booted.out;
  const B = () => 'http://' + HOST + ':' + port;
  let apiToken = '';
  async function refreshToken() {
    apiToken = await bootToken(B(), B());
  }
  await refreshToken();
  // j() sends the token (the guarded-POST contract); jNoToken() deliberately omits it (guard test).
  const j = async (m, p, body) => {
    const headers = { 'Content-Type': 'application/json', Origin: B() };
    if (apiToken) headers['X-StarNet-Token'] = apiToken;   // hardened: GET data routes are token-gated too now
    const r = await fetch(B() + p, { method: m, headers, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text(); let v; try { v = JSON.parse(t); } catch (_) { v = t; }
    return { status: r.status, body: v };
  };
  const jNoToken = async (m, p, body) => {
    const r = await fetch(B() + p, { method: m, headers: { 'Content-Type': 'application/json', Origin: B() }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status };
  };

  try {
    // ---- seed a routine that is DUE NOW so the FIRST tick processes it (proving the timer is live). A `once`
    //      schedule with a PAST ISO timestamp is due the instant the scheduler notices it; with no key it takes
    //      the no-capability path but STILL drives a cron.tick (plan.fire.length>=1) — a non-mockable "the timer
    //      ran" signal that doesn't depend on any model spend. ----
    const create = await j('POST', '/api/cron', { name: 'Due now', prompt: 'do a thing', schedule: '2020-01-01T00:00:00Z', agentId: 'cron_arm' });
    A.eq(create.status, 200, 'POST /api/cron (valid, past one-shot) -> 200');
    A.eq(create.body.job.schedule.kind, 'once', 'past ISO parsed to a one-shot (due immediately)');

    // ---- INERT-WHEN-OFF (the must-not-regress invariant) ----
    const offList = await j('GET', '/api/cron');
    A.eq(offList.status, 200, 'GET /api/cron -> 200 (off)');
    A.eq(offList.body.enabled, false, 'OFF: enabled:false — scheduler honestly reported unarmed');
    A.ok(!fs.existsSync(ARMED_FILE), 'OFF: no cron.armed.json persisted (a never-enabled user touches nothing)');
    // give the host MORE than one tick window with cron OFF; nothing must arm and nothing must tick.
    await sleep(800);
    A.ok(getOut().indexOf('cron tick armed') < 0, 'OFF: timer never armed (no "cron tick armed" log)');
    A.ok(getOut().indexOf('[cron] cron.tick') < 0, 'OFF: no cron tick ran (the due routine never fired — fully inert)');

    // ---- TOKEN GUARD: arm without the token is rejected (same gate as the CRUD POSTs) ----
    const armNoTok = await jNoToken('POST', '/api/cron/arm', { enabled: true });
    A.eq(armNoTok.status, 403, 'POST /api/cron/arm without X-StarNet-Token -> 403 (privileged-POST guard)');
    const stillOff = await j('GET', '/api/cron');
    A.eq(stillOff.body.enabled, false, 'a rejected arm did NOT flip enabled');

    // ---- RUNTIME ARM (no restart): flip on, persist, arm the live timer NOW ----
    const armOn = await j('POST', '/api/cron/arm', { enabled: true });
    A.eq(armOn.status, 200, 'POST /api/cron/arm {enabled:true} -> 200');
    A.eq(armOn.body.enabled, true, 'arm response reports enabled:true');
    const onList = await j('GET', '/api/cron');
    A.eq(onList.body.enabled, true, 'after arm: GET /api/cron enabled:true (no restart)');
    A.ok(fs.existsSync(ARMED_FILE), 'after arm: cron.armed.json persisted');
    A.eq(JSON.parse(fs.readFileSync(ARMED_FILE, 'utf8')).armed, true, 'persisted flag is armed:true');
    // the live timer must now process the DUE routine within ONE tick window — a non-mockable signal.
    await sleep(900);   // > 2 tick windows (300ms) so a live ticker has certainly run
    A.ok(getOut().indexOf('cron tick armed') >= 0, 'after arm: the live timer was armed ("cron tick armed")');
    A.ok(getOut().indexOf('[cron] cron.tick') >= 0, 'after arm: a cron tick actually RAN over the due routine within one tick (timer is live)');

    // ---- RUNTIME DISARM: flip off, clear the timer, persist armed:false ----
    const armOff = await j('POST', '/api/cron/arm', { enabled: false });
    A.eq(armOff.status, 200, 'POST /api/cron/arm {enabled:false} -> 200');
    A.eq(armOff.body.enabled, false, 'disarm response reports enabled:false');
    const offAgain = await j('GET', '/api/cron');
    A.eq(offAgain.body.enabled, false, 'after disarm: GET /api/cron enabled:false');
    A.eq(JSON.parse(fs.readFileSync(ARMED_FILE, 'utf8')).armed, false, 'persisted flag is armed:false after disarm');
    // no NEW tick should run after disarm — snapshot the tick-log length, wait, assert it did not grow.
    const ticksBefore = (getOut().match(/\[cron\] cron\.tick/g) || []).length;
    await sleep(800);
    const ticksAfter = (getOut().match(/\[cron\] cron\.tick/g) || []).length;
    A.eq(ticksAfter, ticksBefore, 'after disarm: the timer is cleared — no further cron ticks run');

    // ---- ARM AT BOOT: re-arm, kill, reboot the SAME workspace with NO env arm -> armed at boot ----
    // Seed a FRESH past one-shot that is unclaimed at reboot so the boot-reconcile has a DUE routine to tick
    // over. To keep it unclaimed by THIS process's live timer (which would stamp a fire-claim and then make it
    // self-suppress on the reboot), DISARM first, create the routine while no timer runs, then persist armed:true
    // by hitting the arm route — armCron()'s reconcile fires+claims the OLD one-shots, but the just-created one
    // is also fired+claimed; so instead we kill the process IMMEDIATELY after persisting and rely on the boot
    // reconcile. Simpler + fully deterministic: prove the boot-arm by the persisted flag + the "cron tick armed"
    // boot log (the timer genuinely armed at boot from the flag alone, no env var) — the runtime-arm phase above
    // already proved an armed timer ticks a due routine within one tick.
    const armForBoot = await j('POST', '/api/cron/arm', { enabled: true });   // (timer is currently disarmed)
    A.eq(armForBoot.status, 200, 're-arm before reboot -> 200');
    A.eq(JSON.parse(fs.readFileSync(ARMED_FILE, 'utf8')).armed, true, 'persisted armed:true before reboot');
    try { child.kill(); } catch (_) {} await sleep(250);
    // reboot WITHOUT SKYNET_CRON_ENABLED — only the persisted cronArmed flag should arm the scheduler.
    booted = await boot(port + 100, ws, 20, { SKYNET_CRON_TICK_MS: '300' });
    child = booted.child; port = booted.port; getOut = booted.out;
    await refreshToken();
    const bootList = await j('GET', '/api/cron');
    A.eq(bootList.body.enabled, true, 'ARM-AT-BOOT: persisted cronArmed:true -> enabled:true with no env var');
    await sleep(400);
    A.ok(getOut().indexOf('cron tick armed') >= 0, 'ARM-AT-BOOT: the timer armed at boot from the persisted flag alone (no env var)');
  } finally {
    try { child.kill(); } catch (_) {}
    await sleep(150);
    try { fs.rmSync(ws, { recursive: true, force: true }); } catch (_) {}
  }

  A.report('cron.arm.test');
})().catch(e => { console.log('FAIL: cron.arm.test threw — ' + (e && e.stack || e)); process.exit(1); });
