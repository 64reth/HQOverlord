#!/usr/bin/env node
/* dev/inbox-when-picker-shots.mjs — LIVE proof that the INBOX card's trigger zone speaks the SAME
 * schedule vocabulary as the AUTOMATION window (frontend/app/schedpicker.js).
 *
 * Before this lane the INBOX card asked for the schedule as three preset buttons + a free-text cron
 * field, so "every Tuesday at 9am" — which sidecar/cron.js has always parsed — was unreachable from
 * the place a beginner actually wires a line.
 *
 * Boots a seeded sidecar from THIS worktree against a LOCAL MOCK OpenRouter (zero spend), drives the
 * REAL app over CDP, stamps + crews a RESEARCH LINE, opens the INBOX flow card and proves, by
 * click only (never by typing a schedule):
 *   1. the picker is mounted and seeds a real schedule with a SERVER-computed next-fire preview;
 *   2. CERTAIN DAYS · Tue · 9:00 AM types `0 9 * * 2` into the same #trg-sched the form always posted;
 *   3. CUSTOM reveals that exact string (the graduation path, not a fallback);
 *   4. SAVE SCHEDULE persists it — GET /api/cron carries `cron 0 9 * * 2`, this line's dock, runsLine;
 *   5. ON A TIMER still writes an interval (the old preset vocabulary is not lost).
 *
 *   node dev/inbox-when-picker-shots.mjs      (ports: SKYNET_SHOT_PORT / SKYNET_CDP_PORT)
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { launchChrome, connectCDP, evalJS, capture, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '9486';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9487);
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.SKYNET_SHOT_OUT || join(process.cwd(), 'dev', '.shots-inbox-when');
const MODEL = 'test/model';
const NOCREW = !!process.env.SKYNET_SHOT_NOCREW;

function startMock() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      if (req.url.indexOf('/models') >= 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: MODEL, context_length: 32000, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] }] }));
        return;
      }
      res.writeHead(404); res.end('{}');
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, base: 'http://127.0.0.1:' + server.address().port + '/api/v1' }));
  });
}

async function main() {
  const mock = await startMock();
  const scratch = mkdtempSync(join(tmpdir(), 'inboxwhen-'));
  materializeSeedWorkspace(join(scratch, 'ws'), MODEL);
  const side = bootSeededSidecar({
    port: PORT, model: MODEL, key: 'sk-or-v1-inbox-when-mock', scratchDir: join(scratch, 'ws'),
    env: { SKYNET_OPENROUTER_BASE: mock.base, STARNET_OPENROUTER_BASE: mock.base }
  });
  let chrome = null, cdp = null;
  const report = {};
  const fails = [];
  try {
    if (!(await waitUp(URL))) throw new Error('sidecar never came up on ' + URL);
    chrome = launchChrome({ cdpPort: CDP_PORT, win: '1560,1060', profileDir: join(scratch, 'chrome') });
    await sleep(1200);
    cdp = await connectCDP(CDP_PORT);
    await cdp.send('Runtime.enable');
    const diag = collectDiagnostics(cdp);
    await evalJS(cdp, `location.href = ${JSON.stringify(URL)}`);
    if (!(await waitDevReady(cdp, evalJS, { url: URL }))) throw new Error('app never reached the game screen');
    await sleep(1800);
    mkdirSync(OUT, { recursive: true });

    /* ---- 1. stamp a RESEARCH LINE and crew its entry dock ---- */
    const built = await evalJS(cdp, `(() => {
      // A fresh empty workroom keeps this scheduler proof independent of the evolving demo layout.
      const st = WorldModel.create();
      const room = st.addRoom({ kind: 'hab', rect: { x1: 30, y1: 0, x2: 82, y2: 27 } });
      if (!room.ok) return { err: 'fixture-room', result: room };
      Build.init({ getStation: () => st, persist: () => {}, world: World, agents: () => App.agents() });
      if (!Build.isOpen()) Build.open();
      const card = document.querySelector('.refit-firstrun');
      if (card) { const go = card.querySelector('#refit-guide-go'); if (go) go.click(); }
      for (const b of st.belts()) st.removeBelt(b.x, b.y);
      const WF = { intake:1, bay:1, outbox:1, filter:1, splitter:1, merger:1 };
      for (const p of st.props().slice()) if (WF[p.t]) st.removeProp(p.id);
      const bnd = st.bounds();
      let spot = null;
      for (let ty = bnd.minTy - 2; ty <= bnd.maxTy + 2 && !spot; ty++)
        for (let tx = bnd.minTx - 2; tx <= bnd.maxTx + 2 && !spot; tx++)
          if (st.canPlaceBlueprint('research_line', tx, ty).ok) spot = { tx, ty };
      if (!spot) return { err: 'no-spot' };
      const res = st.stampBlueprint('research_line', spot.tx, spot.ty);
      if (!res || !res.ok) return { err: 'stamp-failed' };
      const ok = document.querySelector('.tut-coach-ok'); if (ok) ok.click();
      const bays = st.props().filter(p => p.t === 'bay').sort((a, b) => a.x - b.x);
      const r1 = ${process.env.SKYNET_SHOT_NOCREW ? 'null' : `st.assignPropAgent(bays[0].id, 'agent')`};
      return { spot, entry: r1 && r1.agentId, bays: bays.map(b => b.id), inbox: (st.props().find(p => p.t === 'intake') || {}).id };
    })()`);
    console.log('STAMP+CREW:', JSON.stringify(built));
    if (!built || built.err || !built.inbox || (!built.entry && !NOCREW)) throw new Error('setup failed: ' + JSON.stringify(built));
    report.setup = built;

    /* ---- THE UNCREWED LINE (SKYNET_SHOT_NOCREW=1) — the DELIBERATE guard, pinned so nobody "fixes" it.
       A routine fires AT an agent, so a line whose docks hold nobody cannot take one: CREATE ROUTINE is
       disabled and the card states the reason above it. Confirmed intended by Andrew 2026-08-14 after he
       hit it on an uncrewed line. What this asserts is that the refusal is EXPLAINED, never bare. ---- */
    if (NOCREW) {
      const dead = JSON.parse(await evalJS(cdp, `JSON.stringify((() => {
        document.querySelectorAll('.refit-flow-card,.refit-step-card').forEach(n => n.remove());
        Build.openAssign(${JSON.stringify(built.inbox)});
        const g = document.querySelector('.refit-flow-card');
        g.querySelector('#trg-new').click();
        const p = g.querySelector('#trg-prompt');
        p.value = 'summarize the week\\u2019s AI-policy news';
        p.dispatchEvent(new Event('input', { bubbles: true }));
        const btn = g.querySelector('#trg-create');
        const before = { disabled: btn.disabled, label: btn.textContent.trim(), sched: g.querySelector('#trg-sched').value };
        btn.click();
        const msg = g.querySelector('#trg-msg');
        return { before, msgShown: msg.style.display !== 'none', msg: msg.textContent.trim(),
                 notes: [...g.querySelectorAll('.refit-note')].map(n => n.textContent.trim()),
                 // the picker must still work on an uncrewed line — the WHEN half is not what is missing
                 modes: [...g.querySelectorAll('.sp-mode')].length };
      })())`));
      console.log('UNCREWED:', JSON.stringify(dead, null, 2));
      report.uncrewed = dead;
      report.shotUncrewed = (await capture(cdp, OUT, 'inbox-uncrewed-line')).path;
      report.consoleErrors = diag.consoleMsgs.filter(m => m.level === 'error').slice(0, 10);
      console.log('\n===== REPORT =====\n' + JSON.stringify(report, null, 2));
      const bad = [];
      if (!dead.before.disabled) bad.push('CREATE ROUTINE is clickable on an uncrewed line — a routine has no agent to fire at');
      if (!dead.notes.some(n => /Assign an agent to a connected Bay first/.test(n))) bad.push('the card does not say WHY it refuses (notes: ' + JSON.stringify(dead.notes) + ')');
      if (dead.modes !== 6) bad.push('the WHEN picker did not mount on an uncrewed line (' + dead.modes + ' cadence keys)');
      if (dead.before.sched !== '0 9 * * *') bad.push('the picker did not seed a schedule on an uncrewed line (' + JSON.stringify(dead.before.sched) + ')');
      if (bad.length) throw new Error('UNCREWED PATH FAILED:\n  - ' + bad.join('\n  - '));
      console.log('\nUNCREWED PATH: PASS — refusal is explained, picker still works');
      return;
    }

    /* ---- 2. open the INBOX card and the create form ---- */
    const opened = await evalJS(cdp, `(() => {
      document.querySelectorAll('.refit-flow-card,.refit-step-card').forEach(n => n.remove());
      Build.openAssign(${JSON.stringify(built.inbox)});
      const g = document.querySelector('.refit-flow-card');
      if (!g) return { err: 'no flow card' };
      const newBtn = g.querySelector('#trg-new');
      newBtn.click();
      const form = g.querySelector('#trg-form');
      return {
        intakeClass: g.className,
        formOpen: form.style.display !== 'none',
        startChoiceSelected: newBtn.classList.contains('active') && newBtn.getBoundingClientRect().height > 0,
        ariaExpanded: newBtn.getAttribute('aria-expanded'),
        modes: [...g.querySelectorAll('.sp-mode')].map(b => b.textContent.trim()),
        seeded: (g.querySelector('#trg-sched') || {}).value
      };
    })()`);
    console.log('CARD OPEN:', JSON.stringify(opened));
    report.open = opened;
    if (opened.err) throw new Error(opened.err);
    if (opened.modes.length !== 6) fails.push('the WHEN picker did not mount on the INBOX card (cadence keys: ' + JSON.stringify(opened.modes) + ')');
    if (opened.seeded !== '0 9 * * *') fails.push('the picker did not seed a default schedule into #trg-sched (got ' + JSON.stringify(opened.seeded) + ')');
    if (!opened.formOpen || !opened.startChoiceSelected) fails.push('the schedule form does not retain its selected start choice');

    // the preview is the SERVER's answer to "when" (debounced 300ms + a round trip) — poll for it
    const waitPreview = async () => {
      let t = '';
      for (let i = 0; i < 25; i++) {
        t = (await evalJS(cdp, `document.querySelector('#trg-preview').textContent.trim()`)) || '';
        if (t) return t;
        await sleep(200);
      }
      return t;
    };
    report.seedPreview = await waitPreview();
    console.log('SEED PREVIEW:', report.seedPreview);
    if (!/next:/.test(report.seedPreview || '')) fails.push('no server-computed next-fire for the seeded default (preview: ' + JSON.stringify(report.seedPreview) + ')');

    /* ---- 3. CLICK-ONLY: certain days · Tuesday · 9:00 AM ---- */
    const weekly = await evalJS(cdp, `(() => {
      const g = document.querySelector('.refit-flow-card');
      const modeBtn = [...g.querySelectorAll('.sp-mode')].find(b => b.dataset.mode === 'weekly');
      modeBtn.click();
      // clear whatever weekday the picker seeded (today), then pick Tuesday only
      [...g.querySelectorAll('.sp-day')].forEach(b => { if (b.classList.contains('on')) b.click(); });
      g.querySelector('.sp-day[data-day="2"]').click();
      const set = (f, v) => { const el = g.querySelector('[data-f="' + f + '"]'); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); };
      set('hour', '9'); set('minute', '0'); set('ampm', 'AM');
      return { sched: g.querySelector('#trg-sched').value, note: (g.querySelector('[data-sp-note]') || {}).textContent };
    })()`);
    console.log('WEEKLY:', JSON.stringify(weekly));
    report.weekly = weekly;
    if (weekly.sched !== '0 9 * * 2') fails.push('CERTAIN DAYS · Tue · 9:00 AM wrote ' + JSON.stringify(weekly.sched) + ', expected "0 9 * * 2"');

    report.weeklyPreview = await waitPreview();
    console.log('WEEKLY PREVIEW:', report.weeklyPreview);
    if (!/next:/.test(report.weeklyPreview || '')) fails.push('no server-computed next-fire for the weekly pick');

    // CUSTOM must REVEAL the same string (graduation, not fallback)
    const custom = await evalJS(cdp, `(() => {
      const g = document.querySelector('.refit-flow-card');
      [...g.querySelectorAll('.sp-mode')].find(b => b.dataset.mode === 'advanced').click();
      const inp = g.querySelector('#trg-sched');
      return { visible: inp.offsetHeight > 0, value: inp.value };
    })()`);
    console.log('CUSTOM:', JSON.stringify(custom));
    report.custom = custom;
    if (!custom.visible || custom.value !== '0 9 * * 2') fails.push('CUSTOM did not reveal the built expression (' + JSON.stringify(custom) + ')');

    report.shotPicker = (await capture(cdp, OUT, 'inbox-when-picker')).path;

    /* ---- 4. create it, then read the SERVER back ---- */
    const created = await evalJS(cdp, `(() => {
      const g = document.querySelector('.refit-flow-card');
      [...g.querySelectorAll('.sp-mode')].find(b => b.dataset.mode === 'weekly').click();
      const p = g.querySelector('#trg-prompt');
      p.value = 'summarize the week\\u2019s AI-policy news';
      p.dispatchEvent(new Event('input', { bubbles: true }));
      g.querySelector('#trg-create').click();
      return { sched: g.querySelector('#trg-sched').value };
    })()`);
    console.log('CREATE CLICKED:', JSON.stringify(created));
    await sleep(1600);
    report.createMsg = await evalJS(cdp, `document.querySelector('#trg-msg').textContent.trim()`);
    console.log('CREATE MSG:', report.createMsg);
    report.shotCreated = (await capture(cdp, OUT, 'inbox-routine-created')).path;

    const server = JSON.parse(await evalJS(cdp, `fetch('/api/cron').then(r => r.json()).then(j => JSON.stringify({
      jobs: (j.jobs || []).map(x => ({ id: x.id, name: x.name, agentId: x.agentId, display: x.scheduleDisplay, enabled: x.enabled, runsLine: x.runsLine, next: x.nextRunAt })) }))`));
    console.log('SERVER JOBS:', JSON.stringify(server, null, 2));
    report.serverJobs = server.jobs;
    const mine = (server.jobs || []).filter(j => /AI-policy/.test(j.name || ''));
    if (mine.length !== 1) fails.push('expected exactly 1 persisted routine from this card, got ' + mine.length);
    else {
      const j = mine[0];
      if (!/0 9 \* \* 2/.test(j.display || '')) fails.push('the persisted schedule is ' + JSON.stringify(j.display) + ', not the picked "0 9 * * 2"');
      if (j.agentId !== built.entry) fails.push('the routine fires at ' + j.agentId + ', not this line\'s crewed dock ' + built.entry);
      if (!j.runsLine) fails.push('the routine created on the INBOX card is not marked as this LINE\'s trigger (runsLine falsy)');
      if (!j.next) fails.push('the server computed no next fire for the created routine');
      report.persisted = j;
    }

    /* ---- 4b. the row states the cadence as a SENTENCE, with the raw expression one hover away ---- */
    report.row = JSON.parse(await evalJS(cdp, `JSON.stringify((() => {
      const r = document.querySelector('#trg-routines .trg-row');
      if (!r) return { err: 'no routine row' };
      const meta = r.querySelector('.trg-row-meta');
      return { text: r.textContent.replace(/\\s+/g, ' ').trim(), title: (meta && meta.querySelector('[title]') || {}).title || '' };
    })())`));
    console.log('ROW:', JSON.stringify(report.row));
    // the WHEN preview must still describe the schedule the picker still holds (a create clears the brief,
    // not the cadence) — blanking it left the form looking unset while it was armed on the same cadence
    report.previewAfterCreate = await evalJS(cdp, `document.querySelector('#trg-preview').textContent.trim()`);
    console.log('PREVIEW AFTER CREATE:', report.previewAfterCreate);
    if (!/next:/.test(report.previewAfterCreate || '')) fails.push('the WHEN preview went blank after CREATE while the picker still held that schedule');
    if (!/every Tuesday at 9:00 AM/.test(report.row.text || '')) fails.push('the routine row does not state the cadence in words (' + JSON.stringify(report.row.text) + ')');
    if (report.row.title !== 'cron 0 9 * * 2') fails.push('the raw expression is not preserved on hover (title: ' + JSON.stringify(report.row.title) + ')');
    report.shotRow = (await capture(cdp, OUT, 'inbox-routine-row')).path;

    /* ---- 4c. DIAGNOSTIC (report-only): does the TRIGGERS list distinguish a routine that runs the whole
       LINE from one that only answers at its dock? `runsLine` is the durable opt-in only this card sets
       (index.js:4356 — absent ⇒ lineId null ⇒ the chain never advances), so a routine made in AUTOMATION
       against the same agent is TERMINAL. Post one and read the list back. ---- */
    await evalJS(cdp, `fetch('/api/cron', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'MADE IN AUTOMATION — terminal', prompt: 'check the feeds', schedule: 'every 1h', agentId: ${JSON.stringify(built.entry)} }) }).then(r => r.text())`);
    await evalJS(cdp, `(() => {
      document.querySelectorAll('.refit-flow-card').forEach(n => n.remove());
      Build.openAssign(${JSON.stringify(built.inbox)});
      document.querySelector('.refit-flow-card #trg-new').click();   // re-open the form for the FIT checks below
      return true;
    })()`);
    await sleep(1400);
    report.mixedList = JSON.parse(await evalJS(cdp, `JSON.stringify({
      rows: [...document.querySelectorAll('#trg-routines .trg-row')].map(r => r.textContent.replace(/\\s+/g, ' ').trim()),
      server: null })`));
    report.mixedList.server = JSON.parse(await evalJS(cdp, `fetch('/api/cron').then(r => r.json()).then(j => JSON.stringify(
      (j.jobs || []).map(x => ({ name: x.name, runsLine: x.runsLine === true }))))`));
    console.log('MIXED TRIGGER LIST:', JSON.stringify(report.mixedList, null, 2));
    /* REPORT-ONLY FINDING (2026-08-14, proven here): the server hands us `runsLine` per job, and the two
       rows render IDENTICALLY under a heading that reads "TRIGGERS — WHY THIS LINE RUNS". A routine made
       in AUTOMATION against the same dock is TERMINAL (index.js:4356 — no runsLine ⇒ lineId null ⇒
       chainNext refuses to advance), so the card presents a dock-only job as a line trigger. Left as a
       measurement, not an assertion, until Andrew rules on how to say it. */
    report.runsLineTruth = report.mixedList.server.map(j => j.name + ' → runsLine ' + j.runsLine);
    console.log('SERVER TRUTH PER JOB:', JSON.stringify(report.runsLineTruth));
    console.log('ROWS AS RENDERED  :', JSON.stringify(report.mixedList.rows));

    /* ---- 5. the old preset vocabulary is still reachable (ON A TIMER) ---- */
    const timer = await evalJS(cdp, `(() => {
      const g = document.querySelector('.refit-flow-card');
      [...g.querySelectorAll('.sp-mode')].find(b => b.dataset.mode === 'interval').click();
      const el = g.querySelector('[data-f="every"]'); el.value = '30';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      const u = g.querySelector('[data-f="unit"]'); u.value = 'm';
      u.dispatchEvent(new Event('change', { bubbles: true }));
      return g.querySelector('#trg-sched').value;
    })()`);
    console.log('TIMER:', JSON.stringify(timer));
    report.timer = timer;
    if (timer !== 'every 30m') fails.push('ON A TIMER · 30 minutes wrote ' + JSON.stringify(timer) + ', expected "every 30m"');

    // the card must not spill out of the glass now that it carries a form
    report.fit = JSON.parse(await evalJS(cdp, `JSON.stringify((() => {
      const g = document.querySelector('.refit-flow-card'), c = g.querySelector('.refit-guide-card');
      const gr = g.getBoundingClientRect(), cr = c.getBoundingClientRect();
      return { cardH: Math.round(cr.height), glassH: Math.round(gr.height), top: Math.round(cr.top), bottom: Math.round(cr.bottom),
               scrolls: c.scrollHeight > c.clientHeight + 1, width: Math.round(cr.width) };
    })())`));
    console.log('FIT:', JSON.stringify(report.fit));
    if (report.fit.top < 0 || report.fit.bottom > report.fit.glassH + 1) fails.push('the INBOX card spills outside the REFIT glass (' + JSON.stringify(report.fit) + ')');

    /* ---- 6. A SHORT WINDOW MUST KEEP SAVE REACHABLE AND DONE VISIBLE. The refreshed editor scrolls
       its body while the heading and footer stay in place. Exercise the real schedule form. */
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 820, deviceScaleFactor: 1, mobile: false });
    await sleep(900);
    report.fitShort = JSON.parse(await evalJS(cdp, `JSON.stringify((() => {
      const g = document.querySelector('.refit-flow-card'), c = g.querySelector('.refit-guide-card');
      const gr = g.getBoundingClientRect(), cr = c.getBoundingClientRect();
      const body = c.querySelector('.workflow-body'), save = c.querySelector('#trg-create');
      save.scrollIntoView({ block: 'center' });
      const btnAfter = save.getBoundingClientRect(), br = body.getBoundingClientRect();
      const done = c.querySelector('#flow-ok').getBoundingClientRect();
      return { cardH: Math.round(cr.height), glassH: Math.round(gr.height), top: Math.round(cr.top), bottom: Math.round(cr.bottom),
               scrolls: body.scrollHeight > body.clientHeight + 1,
               createReachable: btnAfter.top >= br.top - 1 && btnAfter.bottom <= br.bottom + 1,
               doneVisible: done.top >= gr.top && done.bottom <= gr.bottom };
    })())`));
    console.log('FIT (short window):', JSON.stringify(report.fitShort));
    if (report.fitShort.bottom > report.fitShort.glassH + 1 || report.fitShort.top < -1) fails.push('on a short window the card still spills outside the glass (' + JSON.stringify(report.fitShort) + ')');
    if (!report.fitShort.scrolls) fails.push('the setup body did not become scrollable on a short window');
    if (!report.fitShort.createReachable) fails.push('SAVE SCHEDULE cannot be scrolled into view on a short window');
    if (!report.fitShort.doneVisible) fails.push('DONE is not visible on a short window');
    report.shotShort = (await capture(cdp, OUT, 'inbox-card-short-window')).path;
    await cdp.send('Emulation.clearDeviceMetricsOverride', {});

    report.consoleErrors = diag.consoleMsgs.filter(m => m.level === 'error').slice(0, 10);
    report.exceptions = diag.exceptions.slice(0, 10);
    if (report.exceptions.length) fails.push('page exceptions: ' + JSON.stringify(report.exceptions));
    console.log('\n===== REPORT =====\n' + JSON.stringify(report, null, 2));
    if (fails.length) throw new Error('LIVE PROOF FAILED:\n  - ' + fails.join('\n  - '));
    console.log('\nLIVE PROOF: PASS');
  } finally {
    try { if (cdp) cdp.close(); } catch {}
    try { if (chrome) chrome.proc ? chrome.proc.kill() : chrome.kill(); } catch {}
    try { side.kill(); } catch {}
    try { mock.server.close(); } catch {}
  }
}

main().then(() => process.exit(0), e => { console.error(String(e && e.stack || e)); process.exit(1); });
