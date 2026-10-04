/* dev/goal-track-proof.mjs — live proof of the QUEST LOG's GOAL TRACK.

   The goal arc is staged through the SHIPPED seam (`GoalStore.confirm(belief, texts)` — the same call the
   COMMS confirm panel makes), so the track is drawn from a real persisted goal tree by the real
   Goals.project decomposition. Nothing about the path is hand-written into the DOM.

   Proves, against the live DOM:
     · the empty state renders before any goal exists (and offers the real SET A GOAL door)
     · a confirmed goal draws one node per milestone, in engine order
     · exactly ONE node is the live front ("YOU ARE HERE"), and it is the engine's nextMilestone
     · the meter matches the engine's own done/total — no invented progress
     · the arc is NOT also printed as cards in the grid below (moved, never duplicated)
     · finishing a step advances the fill, flips a node to done, and moves the front
     · nothing on the track claims to be locked (no padlock/tier/unlock language — the standing law)

   Usage:  node dev/seed-deliverables.js        (one shell)
           node dev/goal-track-proof.mjs        (another)
   Dev-only. */
import { mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, connectCDP, evalJS, capture, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '.shots-goal-track');
const PORT = process.env.SKYNET_PORT || '8745';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9795);

const OPEN_EMPTY = `(async () => {
  StationUI.openTerm('quests');
  await new Promise(r => setTimeout(r, 2200));
  const win = [...document.querySelectorAll('.term')].find(t => /QUEST LOG/.test(t.textContent));
  (win.getAnimations ? win.getAnimations() : []).forEach(a => { try { a.finish(); } catch (_) {} });
  const empty = document.querySelector('.q-track-empty');
  return JSON.stringify({ hasTrack: !!document.querySelector('.q-track'), isEmptyState: !!empty,
    setGoalDoor: !!document.querySelector('.q-track-setgoal'),
    copy: empty ? empty.querySelector('.sub').textContent.trim().slice(0, 80) : null });
})()`;

// Stage a REAL goal through the shipped confirm seam, then read the track the engine produced.
const STAGE_GOAL = `(async () => {
  const belief = { id: null, text: 'Launch StarNet to my first 100 users' };
  const texts = [
    'Write the launch announcement',
    'Record a 60-second demo',
    'Line up ten beta testers',
    'Ship the v1 installer'
  ];
  const goal = GoalStore.confirm(belief, texts);
  StationUI.rerender('quests', false);
  await new Promise(r => setTimeout(r, 600));
  return JSON.stringify({ made: !!goal, milestones: goal ? goal.milestones.length : 0 });
})()`;

const READ_TRACK = `(() => {
  const track = document.querySelector('.q-track');
  if (!track) return JSON.stringify({ ok: false, why: 'no track rendered' });
  const nodes = [...track.querySelectorAll('.q-node')].map(n => ({
    state: n.className.match(/q-node-(done|now|ahead)/)[1],
    label: n.querySelector('.q-node-label').textContent.trim(),
    tag: n.querySelector('.q-node-tag') ? n.querySelector('.q-node-tag').textContent.trim() : null
  }));
  // the engine's own numbers, read straight from the store — the track must not disagree with them
  const arc = GoalStore.quests().find(q => q.kind === 'arc-goal');
  const fill = track.querySelector('.q-bar-fill');
  return JSON.stringify({
    ok: true,
    goal: track.querySelector('.q-track-goal').textContent.trim(),
    pctShown: track.querySelector('.q-track-pct').textContent.trim(),
    barWidth: fill ? fill.style.width : null,
    counter: document.querySelector('.q-track-sec .gx-tag').textContent.trim(),
    enginePct: arc ? arc.pct : null, engineDone: arc ? arc.done : null, engineTotal: arc ? arc.total : null,
    nodes,
    liveFronts: nodes.filter(n => n.state === 'now').length,
    acceptBtns: track.querySelectorAll('.q-arc-accept').length,
    // the arc must NOT also appear as cards in the grid below
    arcCardsInGrid: [...document.querySelectorAll('.q-grid .q-card')]
      .filter(c => /Launch StarNet to my first 100 users|Record a 60-second demo/.test(c.textContent)).length,
    // standing law: the log gates nothing — no lock language anywhere on the track
    lockLanguage: /locked|unlock|tier \\d|🔒/i.test(track.textContent),
    // the payoff line must name the SIDECAR's next stage — never a name invented in the frontend
    payoff: (track.querySelector('.q-track-payoff') || {}).textContent || null,
    engineStageNow: (() => { const j = JourneyStore.status(); return j && j.evolution ? j.evolution.name : null; })(),
    engineNextStage: (() => { const j = JourneyStore.status(); return j && j.evolution ? j.evolution.next : null; })()
  });
})()`;

// Complete the front milestone through the engine, then re-read: the path must advance honestly.
const ADVANCE = `(async () => {
  const st = GoalStore._state();
  const goal = GoalStore.activeGoal();
  const next = goal.milestones.find(m => m.status !== 'done');
  next.status = 'done'; next.evidence = 'proof: marked done through the goal tree';
  StationUI.rerender('quests', false);
  await new Promise(r => setTimeout(r, 500));
  const track = document.querySelector('.q-track');
  const nodes = [...track.querySelectorAll('.q-node')].map(n => n.className.match(/q-node-(done|now|ahead)/)[1]);
  const labels = [...track.querySelectorAll('.q-node-label')].map(n => n.textContent.trim());
  return JSON.stringify({ advancedTo: track.querySelector('.q-track-pct').textContent.trim(),
    counter: document.querySelector('.q-track-sec .gx-tag').textContent.trim(),
    barWidth: track.querySelector('.q-bar-fill').style.width,
    nodeStates: nodes, labels, liveFronts: nodes.filter(s => s === 'now').length });
})()`;

/* THE PROMISE, KEPT (2026-08-14). The track tells the Commander that finishing this path advances the
   station. That is a claim the harness must be able to back, so this drives the REAL chain to its end:
   the production `Goals.foldMilestoneDone` for each milestone (the same fold `reconcile` calls when a
   bound work quest completes) -> the goal's own status flips done -> the production
   `GoalStore._syncJourneyMilestones()` posts `goalDone` to the LIVE sidecar -> `addGoalReached` ->
   the evolution stage increments. Then we re-read the panel: the payoff must now name the NEXT stage. */
const COMPLETE_THE_PATH = `(async () => {
  const before = await (await fetch('/api/journey', { cache: 'no-store' })).json();
  const g = GoalStore.activeGoal();
  if (!g) return JSON.stringify({ ok: false, why: 'no active goal to finish' });
  const folds = [];
  for (const m of g.milestones.slice()) {
    const r = Goals.foldMilestoneDone(g, m.id, 'proof: the real fold path', Date.now());
    folds.push({ id: m.id, changed: !!r.changed, goalDone: !!r.goalDone });
  }
  const synced = await GoalStore._syncJourneyMilestones();
  await new Promise(r => setTimeout(r, 900));
  await JourneyStore.sync(true);
  StationUI.rerender('quests', false);
  await new Promise(r => setTimeout(r, 700));
  const after = await (await fetch('/api/journey', { cache: 'no-store' })).json();
  const track = document.querySelector('.q-track');
  const ev0 = before.journey && before.journey.evolution, ev1 = after.journey && after.journey.evolution;
  return JSON.stringify({
    ok: true,
    goalStatus: g.status,
    lastFoldReportedGoalDone: folds.length ? folds[folds.length - 1].goalDone : null,
    journeySync: synced,
    stageBefore: ev0 ? { stage: ev0.stage, name: ev0.name, next: ev0.next } : null,
    stageAfter: ev1 ? { stage: ev1.stage, name: ev1.name, next: ev1.next } : null,
    goalsReachedAfter: ev1 ? ev1.goalsReached : null,
    payoffNow: track ? ((track.querySelector('.q-track-payoff') || {}).textContent || '(no payoff line)') : '(no track)',
    // a finished path must ACKNOWLEDGE the work, never snap back to "no goal path yet"
    finishedBand: track ? track.textContent.replace(/\\s+/g, ' ').trim().slice(0, 120) : '(no track)',
    acknowledgesReached: !!(track && track.classList.contains('q-track-reached-band')),
    nextGoalDoor: !!document.querySelector('.q-track-setgoal'),
    trackComplete: !!(track && track.classList.contains('q-track-done')),
    nodeStates: track ? [...track.querySelectorAll('.q-node')].map(n => n.className.match(/q-node-(done|now|ahead)/)[1]) : []
  });
})()`;

/* The RUNNING state: a milestone whose bound build is in flight must say so and must NOT offer ACCEPT
   (a second accept double-mints the build and double-spends a paid run). Staged by binding a real live
   work quest to the front milestone, which is exactly what acceptMilestone does. */
const RUNNING_STATE = `(async () => {
  const wqId = WorkQuestStore.accept({ title: 'Proof: a build already running', build: { kind: 'freeform' } });
  const g = GoalStore.activeGoal();
  if (!g) return JSON.stringify({ ok: false, why: 'no active goal' });
  const front = g.milestones.find(m => m.status !== 'done');
  if (!front) return JSON.stringify({ ok: false, why: 'no open milestone' });
  front.questRef = wqId;
  StationUI.rerender('quests', false);
  await new Promise(r => setTimeout(r, 600));
  const track = document.querySelector('.q-track');
  const nowNode = track.querySelector('.q-node-now');
  return JSON.stringify({ ok: true, boundQuest: wqId,
    tag: nowNode && nowNode.querySelector('.q-node-tag') ? nowNode.querySelector('.q-node-tag').textContent.trim() : null,
    acceptOffered: track.querySelectorAll('.q-arc-accept').length,
    runningNote: !!track.querySelector('.q-track-running') });
})()`;

// The empty-state door must actually LAND somewhere (a button that exists is not a button that works).
const SET_GOAL_DOOR = `(async () => {
  const b = document.querySelector('.q-track-setgoal');
  if (!b) return JSON.stringify({ ok: false, why: 'no SET A GOAL button (a goal already exists?)' });
  b.click();
  await new Promise(r => setTimeout(r, 1400));
  const opened = [...document.querySelectorAll('.term')].map(t => (t.querySelector('.term-title') || {}).textContent || '')
    .filter(Boolean);
  return JSON.stringify({ ok: true, openWindows: opened,
    landedOnDossier: opened.some(t => /COMMANDER|DOSSIER/i.test(t)) });
})()`;

(async () => {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const { proc } = launchChrome({ cdpPort: CDP_PORT, win: '1440,980', profileDir: join(OUT, '_chrome') });
  try {
    await sleep(1800);
    const cdp = await connectCDP(CDP_PORT);
    const diag = collectDiagnostics(cdp);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: 'window.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 200);'
    });
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT });
    await sleep(9000);

    console.log('empty state ->', await evalJS(cdp, OPEN_EMPTY));
    console.log(' shot       ->', JSON.stringify(await capture(cdp, OUT, '1-no-goal-yet')));
    console.log('set-goal door ->', await evalJS(cdp, SET_GOAL_DOOR));

    console.log('stage goal  ->', await evalJS(cdp, STAGE_GOAL));
    console.log('track       ->', await evalJS(cdp, READ_TRACK));
    console.log(' shot       ->', JSON.stringify(await capture(cdp, OUT, '2-goal-track')));

    console.log('advance     ->', await evalJS(cdp, ADVANCE));
    console.log(' shot       ->', JSON.stringify(await capture(cdp, OUT, '3-advanced')));

    console.log('running     ->', await evalJS(cdp, RUNNING_STATE));
    console.log(' shot       ->', JSON.stringify(await capture(cdp, OUT, '4-running')));

    console.log('FINISH PATH ->', await evalJS(cdp, COMPLETE_THE_PATH));
    console.log(' shot       ->', JSON.stringify(await capture(cdp, OUT, '5-path-complete')));

    const errs = (diag.exceptions || []).length;
    console.log('page exceptions:', errs);
    if (errs) console.log(JSON.stringify(diag.exceptions.slice(0, 3), null, 1));
    console.log('\nshots in', OUT);
  } finally { try { proc.kill(); } catch (_) {} }
})();
