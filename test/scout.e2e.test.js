/* node test/scout.e2e.test.js — TRUE end-to-end proof of the SCOUT ORCHESTRATION (runScoutCycle).

   scout.http.test.js proves the ROUTES over pre-seeded state but never fires a run — the whole
   activity→extract→fold→persist→decide→draft→stage→ledger chain in sidecar/index.js had no test; a broken
   hop silently no-ops (the exact anti-pattern the scout lane exists to kill). This suite boots the REAL
   sidecar with a mock OpenRouter and drives REAL task runs so the post-run scout hook fires, then asserts
   against server truth (GET /api/scout + the files on disk):

   BOOT 1 — THE HAPPY CHAIN (cold interests, prospect shelf pre-filled so the mint routes to 'recipe'):
     · real runs feed the cadence counters; the extraction pass fires off REAL activity lines;
     · the mock's TOPIC/EVIDENCE reply (whose evidence quotes the actual run directives) folds into the
       histogram, persists to scout.interests.json, and flips warm;
     · the mint gate fires, the recipe directive goes to the model, the well-formed grounded reply parses,
       a recipe draft is STAGED, and the ledger records both hops (interests folded + recipe staged).

   BOOT 2 — THE HONEST-FAILURE CHAIN (anti-silent-no-op; warm pre-seeded so the mint attempt fires):
     · a well-formed recipe whose WHY cites NOTHING the station observed is rejected by the grounding
       guard: NO draft staged + a 'rejected' ledger note (visible failure, never a quiet nothing);
     · an extraction reply with INVENTED evidence folds to zero topics + an honest 'none' ledger note.

   ZERO network, zero real key (the run key is a fake routed to the mock). Part of test:http. */
'use strict';

const A = require('./_assert.js');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const { bootToken } = require('./_httpToken.js');
const Specialties = require('../shared/specialties.js');

const HOST = '127.0.0.1';
const INDEX = path.resolve(__dirname, '..', 'sidecar', 'index.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BROKER = Specialties.ARCHETYPES.find(spec => spec && spec.id === 'broker');
A.ok(BROKER && BROKER.name, 'the canonical broker archetype is present in the live catalog');

/* ---- the mock OpenRouter: routes on the prompt's marker (extraction vs recipe vs the main run) ---- */
function startMock(replies) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url.indexOf('/models') >= 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'test/model', context_length: 8000, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] }] }));
        return;
      }
      if (req.url.indexOf('/chat/completions') >= 0) {
        let body = ''; req.on('data', d => { body += d; }); req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
          const text = t => {
            res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: t } }] }) + '\n\n');
            res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 6, completion_tokens: 4, total_tokens: 10 } }) + '\n\n');
            res.write('data: [DONE]\n\n'); res.end();
          };
          if (body.indexOf('intake analyst') >= 0) { calls.push('extraction'); text(replies.extraction); }        // interests.buildDirective's system marker
          else if (body.indexOf('recipe author') >= 0) { calls.push('recipe'); text(replies.recipe); }            // scout.buildRecipeDirective's system marker
          else if (body.indexOf("station's recruiter") >= 0) { calls.push('recruiter'); text(replies.prospect || 'NONE'); }   // the LLM prospect authorship pass
          else { calls.push('run'); text('ok, done.'); }                                                          // the main task run itself
        });
        return;
      }
      res.writeHead(404); res.end();
    });
    const calls = [];   // which model passes actually fired — lets a boot assert a pass did NOT run (zero-spend paths)
    server.listen(0, HOST, () => resolve({ server, base: 'http://' + HOST + ':' + server.address().port + '/api/v1', calls }));
  });
}

function boot(port, env, attemptsLeft) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [INDEX], { env: Object.assign({}, process.env, env, { SKYNET_PORT: String(port) }), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', settled = false;
    const onData = d => {
      out += d.toString();
      if (!settled && out.indexOf('http://' + HOST + ':' + port) >= 0) { settled = true; resolve({ child, port }); }
      else if (!settled && /already in use/i.test(out)) { settled = true; try { child.kill(); } catch (_) {} if (attemptsLeft > 0) resolve(boot(port + 1, env, attemptsLeft - 1)); else reject(new Error('no free port')); }
    };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    child.on('error', e => { if (!settled) { settled = true; reject(e); } });
    setTimeout(() => { if (!settled) { settled = true; try { child.kill(); } catch (_) {} reject(new Error('boot timeout:\n' + out)); } }, 9000);
  });
}

/* pre-seed the scout state: the mint gate already EARNED (runsSinceMint past the floor, no prior mint) and
   the prospect shelf FULL — so decide() deterministically routes the one attempt to kind:'recipe'. This seeds
   only the cadence knobs; the chain under test (activity→extract→fold→decide→draft→stage→ledger) runs live. */
function seedScoutState(ws) {
  const staged = [0, 1, 2].map(i => ({
    id: 'seed-p' + i, kind: 'prospect', why: 'seed', fingerprint: 'seed fp ' + i, at: Date.now() - 3600000,
    draft: { name: 'Seed Prospect ' + i, tagline: 'occupies a prospect slot ' + i }
  }));
  fs.writeFileSync(path.join(ws, 'scout.state.json'), JSON.stringify({
    v: 1, state: { v: 1, staged, denylist: [], ledger: [], runsSinceMint: 5, lastMintAt: 0, lastKind: '', context: null }
  }));
}

async function driveRun(B, token, agentId, text) {
  const r = await fetch(B + '/api/run', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-StarNet-Token': token, Origin: B },
    body: JSON.stringify({ key: 'sk-or-v1-scout-fake', model: 'test/model', agentId, isTask: true, messages: [{ role: 'user', content: text }] })
  });
  const rd = r.body.getReader(); while (true) { const { done } = await rd.read(); if (done) break; }   // drain to run end
}

// poll GET /api/scout until pred(payload) holds (the cycle is fire-and-forget post-run) — or time out honestly.
async function pollScout(B, token, pred, label, ms) {
  const until = Date.now() + (ms || 15000);
  let last = null;
  while (Date.now() < until) {
    try { last = await (await fetch(B + '/api/scout', { headers: { 'X-StarNet-Token': token, Origin: B } })).json(); } catch (_) {}
    if (last && pred(last)) return last;
    await sleep(250);
  }
  throw new Error('timed out waiting for: ' + label + '\nlast /api/scout: ' + JSON.stringify(last));
}

const QUIET = { SKYNET_THREAD_MINE: '0', SKYNET_SKILL_REVIEW: '0', SKYNET_SKILL_CURATOR: '0' };

(async () => {
  /* ================= BOOT 1 — the happy chain ================= */
  {
    const mock = await startMock({
      // evidence is a verbatim fragment of the run directives below — the grounding guard must pass it.
      extraction: 'TOPIC: nvidia earnings research | EVIDENCE: nvidia earnings call',
      recipe: [
        'NAME: Nvidia Earnings Brief',
        'EMOJI: ◈',
        'TAGLINE: nvidia earnings call digest with the movers',
        'BLURB: Reads the latest nvidia earnings call and briefs what moved, why, and what to watch.',
        'CATEGORY: research',
        'TAGS: research=0.9, general=0.1',
        'GEAR: dish',
        'PARAM: quarter | Quarter | e.g. Q2 FY26',
        'TASK: Summarize the {quarter} nvidia earnings call: lead with what moved and why, cite the transcript.',
        'WHY: you keep digging into the nvidia earnings call'   // cites the real evidence -> grounded
      ].join('\n')
    });
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-scout-e2e-'));
    seedScoutState(ws);   // no interests file: the histogram starts COLD — warmth must be EARNED live
    const { child, port } = await boot(8930 + (process.pid % 25), Object.assign({ SKYNET_WORKSPACES: ws, SKYNET_OPENROUTER_BASE: mock.base }, QUIET), 20);
    const B = 'http://' + HOST + ':' + port;
    try {
      const token = await bootToken(B, B);

      // sanity: pre-run, the scout is honestly COLD (no interests -> warm:false, gate binds 'cold').
      const cold = await (await fetch(B + '/api/scout', { headers: { 'X-StarNet-Token': token, Origin: B } })).json();
      A.eq(cold.warm, false, 'pre-run the station is honestly cold (no interests yet)');
      A.eq(cold.gate.binding, 'cold', 'the gate reports the cold binding pre-run');

      // drive REAL task runs — the post-run hook is the ONLY trigger used (no state poked mid-flight).
      await driveRun(B, token, 'scout-e2e', 'dig into the nvidia earnings call and what moved the stock');
      await driveRun(B, token, 'scout-e2e', 'summarize the latest nvidia earnings call transcript for me');
      await driveRun(B, token, 'scout-e2e', 'compare the nvidia earnings call guidance to last quarter');

      // the chain lands: interests folded + warm + a recipe draft STAGED, all from live orchestration.
      const s = await pollScout(B, token,
        p => p.staged && p.staged.some(it => it.kind === 'recipe'),
        'a recipe draft staged by the live scout cycle');
      A.ok(true, 'ORCHESTRATION: a real run chain staged a recipe draft end-to-end');
      A.eq(s.warm, true, 'the station is WARM off live-extracted interests (never pre-seeded)');
      const topic = (s.interests || []).find(t => /nvidia/.test(t.topic));
      A.ok(topic, 'the extracted interest persisted and is served by GET /api/scout');
      A.ok(topic && topic.evidence.some(q => q.indexOf('nvidia earnings call') >= 0), 'the interest carries its verbatim evidence quote');
      const draft = s.staged.find(it => it.kind === 'recipe');
      A.eq(draft.draft.name, 'Nvidia Earnings Brief', 'the staged draft is the parsed model reply');
      A.ok(draft.why.indexOf('nvidia earnings call') >= 0, 'the staged draft carries its evidence-grounded WHY');
      A.ok(draft.draft.task.indexOf('{quarter}') >= 0 && draft.draft.params[0].key === 'quarter', 'the param round-trips the task template');
      A.ok((s.ledger || []).some(e => e.kind === 'interests' && e.outcome === 'folded'), 'the ledger recorded the interests fold');
      A.ok((s.ledger || []).some(e => e.kind === 'recipe' && e.outcome === 'staged' && e.title === 'Nvidia Earnings Brief'), 'the ledger recorded the staged mint');
      A.eq(s.gate.fire, false, 'the mint spent the cadence (the gate no longer fires)');

      // the durable files really landed on disk (restart-safety is the point of the server-side scout).
      const onDiskInterests = JSON.parse(fs.readFileSync(path.join(ws, 'scout.interests.json'), 'utf8'));
      A.ok(onDiskInterests.state && onDiskInterests.state.topics && Object.keys(onDiskInterests.state.topics).some(k => /nvidia/.test(k)), 'scout.interests.json persisted the extracted topic');
      const onDiskScout = JSON.parse(fs.readFileSync(path.join(ws, 'scout.state.json'), 'utf8'));
      A.ok((onDiskScout.state.staged || []).some(it => it.kind === 'recipe'), 'scout.state.json persisted the staged draft');
    } finally {
      try { child.kill(); } catch (_) {}
      try { mock.server.close(); } catch (_) {}
      await sleep(150);
      try { fs.rmSync(ws, { recursive: true, force: true }); } catch (_) {}
    }
  }

  /* ================= BOOT 2 — the honest-failure chain (anti-silent-no-op) ================= */
  {
    const mock = await startMock({
      // INVENTED evidence: quotes nothing in the real activity -> the extraction grounding guard must drop it.
      extraction: 'TOPIC: quantum basket weaving | EVIDENCE: an invented quote citing zero observed activity',
      // a WELL-FORMED recipe whose WHY cites nothing the station observed -> the parseRecipe grounding
      // guard must reject it (the new anti-invented-pitch arm), visibly, via the ledger.
      recipe: [
        'NAME: Fresh Dashboards',
        'EMOJI: ◈',
        'TAGLINE: a cheerful dashboard for cheerful people',
        'BLURB: Builds a dashboard.',
        'CATEGORY: general',
        'TAGS: general=1',
        'GEAR:',
        'PARAM: board | Board | main',
        'TASK: Build the {board} dashboard now.',
        'WHY: because commanders love cheerful dashboards every sunrise'   // ungroundable: cites nothing real
      ].join('\n')
    });
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-scout-e2e-'));
    seedScoutState(ws);
    // WARM is pre-seeded here (boot 1 already proved warmth is earned live) so the mint attempt fires at all;
    // lastPassAt:0 leaves the extraction pass free to fire too — both failure arms exercise in one boot.
    fs.writeFileSync(path.join(ws, 'scout.interests.json'), JSON.stringify({
      v: 1, state: { v: 1, topics: { 'kubernetes-ops': { label: 'kubernetes ops', w: 5, n: 5, lastAt: Date.now(), ev: [{ q: 'kubernetes ops', at: Date.now() }] } }, lastPassAt: 0, runsSincePass: 0 }
    }));
    const { child, port } = await boot(8960 + (process.pid % 25), Object.assign({ SKYNET_WORKSPACES: ws, SKYNET_OPENROUTER_BASE: mock.base }, QUIET), 20);
    const B = 'http://' + HOST + ':' + port;
    try {
      const token = await bootToken(B, B);
      await driveRun(B, token, 'scout-e2e', 'refactor the deploy pipeline for staging');
      await driveRun(B, token, 'scout-e2e', 'tighten rollback handling in the deploy pipeline');

      // the UNGROUNDABLE recipe: rejected + ledger-visible, NEVER a silent nothing, NEVER a staged lie.
      const s = await pollScout(B, token,
        p => (p.ledger || []).some(e => e.kind === 'recipe' && e.outcome === 'rejected'),
        'a rejected ledger note for the ungroundable recipe');
      A.ok(true, 'HONEST FAILURE: the ungroundable recipe reply was rejected AND the ledger says so');
      A.ok(!(s.staged || []).some(it => it.kind === 'recipe'), 'no recipe draft was staged from the invented pitch');

      // the INVENTED extraction evidence: dropped by the grounding guard; the pass notes 'none' honestly.
      const s2 = await pollScout(B, token,
        p => (p.ledger || []).some(e => e.kind === 'interests' && e.outcome === 'none'),
        "an honest 'none' ledger note for the invented-evidence extraction");
      A.ok(!(s2.interests || []).some(t => /quantum/.test(t.topic)), 'the invented topic never entered the histogram');
    } finally {
      try { child.kill(); } catch (_) {}
      try { mock.server.close(); } catch (_) {}
      await sleep(150);
      try { fs.rmSync(ws, { recursive: true, force: true }); } catch (_) {}
    }
  }

  /* ================= BOOT 3 — the ARCHETYPE-SEEDED prospect mint (recuration 2026-07-14) =================
     A WARM learned interest that points at a dormant curated archetype must stage that archetype's FULL
     spec as a prospect — deterministically, with ZERO model spend (the recruiter authorship pass never
     fires), and a WHY naming the real topic + count. Recipe shelf pre-filled so decide() routes the one
     attempt to kind:'prospect'; the interests pass is gap-suppressed so no extraction call fires either. */
  {
    const mock = await startMock({
      extraction: 'TOPIC: unused | EVIDENCE: unused',
      recipe: 'NONE',
      prospect: 'NAME: Should Never Be Asked\nEMOJI: ✦\nTAGLINE: the llm pass must not fire\nPURPOSE: n/a\nMANUAL: n/a\nKIT: dish\nSKILLS:\nWHY: n/a'
    });
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-scout-e2e-'));
    // recipe shelf FULL + cadence earned -> the attempt routes to 'prospect'; prospect shelf empty.
    const stagedRecipes = [0, 1, 2].map(i => ({
      id: 'seed-r' + i, kind: 'recipe', why: 'seed', fingerprint: 'seed recipe fp ' + i, at: Date.now() - 3600000,
      draft: { name: 'Seed Recipe ' + i, tagline: 'occupies a recipe slot ' + i }
    }));
    fs.writeFileSync(path.join(ws, 'scout.state.json'), JSON.stringify({
      v: 1, state: { v: 1, staged: stagedRecipes, denylist: [], ledger: [], runsSinceMint: 5, lastMintAt: 0, lastKind: '', context: null }
    }));
    // a WARM topic whose words hit the broker archetype's own text; lastPassAt now -> extraction gap-suppressed.
    fs.writeFileSync(path.join(ws, 'scout.interests.json'), JSON.stringify({
      v: 1, state: { v: 1, topics: { 'gpu-price-tracking': { label: 'gpu price tracking', w: 5, n: 5, lastAt: Date.now(), ev: [{ q: 'gpu price tracking', at: Date.now() }] } }, lastPassAt: Date.now(), runsSincePass: 0 }
    }));
    const { child, port } = await boot(8890 + (process.pid % 25), Object.assign({ SKYNET_WORKSPACES: ws, SKYNET_OPENROUTER_BASE: mock.base }, QUIET), 20);
    const B = 'http://' + HOST + ':' + port;
    try {
      const token = await bootToken(B, B);
      await driveRun(B, token, 'scout-e2e', 'check gpu prices for the build');

      const s = await pollScout(B, token,
        p => (p.staged || []).some(it => it.kind === 'prospect'),
        'an archetype prospect staged by the live scout cycle');
      const draft = s.staged.find(it => it.kind === 'prospect');
      A.eq(draft.draft.archetypeId, 'broker', 'ARCHETYPE MINT: the warm price-hunting interest staged the Broker archetype');
      A.eq(draft.draft.name, BROKER.name, 'the staged draft uses the archetype\'s current canonical name, not an LLM invention');
      A.ok(Array.isArray(draft.draft.kit) && draft.draft.kit.length > 0 && Array.isArray(draft.draft.skills) && draft.draft.skills.length > 0,
        'the staged archetype carries its FULL loadout (kit + skills)');
      A.ok(draft.draft.purpose.length > 0 && draft.draft.manual.length > 0, 'the staged archetype carries its purpose + manual (nothing half-authored)');
      A.ok(draft.why.indexOf('gpu price tracking') >= 0 && draft.why.indexOf('5×') >= 0,
        'the WHY names the real topic and its real count (truthful telemetry): ' + draft.why);
      A.ok((s.ledger || []).some(e => e.kind === 'prospect' && e.outcome === 'staged' && e.title === BROKER.name), 'the ledger recorded the archetype mint under its canonical name');
      A.eq(mock.calls.indexOf('recruiter'), -1, 'ZERO SPEND: the LLM prospect authorship pass never fired for an archetype mint');
      A.eq(mock.calls.indexOf('extraction'), -1, 'the gap-suppressed extraction pass never fired (the mint was pure state)');

      // restart-safety: the staged archetype landed on disk.
      const onDisk = JSON.parse(fs.readFileSync(path.join(ws, 'scout.state.json'), 'utf8'));
      A.ok((onDisk.state.staged || []).some(it => it.kind === 'prospect' && it.draft && it.draft.archetypeId === 'broker'),
        'scout.state.json persisted the staged archetype draft');
    } finally {
      try { child.kill(); } catch (_) {}
      try { mock.server.close(); } catch (_) {}
      await sleep(150);
      try { fs.rmSync(ws, { recursive: true, force: true }); } catch (_) {}
    }
  }

  A.report('scout.e2e.test');
})().catch(e => { console.log('FAIL: scout.e2e.test threw - ' + (e && e.stack || e)); process.exit(1); });
