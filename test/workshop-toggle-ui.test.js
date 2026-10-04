/* node test/workshop-toggle-ui.test.js — the machine assertion the away-workshop toggle (ui/crew/ag-workshop-on,
   finding 3b7b52c8) was missing. The per-agent "Build things while I'm away" checkbox promises: flipping it
   records the Commander's grant server-side so the away loop dispatches workshop runs ONLY for granted agents.

   Three seams, tested at the honest level for each:

     1. THE STORE (durable grant) — a genuine behavior round-trip against the real workshop-store over an
        in-memory fs: setGrant(true) reads back true and SURVIVES a fresh store (restart-safe), setGrant(false)
        clears it. (This is the persisted truth the UI toggle must reach.)
     2. THE UI→ROUTE WIRE — source-locked: #ag-workshop-on calls access.config.setWorkshop, and app.setAgentWorkshop
        POSTs /api/workshop/grant, resolving off the REAL route result and REVERTING the local flag when the
        station did not record it (truthful telemetry — the toggle never asserts a grant the harness didn't store).

   HONESTLY OUT OF SCOPE: the away-loop DISPATCH half (a background cron/driver that reads the grant and fires a
   workshop shift) is not driven by any DOM sweep and is not exercised here — it stays covered by the away-driver
   lane's own e2e. This test guards that the toggle reaches durable, restart-safe, honestly-reverting grant truth. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const { makeWorkshopStore } = require('../sidecar/workshop-store.js');

/* ---- a tiny in-memory fs (mirrors workshop-store.test.js) ---- */
function memFs() {
  const files = new Map();
  return {
    _files: files,
    readFileSync(f) { if (!files.has(String(f))) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return files.get(String(f)); },
    writeFileSync(f, data) { files.set(String(f), String(data)); },
    renameSync(a, b) { files.set(String(b), files.get(String(a))); files.delete(String(a)); },
    existsSync(f) { return files.has(String(f)); },
    mkdirSync() {}, unlinkSync(f) { files.delete(String(f)); },
    openSync() { return 1; }, fsyncSync() {}, closeSync() {}
  };
}
const writeDurable = ({ fs }, file, data) => { fs.writeFileSync(file, data); };

/* ---- 1. THE STORE: grant round-trips and survives a restart (the durable truth the toggle reaches) ---- */
(async () => {
  const disk = memFs();
  const s1 = makeWorkshopStore({ fs: disk, path, workspaces: '/ws', writeDurable });
  A.ok(s1.hasGrant('nova') === false, 'a fresh agent defaults to NO away-workshop grant');
  await s1.setGrant('nova', true);
  A.ok(s1.hasGrant('nova') === true, 'setGrant(true) reads back granted');
  const s2 = makeWorkshopStore({ fs: disk, path, workspaces: '/ws', writeDurable });   // fresh store, same disk
  A.ok(s2.hasGrant('nova') === true, 'the grant SURVIVES a fresh store (restart-safe — the away loop reads real state)');
  await s2.setGrant('nova', false);
  A.ok(s2.hasGrant('nova') === false, 'flipping the toggle off clears the grant');
  const s3 = makeWorkshopStore({ fs: disk, path, workspaces: '/ws', writeDurable });
  A.ok(s3.hasGrant('nova') === false, 'the cleared grant also survives a restart');

  /* ---- 2. THE UI→ROUTE WIRE (source-lock) ---- */
  const app = f => fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', f), 'utf8');
  const ui = app('stationui.js'), appjs = app('app.js');

  A.ok(/id="ag-workshop-on"/.test(ui), 'the dossier renders the #ag-workshop-on away-workshop checkbox');
  A.ok(/aria-label="Build things while I am away"/.test(ui), 'the toggle carries an accessible name');
  A.ok(/#ag-workshop-on/.test(ui) && /access\.config\.setWorkshop\(/.test(ui), 'flipping the toggle calls access.config.setWorkshop');
  // truthful telemetry: the checkbox reverts if the station did not record the grant
  A.ok(/setWorkshop\(a && a\.id, next\)\)\.then\(ok =>/.test(ui) || /setWorkshop\([\s\S]{0,60}\)\)\.then\(ok =>/.test(ui), 'the toggle resolves off the REAL setWorkshop result (does not assume success)');

  const wm = /function setAgentWorkshop\(agentId, enabled\)\s*\{([\s\S]*?)\n  \}/.exec(appjs);
  A.ok(wm, 'app.js still defines setAgentWorkshop(agentId, enabled)');
  const wBody = wm ? wm[1] : '';
  A.ok(/a\.workshop = on/.test(wBody), 'setAgentWorkshop writes the local away-workshop flag');
  A.ok(/\/api\/workshop\/grant/.test(wBody) && /method: 'POST'/.test(wBody), 'setAgentWorkshop records the grant via POST /api/workshop/grant (the server AUTHORITY)');
  A.ok(/agentId: a\.id, on: on/.test(wBody), 'the grant POST carries the agentId + on flag');
  A.ok(/if \(!ok\)[\s\S]{0,80}a\.workshop = !on/.test(wBody), 'a grant the station did NOT record reverts the local flag (truthful telemetry)');
  A.ok(/pushRoster\(\)/.test(wBody) && /persist\(\)/.test(wBody), 'the grant updates the away-driver dossier (pushRoster) and persists');
  A.ok(/setWorkshop:\s*setAgentWorkshop/.test(appjs), 'setAgentWorkshop is exposed on access.config.setWorkshop');

  A.report('workshop-toggle-ui');
})();
