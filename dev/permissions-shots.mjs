#!/usr/bin/env node
/* dev/permissions-shots.mjs — live proof for SETTINGS › PERMISSIONS after the plain-language pass.
 *
 * Boots a seeded sidecar from THIS worktree and drives the REAL app over CDP (the established
 * headless pattern — dev/abilities-shots.mjs / scripts/lib/cdp.mjs). The preview pane clamps
 * background timers, so any click→await→assert chain has to run here rather than through the
 * preview MCP.
 *
 * It captures the pane AND round-trips every control against the live model:
 *   - the glance sentence is COUNTED from App.agents(), not a fixed string
 *   - one crew row per agent carries BOTH axes (reach chips + asks-first chips)
 *   - a reach flip writes agent.executionProfile
 *   - an ASKS FIRST escalation ARMS without granting (one press must not change the model)
 *   - the whole-station sweeps still move every agent
 *
 *   node dev/permissions-shots.mjs
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { launchChrome, connectCDP, evalJS, capture, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '9644';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9645);
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.SKYNET_SHOT_OUT || join(process.cwd(), 'dev', '.shots-permissions');

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))); }
};

/* ⛔ PREFLIGHT — this repo is built by 7–10 agents at once, each running its own sidecar on its own
   port. If something is ALREADY listening here, bootSeededSidecar's bind fails, `waitUp` cheerfully
   answers true against the SQUATTER, and every assertion below silently measures another lane's app.
   That is exactly what happened on 2026-08-07 (port 9654 was the dossier-ux worktree): 11 "failures"
   that were really someone else's pane. A live-proof harness that can measure the wrong process is
   worse than no harness — so refuse to start rather than produce confident nonsense. */
function portFree(port) {
  return new Promise(resolve => {
    const s = createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(Number(port), '127.0.0.1');
  });
}

async function main() {
  for (const [label, port] of [['sidecar', PORT], ['CDP', CDP_PORT]]) {
    if (!(await portFree(port))) {
      throw new Error(`port ${port} (${label}) is already in use — another agent's station is probably there.\n` +
        `  This harness would have measured THAT app, not this worktree's build.\n` +
        `  Re-run with a free pair, e.g. SKYNET_SHOT_PORT=<free> SKYNET_CDP_PORT=<free+1> node dev/permissions-shots.mjs`);
    }
  }
  const scratch = mkdtempSync(join(tmpdir(), 'permshots-'));
  materializeSeedWorkspace(join(scratch, 'ws'));
  const side = bootSeededSidecar({ port: PORT, scratchDir: join(scratch, 'ws') });
  let chrome = null, cdp = null;
  try {
    if (!(await waitUp(URL))) throw new Error('sidecar never came up on ' + URL);
    // Second belt: prove the served bundle is THIS worktree's build before believing any measurement.
    const marker = await (await fetch(URL + 'app/stationui.js')).text();
    if (!marker.includes('id="perm-postures"')) {
      throw new Error('the app served on ' + URL + ' is not this worktree\'s build (no posture front door) — ' +
        'refusing to measure a station this harness did not boot');
    }
    chrome = launchChrome({ cdpPort: CDP_PORT, profileDir: join(scratch, 'chrome') });
    await sleep(1200);
    cdp = await connectCDP(CDP_PORT);
    await cdp.send('Runtime.enable');
    const diag = collectDiagnostics(cdp);
    await evalJS(cdp, `location.href = ${JSON.stringify(URL)}`);
    if (!(await waitDevReady(cdp, evalJS, { url: URL }))) throw new Error('app never reached the game screen');
    await sleep(1500);
    mkdirSync(OUT, { recursive: true });
    await evalJS(cdp, `(() => { if (document.body) document.body.classList.add('no-flicker');
      if (typeof World !== 'undefined' && World.stop) { World.stop(); return 'frozen'; } return 'no-world'; })()`);

    await evalJS(cdp, `StationUI.openTerm('settings','permissions')`);
    await sleep(2200);   // the pane fetches /api/execution-profiles + refreshes PermissionsStore

    /* ── THE THREE TIERS ────────────────────────────────────────────────────────────────────────
       What a newcomer meets on arrival: the glance, three station-wide postures, and the per-agent
       rows — with only the rare controls folded. Tier 2 being VISIBLE is the point of round 3, so
       the harness asserts it rather than assuming it. `frontWords` is the tier-1 reading cost (the
       decision a newcomer actually has to make); `arrivalWords` is everything on screen. */
    console.log('\n— THE THREE TIERS —');
    const front = await evalJS(cdp, `(() => {
      const glance = document.querySelector('#perm-glance');
      const crewHead = [...document.querySelectorAll('.ms-h')].find(h => /EACH CREW MEMBER/.test(h.textContent));
      const fold = document.querySelector('#perm-advanced');
      const span = (from, to) => { let n = from, out = []; while (n && n !== to) { out.push(n); n = n.nextElementSibling; } return out; };
      const words = els => els.map(e => e.innerText).join(' ').replace(/\\s+/g,' ').trim().split(' ').filter(Boolean).length;
      const tier1 = span(glance, crewHead);
      const all = span(glance, fold).concat([fold]);
      const tier1Txt = tier1.map(e => e.innerText).join(' ').replace(/\\s+/g,' ').trim();
      const jargon = ['STATION GEAR','SAFE CELL','REMOTE SSH','TRUSTED PROJECT','execution profile',
        'STANDING APPROVALS','desktop lease','Docker','capability','/yolo','block 2'];
      // Tier 2 deliberately prints the HOUSE name — but only ever as a subtitle under a plain label,
      // so the vocabulary is taught rather than assumed. Prove that pairing instead of banning the word.
      const unpairedHouse = [...document.querySelectorAll('.pc-reach-chip')]
        .filter(c => !c.querySelector('.pc-rl') || !c.querySelector('.pc-rh'))
        .map(c => c.textContent.trim());
      return {
        foldClosed: !fold.open,
        cards: [...document.querySelectorAll('.pp-card .pp-name')].map(e => e.innerText),
        crewVisible: !!crewHead && !crewHead.closest('details') && !!document.querySelector('#perm-crew .perm-crew-row'),
        frontWords: words(tier1),
        arrivalWords: all.map(e => e.innerText).join(' ').replace(/\\s+/g,' ').trim().split(' ').length,
        tier1Jargon: jargon.filter(j => new RegExp(j.replace(/[()\\/]/g,'\\\\$&'),'i').test(tier1Txt)),
        unpairedHouse: unpairedHouse
      };
    })()`);
    check('only the ADVANCED tier is folded on arrival', front.foldClosed, JSON.stringify(front.foldClosed));
    check('three station-wide postures are offered', front.cards.length === 3, front.cards.join(' · '));
    // TIER 2 IS NOT BEHIND A DISCLOSURE. A posture can only set every agent the SAME way, so the
    // "except this one" control has to be on screen — hiding it was the round-2 over-correction.
    check('the per-agent crew rows are VISIBLE, not folded', front.crewVisible, front.crewVisible);
    check('the tier-1 decision costs under 200 words to read', front.frontWords < 200, front.frontWords + ' words');
    // The DECISION a newcomer must make has to be jargon-free. Tier 2 may print house names, but only
    // paired with a plain label — the pairing is what teaches the vocabulary instead of assuming it.
    check('the tier-1 decision carries no undecodable house vocabulary', front.tier1Jargon.length === 0, front.tier1Jargon.join(', ') || 'none');
    check('every house name in tier 2 is paired with a plain label', front.unpairedHouse.length === 0, front.unpairedHouse);
    console.log('   arrival cost: ' + front.frontWords + ' words to decide · ' + front.arrivalWords + ' words on screen');
    console.log('shot', await capture(cdp, OUT, 'permissions-00-front-door'));

    await evalJS(cdp, `(() => { document.querySelector('#perm-advanced').open = true; return true; })()`);
    await sleep(600);

    console.log('\n— STRUCTURE —');
    const shape = await evalJS(cdp, `(() => {
      const q = s => document.querySelector(s);
      const rows = [...document.querySelectorAll('#perm-crew .perm-crew-row')];
      const agents = (App.agents() || []);
      return {
        heads: [...document.querySelectorAll('#con-pane-permissions .ms-h, .con-pane .ms-h')]
          .map(h => h.textContent.trim().split(' — ')[0]).filter(t => /^[0-9] · /.test(t)),
        // the four sections must still EXIST inside the fold — dropping the numbers must not drop a section
        foldSections: [...document.querySelectorAll('#perm-advanced .ms-h')].map(h => h.textContent.trim().split(' — ')[0].trim()),
        // every real PERMISSION must be reachable WITHOUT opening a disclosure
        visibleSections: [...document.querySelectorAll('.con-pane .ms-h')]
          .filter(h => !h.closest('details')).map(h => h.textContent.trim().split(' — ')[0].trim()),
        policyInAdvancedFold: !!q('#perm-advanced #exec-idle-min'),
        glance: (q('#perm-glance .pg-line') || {}).textContent,
        glanceReach: (q('#perm-glance .pg-reach') || {}).textContent,
        glanceFloor: !!q('#perm-glance .pg-floor'),
        rows: rows.length,
        agents: agents.length,
        deadLists: [!!q('#perm-execution'), !!q('#perm-approval')],
        perRow: rows.map(r => ({
          name: (r.querySelector('.pa-name') || {}).textContent,
          mode: (r.querySelector('.pa-mode') || {}).textContent,
          questions: [...r.querySelectorAll('.pc-q')].map(x => x.textContent),
          reachChips: [...r.querySelectorAll('[data-perm-profile]')].map(c => c.textContent.trim()),
          reachSel: (r.querySelector('[data-perm-profile].sel') || {}).dataset?.permProfile,
          askChips: [...r.querySelectorAll('[data-ap-flip]')].map(c => c.textContent.trim()),
          askSel: (r.querySelector('[data-ap-flip].sel') || {}).dataset?.apTo,
          truth: (r.querySelector('.pc-truth') || {}).textContent,
          plain: [...r.querySelectorAll('.pc-plain')].map(p => p.textContent.slice(0, 60))
        })),
        advancedClosed: (() => { const d = q('#perm-advanced'); return d ? !d.open : 'missing'; })(),
        policyInAdvanced: !!q('#perm-advanced #exec-idle-min')
      };
    })()`);
    console.log(JSON.stringify(shape, null, 1));
    // the numbered blocks are GONE — a newcomer no longer walks four of them in order, and nothing
    // cross-references 'block 2' any more. What must survive is the four SECTIONS inside the fold.
    check('no numbered blocks survive', shape.heads.length === 0, shape.heads);
    // ADVANCED now holds exactly one thing: the idle-cell maintenance knob.
    check('the idle-cell policy is inside ADVANCED', shape.policyInAdvancedFold, shape.policyInAdvancedFold);
    // ONLY maintenance is folded. A permission behind a disclosure is a permission nobody finds — the
    // override outranks every crew row, and a standing grant you cannot see is not really revocable.
    check('every real permission is visible without opening anything',
      ['EACH CREW MEMBER', 'SKIP EVERY PROMPT', 'WHILE YOU’RE AWAY', 'STANDING APPROVALS']
        .every(h => shape.visibleSections.includes(h)), shape.visibleSections);
    check('ADVANCED holds no permission sections', shape.foldSections.length === 0, shape.foldSections);
    check('one crew row per agent', shape.rows === shape.agents && shape.rows > 0, [shape.rows, shape.agents]);
    check('the two old crew lists are gone', shape.deadLists.every(x => x === false), shape.deadLists);
    // the ASKS FIRST question carries an '— OVERRIDDEN BY …' suffix whenever the master switch is on
    // (this seed forces it on), so match the question STEM, never the whole decorated label.
    check('every row asks both questions', shape.perRow.every(r =>
      r.questions.length === 2 && /^CAN REACH$/.test(r.questions[0]) && /^ASKS FIRST/.test(r.questions[1])), shape.perRow.map(r => r.questions));
    check('every row offers 5 reach chips + 2 ask chips', shape.perRow.every(r => r.reachChips.length === 5 && r.askChips.length === 2));
    check('exactly one reach chip and one ask chip is selected', shape.perRow.every(r => r.reachSel && r.askSel));
    check('the routing truth line survives', shape.perRow.every(r => /routes next command to/.test(r.truth || '')));
    // The "was it closed?" half of this is asserted UP TOP, before the harness opens the fold itself
    // (front.foldClosed) — re-asserting it here after opening was checking the harness, not the pane.
    check('the idle-cell policy lives inside the advanced fold', shape.policyInAdvanced, shape.policyInAdvanced);
    check('the glance card carries the standing floor', shape.glanceFloor);

    /* The glance sentence must be COUNTED from the roster, not asserted. The dev seed boots with
       SKYNET_FULL_ACCESS=1, which pins the override ON — and the override branch legitimately
       outranks the per-agent count. So drive BOTH branches: read the pinned sentence as shipped,
       then temporarily report the switch OFF through the store the panel actually reads and repaint
       via the SAME hook a SUMMON uses, so the counted branch is exercised on real roster data. */
    console.log('\n— GLANCE IS COUNTED, NOT ASSERTED —');
    const glanceProbe = await evalJS(cdp, `(() => {
      const line = () => (document.querySelector('#perm-glance .pg-line') || {}).textContent || '';
      const loud = () => document.querySelector('#perm-glance').classList.contains('loud');
      const out = { envPinned: line(), envLoud: loud(), n: (App.agents() || []).length };
      // stub only the SNAPSHOT the panel reads; every repaint below is driven by a REAL click.
      const real = PermissionsStore.snapshot;
      PermissionsStore.snapshot = () => Object.assign({}, real(), { masterBypass: false, envFullAccess: false });
      document.querySelector('#perm-ask-all').click();
      out.allAsk = line(); out.allAskLoud = loud();
      const full = document.querySelector('#perm-full-all');
      full.click(); full.click();                      // arm + confirm the whole-station escalation
      out.allFull = line();
      document.querySelector('#perm-ask-all').click();
      PermissionsStore.snapshot = real;
      document.querySelector('#perm-ask-all').click();
      out.restored = line();
      window.__permReal = real;
      return out;
    })()`);
    console.log(JSON.stringify(glanceProbe, null, 1));
    check('the override branch says the override is ON, loudly', /the SKIP EVERY PROMPT switch is ON/.test(glanceProbe.envPinned) && glanceProbe.envLoud, glanceProbe);
    check('with the override off the sentence COUNTS the roster',
      /asks? you before anything risky/.test(glanceProbe.allAsk) && glanceProbe.allAsk !== glanceProbe.envPinned, glanceProbe);
    check('flipping the crew changes the counted sentence', glanceProbe.allFull !== glanceProbe.allAsk, glanceProbe);
    check('the singular sentence agrees with itself', /Your one crew member stops and asks you/.test(glanceProbe.allAsk), glanceProbe);

    /* SUMMON a second agent through the real path. Two things to prove at once: the panel repaints
       itself when the roster changes under it (a panel painted from the roster owes a repaint hook),
       and the PLURAL + MIXED sentence branches, which one seeded agent can never exercise. */
    console.log('\n— SUMMON: THE PANE REPAINTS, AND THE PLURAL BRANCHES —');
    const plural = await evalJS(cdp, `(() => {
      const line = () => (document.querySelector('#perm-glance .pg-line') || {}).textContent || '';
      const rows = () => document.querySelectorAll('#perm-crew .perm-crew-row').length;
      const out = { rowsBefore: rows() };
      App.summonAgent({ name: 'CIPHER', agentName: 'CIPHER' });
      out.agentsAfterSummon = (App.agents() || []).length;
      out.rowsAfterSummon = rows();
      const real = window.__permReal;
      PermissionsStore.snapshot = () => Object.assign({}, real(), { masterBypass: false, envFullAccess: false });
      document.querySelector('#perm-ask-all').click();
      out.pluralAllAsk = line();
      // flip exactly ONE of the two through its own row chip → the MIXED branch
      const chip = document.querySelectorAll('#perm-crew .perm-crew-row')[0].querySelector('[data-ap-flip][data-ap-to="full"]');
      chip.click(); chip.click();
      out.mixed = line();
      out.modes = (App.agents() || []).map(a => a.approvalMode || 'ask');
      const fullAll = document.querySelector('#perm-full-all');
      fullAll.click(); fullAll.click();
      out.pluralAllFull = line();
      document.querySelector('#perm-ask-all').click();
      PermissionsStore.snapshot = real;
      document.querySelector('#perm-ask-all').click();
      return out;
    })()`);
    console.log(JSON.stringify(plural, null, 1));
    check('a SUMMON repaints the open crew list', plural.rowsAfterSummon === plural.agentsAfterSummon && plural.rowsAfterSummon === plural.rowsBefore + 1, plural);
    check('the plural sentence agrees', /All 2 of your crew stop and ask you before anything risky\./.test(plural.pluralAllAsk), plural);
    check('the mixed sentence counts both sides', /^1 of your 2 crew ask before anything risky; 1 runs without asking\.$/.test(plural.mixed), plural);
    check('the plural no-prompt sentence agrees', /All 2 of your crew run without stopping to ask you\./.test(plural.pluralAllFull), plural);
    await sleep(700);
    console.log('shot', await capture(cdp, OUT, 'permissions-04-two-crew'));
    check('the glance drops its alarm accent when the override is off', glanceProbe.allAskLoud === false, glanceProbe);

    console.log('shot', await capture(cdp, OUT, 'permissions-01-top'));

    // ---- BEHAVIOUR: a reach flip writes the model ----
    console.log('\n— REACH FLIP WRITES THE MODEL —');
    const reachProbe = await evalJS(cdp, `(() => {
      const row = document.querySelector('#perm-crew .perm-crew-row');
      if (!row) return 'no-row';
      const id = row.dataset.profileAgent;
      const agent = () => (App.agents() || []).find(a => a.id === id) || {};
      const before = agent().executionProfile || '(unset)';
      const chip = row.querySelector('[data-perm-profile="safe-cell"]');
      chip.click();
      return { id, before, after: agent().executionProfile, chipWasSel: chip.classList.contains('sel') };
    })()`);
    console.log(JSON.stringify(reachProbe));
    check('a reach chip writes agent.executionProfile', reachProbe.after === 'safe-cell', reachProbe);
    await sleep(900);

    // ---- SAFETY: one press on an escalation must ARM without granting ----
    console.log('\n— ESCALATION ARMS WITHOUT GRANTING —');
    const armProbe = await evalJS(cdp, `(() => {
      const row = document.querySelector('#perm-crew .perm-crew-row');
      const id = row.dataset.profileAgent;
      const agent = () => (App.agents() || []).find(a => a.id === id) || {};
      const out = { start: agent().approvalMode || 'ask' };
      const chip = row.querySelector('[data-ap-flip][data-ap-to="full"]');
      chip.click();                                   // press 1 — must ARM only
      out.afterPress1 = agent().approvalMode || 'ask';
      out.armedLabel = chip.textContent.trim();
      out.armedClass = chip.classList.contains('armed');
      chip.click();                                   // press 2 — must APPLY
      out.afterPress2 = ((App.agents() || []).find(a => a.id === id) || {}).approvalMode;
      return out;
    })()`);
    console.log(JSON.stringify(armProbe));
    check('press 1 ARMS without granting', armProbe.afterPress1 !== 'full' && armProbe.armedClass, armProbe);
    check('press 2 applies', armProbe.afterPress2 === 'full', armProbe);
    await sleep(900);
    console.log('shot', await capture(cdp, OUT, 'permissions-02-noprompt-row'));


    // ---- THIS COMPUTER keeps its own arm, and the meter survives the disarm ----
    console.log('\n— THIS COMPUTER ARMS, AND THE METER SURVIVES A DISARM —');
    const hostProbe = await evalJS(cdp, `(() => {
      const row = document.querySelector('#perm-crew .perm-crew-row');
      const id = row.dataset.profileAgent;
      const agent = () => (App.agents() || []).find(a => a.id === id) || {};
      const chip = row.querySelector('[data-perm-profile="this-computer"]');
      const out = { start: agent().executionProfile };
      chip.click();
      out.afterPress1 = agent().executionProfile;
      out.armedLabel = chip.textContent.trim();
      // clicking a DIFFERENT chip must disarm this one and restore its meter+label face
      row.querySelector('[data-perm-profile="trusted-project"]').click();
      out.restoredFace = chip.innerHTML;
      out.meterSurvived = /pc-dots/.test(chip.innerHTML);
      out.afterOther = agent().executionProfile;
      return out;
    })()`);
    console.log(JSON.stringify(hostProbe));
    check('THIS COMPUTER press 1 arms without applying', hostProbe.afterPress1 !== 'this-computer', hostProbe);
    check('a disarm restores the reach meter (not a flattened label)', hostProbe.meterSurvived, hostProbe);
    await sleep(900);

    // ---- the whole-station sweeps still move every agent ----
    console.log('\n— WHOLE-STATION SWEEP —');
    const sweepProbe = await evalJS(cdp, `(() => {
      const modes = () => (App.agents() || []).map(a => a.approvalMode || 'ask');
      const out = { before: modes() };
      document.querySelector('#perm-ask-all').click();
      out.afterAskAll = modes();
      const full = document.querySelector('#perm-full-all');
      full.click(); out.afterFullPress1 = modes();
      full.click(); out.afterFullPress2 = modes();
      document.querySelector('#perm-ask-all').click();
      out.restored = modes();
      return out;
    })()`);
    console.log(JSON.stringify(sweepProbe));
    check('EVERYONE ASKS FIRST sets every agent to ask', sweepProbe.afterAskAll.every(m => m === 'ask'), sweepProbe);
    check('the whole-station escalation arms without granting', sweepProbe.afterFullPress1.every(m => m === 'ask'), sweepProbe);
    check('the whole-station escalation applies on press 2', sweepProbe.afterFullPress2.every(m => m === 'full'), sweepProbe);
    await sleep(800);

    // ---- ADVANCED fold opens and holds the policy control ----
    console.log('\n— ADVANCED FOLD —');
    await evalJS(cdp, `(() => { const d = document.querySelector('#perm-advanced'); d.open = true; return d.open; })()`);
    await sleep(500);
    const advProbe = await evalJS(cdp, `(() => {
      const d = document.querySelector('#perm-advanced');
      return { open: d.open, minutes: (d.querySelector('#exec-idle-min') || {}).value, save: !!d.querySelector('[data-exec-policy-save]') };
    })()`);
    console.log(JSON.stringify(advProbe));
    check('the advanced fold holds the real policy control', advProbe.open && advProbe.save && advProbe.minutes !== undefined, advProbe);
    console.log('shot', await capture(cdp, OUT, 'permissions-03-advanced'));

    // ---- NO OS PAINT anywhere in the pane (the standing frontend law) ----
    console.log('\n— NO WHITE OS CONTROLS —');
    const paint = await evalJS(cdp, `(() => {
      const pane = document.querySelector('#perm-crew') && document.querySelector('#perm-crew').closest('.con-pane, .term-body') || document.body;
      const bad = [];
      pane.querySelectorAll('button, select, input, textarea').forEach(el => {
        const cs = getComputedStyle(el);
        if (['rgb(255, 255, 255)', 'rgb(239, 239, 239)'].includes(cs.backgroundColor) || cs.borderColor === 'rgb(118, 118, 118)') {
          bad.push({ tag: el.tagName, id: el.id, cls: el.className, bg: cs.backgroundColor, bc: cs.borderColor });
        }
      });
      return bad;
    })()`);
    console.log(JSON.stringify(paint));
    check('no OS-painted controls in the pane', Array.isArray(paint) && paint.length === 0, paint);

    // ---- horizontal overflow: the pane must not scroll sideways ----
    const overflow = await evalJS(cdp, `(() => {
      const rows = [...document.querySelectorAll('#perm-crew .perm-crew-row')];
      const host = document.querySelector('#perm-crew');
      return { hostScroll: host.scrollWidth, hostClient: host.clientWidth,
               rowOverflow: rows.filter(r => r.scrollWidth > r.clientWidth + 1).length };
    })()`);
    console.log('overflow', JSON.stringify(overflow));
    check('nothing overflows sideways', overflow.hostScroll <= overflow.hostClient + 1 && overflow.rowOverflow === 0, overflow);

    // the whole pane, top to bottom — blocks 2/3/4 have to read as cleanly as block 1.
    console.log('\n— THE REST OF THE PANE —');
    await evalJS(cdp, `(() => { document.querySelectorAll('.toast, .toast-wrap .toast, #tut-coach, .coach').forEach(t => t.remove());
      const b = document.querySelector('#perm-crew').closest('.con-pane') || document.querySelector('#perm-crew').parentElement;
      return b.className; })()`);
    for (const [i, frac] of [[5, 0.33], [6, 0.66], [7, 1]]) {
      await evalJS(cdp, `(() => { const p = document.querySelector('#perm-crew').closest('.con-body, .con-pane, .term-body') || document.scrollingElement;
        p.scrollTop = (p.scrollHeight - p.clientHeight) * ${frac}; return p.scrollTop; })()`);
      await sleep(500);
      console.log('shot', await capture(cdp, OUT, 'permissions-0' + i + '-scroll'));
    }

    const errs = diag.consoleMsgs.filter(m => m.type === 'error' && !/favicon/i.test(m.text)).concat(diag.exceptions);
    check('no console errors or exceptions', errs.length === 0, errs.slice(0, 5));

    console.log('\n' + (fail ? 'FAIL' : 'PASS') + ' — ' + pass + ' ok / ' + fail + ' failed · shots in ' + OUT);
    process.exitCode = fail ? 1 : 0;
  } finally {
    try { if (chrome) chrome.kill(); } catch (_) {}
    try { if (side) side.kill(); } catch (_) {}
  }
}

main().catch(e => { console.error(e); process.exit(1); });
