/* dev/companionprobe.mjs — prove COMPANIONS by watching the REAL engine choose, in a ticking station.

   WHY THIS EXISTS. The bias was provable two weaker ways: unit tests over the extracted
   BOND-WEIGHT-PURE block, and World._dbgAffinity sampling pickByBond in a browser. Neither watches
   planHuddle itself choose. Two environment traps make that harder than it sounds, and both cost a
   full debugging pass:

     1. THE PREVIEW PANE CANNOT DO THIS. It is hidden, so rAF never fires, the world clock is frozen,
        bodies never settle and planHuddle's tile resolution always fails. Headless Chrome over CDP
        ticks (~55fps measured), which is the unlock — same reason scripts/lib/cdp.mjs exists.
     2. AN IMPORTED REAL SAVE IS NOT A USABLE FLOOR. Driving this against a copied production
        workspace refused 24/24 arms: planHuddle was entered every time (the `planned` counter rose)
        but no legal in-zone tile pair could be resolved for that save's crowded geometry. That is
        the station's zones, not the feature — dev/trioprobe.mjs passes on the same build. So this
        uses the SAME seeded fixture floor trioprobe does, and spawns its own crew onto it.

   THE EXPERIMENT IS RIGGED, DELIBERATELY. On the real log all four crew are mutually bonded, so the
   true spread (37/33/30) is indistinguishable from uniform at any affordable sample size — a green
   run would prove nothing. So the workspace gets a runs.jsonl with history for ANCHOR+FRIEND only:
   one proven bond, every other pair a stranger at 0. The derivation is untouched and still reads a
   real run log; only the floor is chosen so the effect is large enough to see.
   Predicted partner share for the anchor: weights 4.076/1/1 -> friend ~67%, each stranger ~16.5%.

   ONE SAMPLE PER PAGE LOAD. A reload is what clears socialPairCd and socialBeat. Sampling in place
   would let the per-pair cooldown veto the favourite immediately after it won — inverting the very
   result under test. The reload costs ~12s a sample and buys independence.

   Usage: node dev/companionprobe.mjs [--samples=24] [--port=8958] [--cdp=9358]
   Exit: 0 pass · 3 fail (bias absent, inverted, or a LOCK) · 4 inconclusive (never armed enough) */
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, isUp } from '../scripts/lib/seed.mjs';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (k, d) => { const h = process.argv.find(a => a.startsWith('--' + k + '=')); return h ? h.split('=').slice(1).join('=') : d; };
const SAMPLES = Number(arg('samples', 24));
const PORT = arg('port', '8958');
const CDP_PORT = Number(arg('cdp', 9358));
const OUT = join(process.cwd(), '.companionprobe');
const SCRATCH = join(OUT, '_seed-workspace');
const APP_URL = `http://127.0.0.1:${PORT}/`;

const ANCHOR = 'engineer', FRIEND = 'writer', STRANGERS = ['researcher', 'archivist'];
const CREW = [ANCHOR, FRIEND, ...STRANGERS];

/* The run history the bond is derived FROM. Alternating ANCHOR/FRIEND runs a minute apart: they are
   repeatedly reached for in the same stretch of work, which is exactly what the shift signal reads.
   The strangers get runs too — but hours away from everything, so they are provably NOT companions.
   Written before the sidecar boots because runStore loads its mirror once, at startup. */
function seedRuns(dir) {
  const T = 1770000000000, rows = [];
  for (let i = 0; i < 20; i++) {
    rows.push({ runId: 'pair' + i, parentRunId: '', agentId: i % 2 ? FRIEND : ANCHOR, reason: 'done',
      startedAt: T + i * 60000, endedAt: T + i * 60000 + 5000, ts: T + i * 60000, internal: false, streamId: 's' + i });
  }
  STRANGERS.forEach((s, k) => {
    for (let i = 0; i < 3; i++) {
      const at = T + (50 + k * 20 + i) * 3600000;   // hours away from the pair AND from each other
      rows.push({ runId: 'lone' + k + '_' + i, parentRunId: '', agentId: s, reason: 'done',
        startedAt: at, endedAt: at + 5000, ts: at, internal: false, streamId: 'x' + k + i });
    }
  });
  writeFileSync(join(dir, 'runs.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
}

const fail = [];
let proc = null, side = null, cdp = null;
try {
  if (await isUp(APP_URL)) throw new Error(`${APP_URL} already answers — pick another --port`);
  mkdirSync(OUT, { recursive: true });
  rmSync(SCRATCH, { recursive: true, force: true });
  materializeSeedWorkspace(SCRATCH);
  seedRuns(SCRATCH);
  side = bootSeededSidecar({ port: PORT, scratchDir: SCRATCH });
  if (!(await waitUp(APP_URL))) throw new Error('seeded sidecar never came up on :' + PORT);

  // the derivation itself, straight off the route the world polls — before any world involvement
  const served = await (await fetch(APP_URL + 'api/agents/affinity', { headers: { Origin: APP_URL.replace(/\/$/, '') } })).json().catch(() => null);
  console.log('[route] pairs=' + JSON.stringify(served && served.pairs));

  ({ proc } = launchChrome({ cdpPort: CDP_PORT, win: '1440,900', profileDir: join(OUT, '_profile') }));
  cdp = await connectCDP(CDP_PORT);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');

  /* one sample: fresh page (clears cooldowns + the beat), spawn the crew, let them settle, arm ONE
     huddle from the anchor and report who planHuddle actually chose as the partner. */
  async function sample(i) {
    await cdp.send('Page.navigate', { url: APP_URL });
    for (let t = 0; t < 40; t++) {
      await sleep(500);
      const up = await evalJS(cdp, `(() => { try { return !!(typeof World !== 'undefined' && World.spawnAgent && World._dbgHuddle && document.getElementById('screen-game') && document.getElementById('screen-game').classList.contains('active')); } catch (e) { return false; } })()`).catch(() => false);
      if (up) break;
    }
    await evalJS(cdp, `(() => { ${CREW.map(id => `World.spawnAgent({ id: '${id}', name: '${id.toUpperCase()}', color: '#77ffdd' });`).join(' ')} return true; })()`);
    let ready = null;
    for (let t = 0; t < 40; t++) {
      await sleep(500);
      ready = await evalJS(cdp, `(() => { try {
        const placed = World.bodies().filter(b => b && !b.hero && !b.unplaced).map(b => b.id);
        const graph = World._dbgAffinity(['x'], ['y'], 0).graph.length;
        return { ok: ${JSON.stringify(CREW)}.every(id => placed.includes(id)) && graph > 0, placed, graph };
      } catch (e) { return { ok: false, why: String(e) }; } })()`).catch(() => null);
      if (ready && ready.ok) break;
    }
    if (!(ready && ready.ok)) return { armed: false, why: 'never settled: ' + JSON.stringify(ready) };
    if (i === 0) console.log('[boot] crew=' + JSON.stringify(ready.placed) + ' graph pairs=' + ready.graph);
    const r = await evalJS(cdp, `(() => { try {
      return World._dbgHuddle(${JSON.stringify([ANCHOR, FRIEND, ...STRANGERS])}, false);
    } catch (e) { return { ok: false, err: String(e) }; } })()`).catch(e => ({ ok: false, err: String(e) }));
    if (r && r.ok && r.roster && r.roster.length >= 2) return { armed: true, partner: r.roster[1], roster: r.roster };
    return { armed: false, why: JSON.stringify(r) };
  }

  // phase A: the clock must actually run here, or nothing below means anything
  await cdp.send('Page.navigate', { url: APP_URL }); await sleep(6000);
  const raf = await evalJS(cdp, `new Promise(res => { let n = 0; const t0 = performance.now();
    const tick = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(tick); else res(n); };
    requestAnimationFrame(tick); })`);
  console.log('[A] rAF frames in 1s: ' + raf);
  if (!(raf > 10)) { console.log('COMPANIONPROBE INCONCLUSIVE — world clock frozen.'); process.exit(4); }

  console.log('[B] ' + SAMPLES + ' samples, fresh page each...');
  const picks = {}; let armed = 0; const misses = [];
  for (let i = 0; i < SAMPLES; i++) {
    const s = await sample(i);
    if (s.armed) { picks[s.partner] = (picks[s.partner] || 0) + 1; armed++; process.stdout.write('  ' + (i + 1) + ':' + s.partner); }
    else { misses.push(s.why); process.stdout.write('  ' + (i + 1) + ':-'); }
  }
  console.log('\n[B] armed ' + armed + ' / ' + SAMPLES);
  if (misses.length) console.log('      first miss: ' + misses[0]);
  if (armed < 8) {
    console.log('COMPANIONPROBE INCONCLUSIVE — only ' + armed + ' armed; cannot read a distribution.');
    process.exit(4);
  }
  const total = Object.values(picks).reduce((a, b) => a + b, 0);
  console.log('[B] partner chosen by planHuddle for ' + ANCHOR + ':');
  for (const [k, v] of Object.entries(picks).sort((a, b) => b[1] - a[1])) {
    console.log(`      ${k}: ${v}/${total} = ${(100 * v / total).toFixed(1)}%` + (k === FRIEND ? '   <- the ONLY proven companion' : '   (stranger)'));
  }
  const friendShare = (picks[FRIEND] || 0) / total;
  const strangerTotal = total - (picks[FRIEND] || 0);
  if (!(friendShare > 0.45)) fail.push(`the proven companion took only ${(100 * friendShare).toFixed(1)}% — bias absent or inverted (expected ~67%)`);
  if (strangerTotal === 0) fail.push('strangers were shut out entirely — the bias became a LOCK, which fractures the floor into fixed duos');
  console.log('');
  if (fail.length) { console.log('COMPANIONPROBE FAILED:'); for (const f of fail) console.log('  - ' + f); }
  else console.log(`COMPANIONPROBE PASS — ${ANCHOR} chose ${FRIEND} ${(100 * friendShare).toFixed(1)}% of ${total} armed huddles; strangers still chosen ${strangerTotal}x.`);
} catch (e) {
  console.log('COMPANIONPROBE ERROR: ' + (e && e.message || e));
  fail.push(String(e && e.message || e));
} finally {
  try { if (proc) proc.kill(); } catch {}
  try { if (side) side.kill(); } catch {}
}
process.exit(fail.length ? 3 : 0);
