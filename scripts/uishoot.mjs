#!/usr/bin/env node
// uishoot.mjs — in-game UI screenshotter for StarNet.
//
// This is now a thin BACK-COMPAT alias over the shared runShoot() (scripts/lib/shootRun.mjs),
// the same engine behind `npm run shoot` (scripts/shoot.mjs). It used to carry its own copy of
// the CDP plumbing + a TEXT-matched dock-panel state list whose selectors drifted off current
// trunk; that logic now lives in scripts/lib/* with STABLE id/[data-term] selectors, a SEEDED
// in-game boot (no more title-screen captures), and a cold-boot-race guard.
//
// WHY CDP + a fixed wall-clock wait: preview_screenshot and `chrome --virtual-time-budget` both
// hang on StarNet's always-animating canvas. Driving Chrome over CDP and capturing on a timer is
// the proven unlock. Prefer `npm run shoot`; this name is kept so older docs/commands still work.
//
// Usage (unchanged):
//   node scripts/uishoot.mjs                 # capture every UI state
//   node scripts/uishoot.mjs --only ingame   # one state
//   SKYNET_SHOT_PORT=8930 SKYNET_SHOT_DIR=.uishots-trunk node scripts/uishoot.mjs --boot
// (`--boot` is now implicit: a seeded sidecar is auto-started if none is up on the port.)
import { join } from 'node:path';
import { runShoot } from './lib/shootRun.mjs';

const onlyIdx = process.argv.indexOf('--only');
const exitCode = await runShoot({
  port: process.env.SKYNET_SHOT_PORT || '8920',
  cdpPort: Number(process.env.SKYNET_CDP_PORT || 9325),
  outDir: process.env.SKYNET_SHOT_DIR || join(process.cwd(), '.uishots'),
  win: process.env.SKYNET_SHOT_SIZE || '1440,900',
  only: onlyIdx > -1 ? process.argv[onlyIdx + 1] : null,
  keep: process.argv.includes('--keep'),
}).catch((e) => { console.error('FATAL', e); return 1; });
process.exit(exitCode);
