// Seeded live DOM -> HTTP -> durable-store proof. Owns only its child processes and dev scratch.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { launchChrome, connectCDP, evalJS, collectDiagnostics, sleep } from '../scripts/lib/cdp.mjs';
import { waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const port = Number(process.env.LIFE_PROOF_PORT || 9143), cdpPort = Number(process.env.LIFE_PROOF_CDP || 9543);
const url = `http://127.0.0.1:${port}/`, out = resolve('dev/.scratch-workspace/life-proof');
mkdirSync(out, { recursive: true });
let seed, chrome, cdp, log = '', requests = [];
const model = 'life-proof/model';
const questTitle = 'Practice the tricky transition ' + Date.now().toString(36);
const mock = createServer((req, res) => {
  if (req.url.includes('/models')) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: [{ id: model, context_length: 32000, pricing: { prompt: '0', completion: '0' } }] })); return; }
  let raw = ''; req.on('data', b => raw += b); req.on('end', () => {
    requests.push(raw);
    const reply = raw.includes('quest master') ? 'NORTH_STAR: Play a whole song for a friend\nQUEST: ' + questTitle + '\nDESC: Practice the transition once slowly with your teacher.\nREWARD: A smoother transition in your song\nDOMAIN: creative\nEXECUTION: commander\nWHY_NOW: Your recent practice shows the transition needs attention.\nCONTRACT: attest\nWHY: Play a whole song for a friend' : 'The requested preparation is complete.';
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: reply } }] }) + '\n\n');
    res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 8, completion_tokens: 8 } }) + '\n\n'); res.end('data: [DONE]\n\n');
  });
});
await new Promise(r => mock.listen(0, '127.0.0.1', r));
const env = { ...process.env, SKYNET_PORT: String(port), SKYNET_DEFAULT_MODEL: model,
  SKYNET_OPENROUTER_KEY: 'life-proof-local-key', SKYNET_OPENROUTER_BASE: `http://127.0.0.1:${mock.address().port}/api/v1`,
  SKYNET_QUEST_REFRESH: '1', SKYNET_REFLECTION: '0', SKYNET_NIGHTSHIFT: '0' };
const boot = async () => {
  seed = spawn(process.execPath, ['dev/seed.js', '--keep'], { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] });
  seed.stdout.on('data', b => log += b); seed.stderr.on('data', b => log += b);
  assert(await waitUp(url), 'seeded sidecar did not start: ' + log.slice(-1500));
};
const stopSeed = async () => {
  if (!seed || seed.exitCode != null) return;
  if (process.platform === 'win32') {
    await new Promise(r => { const k = spawn('taskkill', ['/PID', String(seed.pid), '/T', '/F'], { stdio: 'ignore' }); k.on('exit', r); });
  } else seed.kill('SIGTERM');
  await sleep(500);
};
const ev = s => evalJS(cdp, s);
const until = async (expr, msg) => {
  for (let i = 0; i < 60; i++) { if (await ev(expr)) return; await sleep(200); }
  throw Error(msg);
};
const click = async (sel) => { await ev(`document.querySelector(${JSON.stringify(sel)}).click()`); };
const fill = async (sel, value) => { await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('input', {bubbles:true})); })()`); };
const receipt = {};
try {
  await boot();
  chrome = launchChrome({ cdpPort, profileDir: resolve(out, 'chrome') });
  cdp = await connectCDP(cdpPort); const diag = collectDiagnostics(cdp);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); await cdp.send('Page.navigate', { url });
  assert(await waitDevReady(cdp, evalJS, { url }), 'dev station did not enter game');
  await ev(`StationUI.openTerm('quests')`);
  await until(`!!document.querySelector('.q-goal-create') && !!JourneyStore.status()`, 'quest log not ready');
  // This process owns the disposable worktree seed; reset only its prior proof data for reruns.
  await ev(`(async () => { GoalStore.reset(); await JourneyStore.reset(); const j = await (await fetch('/api/quests')).json(); for (const q of j.quests || []) if(q.status==='open') await QuestLedgerStore.dismiss(q.id); StationUI.rerender('quests',false); })()`);
  const base = await ev(`JourneyStore.status().progression.points`);
  await fill('.q-new-goal', 'Play a whole song for a friend');
  await fill('.q-new-success', 'Play the whole song without stopping for a friend');
  await fill('.q-new-steps', 'Attend a music lesson\nPractice the chorus slowly\nPlay the song for a friend');
  await click('.q-goal-create');
  await until(`!!document.querySelector('.q-step-report')`, 'new goal not rendered');
  receipt.goalId = await ev(`GoalStore.activeGoal().id`);
  for (const note of ['Attended my music lesson today', 'Practiced the chorus for fifteen minutes', 'Played the song but stopped during the transition']) {
    await fill('.q-step-evidence', note); await click('.q-step-report');
    await until(`!document.querySelector('.q-step-report:disabled')`, 'action report did not settle');
  }
  receipt.plan = await ev(`({status:GoalStore.activeGoal().status, text:document.querySelector('.q-track-pct').textContent, points:JourneyStore.status().progression.points, goalCount:JourneyStore.status().evolution.goalsReached})`);
  assert.equal(receipt.plan.status, 'active'); assert.equal(receipt.plan.text, '100% of plan'); assert.equal(receipt.plan.points, base + 30);
  await fill('.q-next-step', 'Practice the difficult transition'); await click('.q-step-add');
  await until(`!!document.querySelector('.q-step-report')`, 'extending completed plan did not restore next step');
  await fill('.q-metric-label', 'Consecutive bars played'); await fill('.q-metric-baseline', '0'); await fill('.q-metric-target', '16'); await click('.q-metric-add');
  await until(`!!document.querySelector('.q-metric-current')`, 'metric not created');
  const metricId = await ev(`JourneyStore.status().metrics.at(-1).id`);
  await fill(`.q-metric[data-mid="${metricId}"] .q-metric-current`, '8'); await click(`.q-metric[data-mid="${metricId}"] .q-metric-update`);
  await until(`JourneyStore.status().metrics.find(m => m.id === ${JSON.stringify(metricId)}).current === 8`, 'metric update not persisted');
  receipt.metricPoints = await ev(`JourneyStore.status().progression.points`); assert.equal(receipt.metricPoints, base + 50);
  // Explicit request exercises real provider -> parser -> quest store, with no paid service.
  receipt.refresh = await ev(`(async () => { const r = await fetch('/api/quests/refresh/run',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}); return r.json(); })()`);
  assert(receipt.refresh.ok && receipt.refresh.started, 'refresh refused: ' + JSON.stringify(receipt.refresh));
  await until(`(async () => { const j = await (await fetch('/api/quests')).json(); return j.quests.some(q => q.title === ${JSON.stringify(questTitle)} && q.status === 'open'); })()`, 'grounded quest refresh did not mint');
  await ev(`QuestLedgerStore.init()`); await sleep(500); await ev(`StationUI.rerender('quests', false)`);
  const qid = await ev(`QuestLedgerStore.quests().find(q => q.title === ${JSON.stringify(questTitle)} && q.status === 'open').id`);
  await click(`.q-life-quest[data-qid="${qid}"] .q-quest-disposition[data-action="too_big"]`);
  await until(`!!document.querySelector('.q-deferred')`, 'paused quest did not move out of actionable slate');
  await click(`.q-life-quest[data-qid="${qid}"] .q-quest-disposition[data-action="resume"]`);
  await until(`!!document.querySelector('.q-open .q-life-quest[data-qid="${qid}"]')`, 'resumed quest not actionable');
  await fill(`.q-life-quest[data-qid="${qid}"] .q-quest-evidence`, 'Practiced the difficult transition with my teacher');
  await click(`.q-life-quest[data-qid="${qid}"] .q-quest-report`);
  await until(`QuestLedgerStore.quests().some(q => q.id === ${JSON.stringify(qid)} && q.status === 'done')`, 'real-world quest report not recorded');
  await fill('.q-goal-evidence', 'Played the whole song without stopping for my friend today'); await click('.q-goal-confirm');
  await until(`GoalStore.activeGoal() === null`, 'goal confirmation did not close goal');
  receipt.achieved = await ev(`({points:JourneyStore.status().progression.points,level:JourneyStore.status().progression.level,stage:JourneyStore.status().evolution.stage,headline:document.getElementById('gt-station').textContent})`);
  assert.equal(receipt.achieved.points, base + 160); assert.equal(receipt.achieved.stage, receipt.plan.goalCount + 1);
  receipt.paint = await ev(`Array.from(document.querySelectorAll('.gx-quests button,.gx-quests input,.gx-quests textarea')).filter(e=>{ const c=getComputedStyle(e); return ['rgb(255, 255, 255)','rgb(239, 239, 239)'].includes(c.backgroundColor)||c.borderColor==='rgb(118, 118, 118)'; }).length`); assert.equal(receipt.paint, 0);
  await stopSeed(); await boot(); await cdp.send('Page.reload'); assert(await waitDevReady(cdp, evalJS, { url }), 'restart failed');
  await sleep(500);
  await until(`typeof StationUI !== 'undefined' && typeof GoalStore !== 'undefined' && GoalStore._state() !== null`, 'app modules did not rehydrate');
  await ev(`StationUI.openTerm('quests'); JourneyStore.sync(true)`);
  await until(`JourneyStore.status() && JourneyStore.status().progression.points === ${receipt.achieved.points}`, 'progression failed restart');
  receipt.restart = await ev(`({points:JourneyStore.status().progression.points,stage:JourneyStore.status().evolution.stage,active:GoalStore.activeGoal(),headline:document.getElementById('gt-station').textContent})`);
  assert.equal(receipt.restart.active, null); assert.equal(receipt.restart.stage, receipt.achieved.stage);
  receipt.repeat = await ev(`JourneyStore.confirmGoal({id:${JSON.stringify(receipt.goalId)},evidence:'same outcome repeated after restart'})`);
  assert.equal(receipt.repeat.journey.progression.points, receipt.achieved.points);
  receipt.metricInPlanner = requests.some(r => r.includes('Consecutive bars played') && r.includes('without stopping'));
  assert(receipt.metricInPlanner, 'planner did not receive outcome metrics and success condition');
  receipt.exceptions = diag.exceptions; assert.deepEqual(receipt.exceptions, []);
  receipt.warnings = diag.consoleMsgs;
  writeFileSync(resolve(out, 'receipt.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ok:true,receipt:resolve(out,'receipt.json'),plan:receipt.plan,achieved:receipt.achieved,restart:receipt.restart,metricInPlanner:receipt.metricInPlanner,warnings:receipt.warnings},null,2));
} catch (e) { writeFileSync(resolve(out,'failure.txt'), String(e.stack) + '\n' + log.slice(-3000)); throw e; }
finally { if (cdp) { try { await cdp.send('Browser.close'); } catch {} cdp.ws.close(); } if (chrome) chrome.proc.kill(); await stopSeed(); mock.close(); }
