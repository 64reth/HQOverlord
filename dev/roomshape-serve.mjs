#!/usr/bin/env node
// dev/roomshape-serve.mjs — a dev server that boots PAST the agent-creation menu.
//
// `node sidecar/index.js` starts with no agent, so the page sits on the title/connect screen and
// you never reach the station. This materializes the same golden seed fixture the capture harnesses
// use (a pre-onboarded workspace with NOVA and a built station) and boots the sidecar on it, so the
// browser lands straight in the world.
//
// The workspace is a REAL directory and it PERSISTS between runs, so anything built or moved in the
// station survives a restart. Pass --fresh to wipe it back to the seed.
//
//   node dev/roomshape-serve.mjs [--port 8790] [--fresh]
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp } from '../scripts/lib/seed.mjs';

const args = process.argv.slice(2);
const pick = (flag, dflt) => { const i = args.indexOf(flag); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const PORT = pick('--port', process.env.PORT || '8790');
const URL = `http://127.0.0.1:${PORT}/`;

const WS = process.env.SKYNET_ROOMSHAPE_WS || join(tmpdir(), 'starnet-roomshape-ws');
const fresh = args.includes('--fresh') || !existsSync(join(WS, 'agent.save.json'));
if (fresh) { mkdirSync(WS, { recursive: true }); materializeSeedWorkspace(WS); }

const side = bootSeededSidecar({ port: PORT, scratchDir: WS });
const stop = () => { try { side.kill(); } catch {} process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
side.on('exit', (code) => { console.error('sidecar exited: ' + code); process.exit(code || 0); });

if (!(await waitUp(URL))) { console.error('server never came up on ' + URL); stop(); }

/* PREFLIGHT THE PORT, DO NOT TRUST IT. waitUp() only proves SOMETHING answers on this port — on a
   machine running several agent sessions that something is regularly a DIFFERENT worktree's build,
   and every screenshot taken against it is a picture of someone else's work. Assert a marker that
   only this branch's bake carries.

   MARK ON STRUCTURE, NEVER ON A TUNABLE VALUE. The first cut asserted `pitch: 7` and `up: 22` —
   the very numbers this lane exists to dial. Tuning pitch to 8 made the banner declare the server
   was NOT this branch while it was serving it correctly, which is worse than no check: a preflight
   that cries wolf gets ignored, and the run it should have caught goes through. The symbols below
   are the ones the change INTRODUCED, so they hold across any amount of taste tuning. */
const js = await (await fetch(URL + 'app/stationbake.js')).text();
const marks = { 'SHAPE.cornerN': /SHAPE = \{ cornerN/.test(js), 'lampRows()': /function lampRows/.test(js), 'lampCols()': /const lampCols/.test(js) };
const bad = Object.entries(marks).filter(([, ok]) => !ok).map(([k]) => k);

console.log(`
  StarNet (seeded, past onboarding)  ->  ${URL}
  crtlab sliders                     ->  ${URL}?crtlab=1
  workspace                          ->  ${WS}   (persists; --fresh to reset)
  build markers                      ->  ${bad.length ? 'MISMATCH: ' + bad.join(', ') + ' — this port is NOT serving this branch' : 'ok (this branch)'}

  ctrl-c to stop.
`);
