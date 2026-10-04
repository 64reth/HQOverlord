#!/usr/bin/env node
// shoot.mjs — THE one-command in-game UI screenshotter for StarNet.  (`npm run shoot`)
//
// What it guarantees (P0 definition-of-done):
//   1. Boots a SEEDED, pre-onboarded sidecar (lands on the live floor, not the title screen),
//      reusing an already-running sidecar on the port if there is one.
//   2. Waits until the page is verifiably IN-GAME (dev hook set + #screen-game active) before
//      capturing — defeats the cold-boot race where a fresh sidecar's first load shows the title.
//   3. Captures real PNG frames of every key state: the floor at rest + all 16 dock panels.
//   4. Writes a manifest (which selector opened, frame size, console errors) and exits NONZERO if
//      any panel failed to open or the boot never reached the floor — CI/loop-grade, not eyeball-grade.
//
// Usage:
//   npm run shoot                      # full sweep → .uishots/
//   node scripts/shoot.mjs --only ingame
//   SKYNET_SHOT_PORT=8932 SKYNET_CDP_PORT=9332 SKYNET_SHOT_DIR=.uishots-x npm run shoot
//   node scripts/shoot.mjs --keep      # keep the scratch workspace + browser profile
//
// Pick free SKYNET_SHOT_PORT / SKYNET_CDP_PORT so you don't collide with another session's sidecar.
import { join } from 'node:path';
import { runShoot } from './lib/shootRun.mjs';

const onlyIdx = process.argv.indexOf('--only');
const exitCode = await runShoot({
  port: process.env.SKYNET_SHOT_PORT || '8930',
  cdpPort: Number(process.env.SKYNET_CDP_PORT || 9330),
  outDir: process.env.SKYNET_SHOT_DIR || join(process.cwd(), '.uishots'),
  win: process.env.SKYNET_SHOT_SIZE || '1440,900',
  only: onlyIdx > -1 ? process.argv[onlyIdx + 1] : null,
  keep: process.argv.includes('--keep'),
}).catch((e) => { console.error('FATAL', e); return 1; });
process.exit(exitCode);
