/* dev/gatherprobe.mjs — watch THE GATHERING actually happen, in a ticking station.

   A beat gated on 30 minutes of unattended quiet plus an hourly roll cannot be proven by waiting —
   that is a vigil, and this repo has shipped broken rare beats exactly that way. So this forces the
   FREQUENCY gates only (World._dbgGatherNow) and then WATCHES the real engine through the ordinary
   read-only snapshot: bodies converge on assigned slots, everyone turns to face the overseer, he
   speaks his own tongue while the crowd stays silent, and the Commander coming back scatters them —
   with the overseer breaking LAST.

   Environment notes, both learned the hard way on the companions lane:
     · the preview pane is HIDDEN, so rAF never fires and the world clock is frozen. Headless Chrome
       over CDP ticks (~55fps). That is the only reason any of this is observable.
     · an imported production save is not a usable floor (its crowded zones resolve no legal tiles).
       Use the seeded fixture floor + spawnAgent, exactly as trioprobe does.

   Usage: node dev/gatherprobe.mjs [--crew=6] [--port=8960] [--cdp=9360]
   Exit: 0 pass · 3 fail · 4 inconclusive (never assembled) */
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, isUp } from '../scripts/lib/seed.mjs';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const arg = (k, d) => { const h = process.argv.find(a => a.startsWith('--' + k + '=')); return h ? h.split('=').slice(1).join('=') : d; };
const CREW = Number(arg('crew', 6));
const PORT = arg('port', '8960');
const CDP_PORT = Number(arg('cdp', 9360));
const OUT = join(process.cwd(), '.gatherprobe');
const SCRATCH = join(OUT, '_seed-workspace');
const APP_URL = `http://127.0.0.1:${PORT}/`;

const fail = [];
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fail.push(msg); };
let proc = null, side = null, cdp = null;

try {
  if (await isUp(APP_URL)) throw new Error(`${APP_URL} already answers — pick another --port`);
  mkdirSync(OUT, { recursive: true });
  rmSync(SCRATCH, { recursive: true, force: true });
  materializeSeedWorkspace(SCRATCH);
  side = bootSeededSidecar({ port: PORT, scratchDir: SCRATCH });
  if (!(await waitUp(APP_URL))) throw new Error('seeded sidecar never came up on :' + PORT);

  ({ proc } = launchChrome({ cdpPort: CDP_PORT, win: '1440,900', profileDir: join(OUT, '_profile') }));
  cdp = await connectCDP(CDP_PORT);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: APP_URL });

  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const up = await evalJS(cdp, `(() => { try { return !!(typeof World !== 'undefined' && World._dbgGatherNow && World.spawnAgent && document.getElementById('screen-game') && document.getElementById('screen-game').classList.contains('active')); } catch (e) { return false; } })()`).catch(() => false);
    if (up) break;
  }
  const raf = await evalJS(cdp, `new Promise(res => { let n = 0; const t0 = performance.now();
    const tick = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(tick); else res(n); };
    requestAnimationFrame(tick); })`);
  console.log('[gatherprobe] rAF frames in 1s: ' + raf);
  if (!(raf > 10)) { console.log('GATHERPROBE INCONCLUSIVE — world clock frozen'); process.exit(4); }

  const names = Array.from({ length: CREW }, (_, i) => 'G' + i);
  await evalJS(cdp, `(() => { ${names.map(id => `World.spawnAgent({ id: '${id}', name: '${id}', color: '#77ffdd' });`).join(' ')} return true; })()`);
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const n = await evalJS(cdp, `World.bodies().filter(b => b && !b.unplaced).length`).catch(() => 0);
    if (n >= CREW) break;
  }
  const placed = await evalJS(cdp, `World.bodies().filter(b => b && !b.unplaced).map(b => b.id)`);
  console.log('[gatherprobe] placed bodies: ' + JSON.stringify(placed));

  /* ---- Make the station genuinely UNATTENDED before arming.
     The app sets a COMMS chat focus at boot and it stays WARM for a while, which makes chatHot()
     true — and a live chat stare is the Commander being present, so gatheringBroken tears the
     assembly down on its first tick. That is the predicate behaving correctly, not a bug: in real
     use the trigger needs 30 minutes of quiet, by which time the focus has long gone cold. Clearing
     it here is how a probe reproduces "nobody has touched this station in half an hour" in seconds.
     (Diagnosed the slow way: the first run scattered within one tick and _dbgGatherGates was the
     only thing that could say WHICH of six OR'd conditions fired.) */
  await evalJS(cdp, `(() => { World.setChatFocus(null); return true; })()`);
  const gates = await evalJS(cdp, `(() => World._dbgGatherGates())()`);
  console.log('[gatherprobe] gates before arm: ' + JSON.stringify(gates));
  if (gates.chatHot || gates.cursorPresent || !gates.pageVisible) {
    console.log('GATHERPROBE INCONCLUSIVE — could not make the station unattended: ' + JSON.stringify(gates));
    process.exit(4);
  }

  /* ---- ARM. Force the frequency gates only; every legality gate still runs inside startGathering. */
  const armed = await evalJS(cdp, `(() => World._dbgGatherNow())()`);
  console.log('[gatherprobe] armed: ' + JSON.stringify(armed && armed.ok));
  if (!(armed && armed.ok)) {
    console.log('GATHERPROBE INCONCLUSIVE — could not assemble: ' + JSON.stringify(armed));
    process.exit(4);
  }
  const st0 = armed.state;
  check(st0.bodies.length >= 3, 'the assembly holds at least three bodies (got ' + st0.bodies.length + ')');
  const slots = st0.bodies.filter(b => b.slot).map(b => b.slot.x + ',' + b.slot.y);
  check(new Set(slots).size === slots.length, 'every body got its OWN distinct slot (no two share a tile)');
  check(st0.bodies.filter(b => b.role === 'overseer').length === 1, 'exactly one overseer');
  check(st0.bodies.every(b => b.goal === 'gather'), 'every participant is on the gather goal');

  /* ---- CONVERGE + HOLD. Sample until the overseer is speaking, then inspect the formation. */
  let held = null, sawTalkingOverseer = false, audienceEverTalked = false, maxSimultaneous = 0, wordlessMouth = 0;
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    const s = await evalJS(cdp, `(() => World._dbgGatherState())()`).catch(() => null);
    if (!s) break;
    const talking = s.bodies.filter(b => b.talking);
    maxSimultaneous = Math.max(maxSimultaneous, talking.length);
    if (talking.some(b => b.talking && !b.chatter)) wordlessMouth++;   // the renderer kills a bubble at CHATTER_MS — a longer speak window must be spoken as consecutive lines, never as a wordless mouth
    if (talking.some(b => b.role === 'audience')) audienceEverTalked = true;
    if (s.phase === 'hold') {
      held = s;
      if (talking.some(b => b.role === 'overseer')) sawTalkingOverseer = true;
      if (sawTalkingOverseer && i > 12) break;
    }
  }
  if (!held) { console.log('GATHERPROBE INCONCLUSIVE — never reached the hold phase'); process.exit(4); }

  const arrived = held.bodies.filter(b => b.arrived).length;
  check(arrived >= 3, 'bodies actually WALKED to the formation and arrived (' + arrived + '/' + held.bodies.length + ')');
  check(sawTalkingOverseer, 'the overseer spoke');
  check(!audienceEverTalked, 'the audience never spoke — a formation with ONE speaker, not a conversation');
  check(maxSimultaneous <= 1, 'never more than one mouth moving at a time (max ' + maxSimultaneous + ')');
  check(wordlessMouth === 0, 'a moving mouth ALWAYS has a bubble — the address is spoken as consecutive lines, never a wordless tail (' + wordlessMouth + ' wordless sample(s))');
  const over = held.bodies.find(b => b.role === 'overseer');
  const aud = held.bodies.filter(b => b.role === 'audience' && b.arrived);
  const gap = Math.min(...aud.map(b => Math.abs(b.tile.x - over.tile.x) + Math.abs(b.tile.y - over.tile.y)));
  check(gap >= 2, 'the overseer stands APART from the crowd, by himself (nearest body ' + gap + ' tiles)');
  const dirs = new Set(aud.map(b => b.dir));
  check(aud.length >= 2, 'a real crowd faced him (' + aud.length + ' bodies)');
  console.log('[gatherprobe] audience facings: ' + JSON.stringify([...dirs]) + '  overseer at ' + JSON.stringify(over.tile));

  /* ---- SCATTER. Drive the REAL predicate: the Commander moves the cursor. */
  const ret = await evalJS(cdp, `(() => World._dbgGatherReturn())()`);
  check(!!(ret && ret.broken), 'the Commander returning BREAKS the gathering (the primary exit)');
  await sleep(350);
  const mid = await evalJS(cdp, `(() => World._dbgGatherState())()`).catch(() => null);
  if (mid) {
    const stillIn = mid.bodies.filter(b => b.role === 'audience' && b.goal === 'gather').length;
    check(stillIn === 0, 'the crowd dropped their plans immediately (' + stillIn + ' audience still held)');
    check(mid.phase === 'breaking', 'and the beat is in its breaking phase, holding the overseer');
    const stillOver = mid.bodies.find(b => b.role === 'overseer');
    check(!!stillOver, '⛔ THE OVERSEER IS STILL THERE after the crowd bolted — the shot the whole beat exists for');
  } else {
    check(false, 'the overseer should still have been held briefly after the scatter');
  }
  await sleep(1500);
  const after = await evalJS(cdp, `(() => ({ state: World._dbgGatherState(), stuck: World.bodies().filter(b => b && b.goal === 'gather').map(b => b.id), talking: World.bodies().filter(b => b && b.talking).map(b => b.id) }))()`);
  check(after.state === null, 'the gathering ENDED and released the slot');
  check(after.stuck.length === 0, 'no body was left stranded on the gather goal (' + JSON.stringify(after.stuck) + ')');
  check(after.talking.length === 0, 'nobody was left mouth-moving at nobody (' + JSON.stringify(after.talking) + ')');
} catch (e) {
  console.log('GATHERPROBE ERROR: ' + ((e && e.message) || e));
  fail.push(String((e && e.message) || e));
} finally {
  try { if (proc) proc.kill(); } catch {}
  try { if (side) side.kill(); } catch {}
}

console.log('');
if (fail.length) { console.log('GATHERPROBE FAILED — ' + fail.length + ' problem(s):'); for (const f of fail) console.log('  - ' + f); }
else console.log('GATHERPROBE PASS — the station assembled, the overseer spoke alone, and they scattered when the Commander came back.');
process.exit(fail.length ? 3 : 0);
