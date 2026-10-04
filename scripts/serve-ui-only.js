#!/usr/bin/env node
/* scripts/serve-ui-only.js — serve frontend/ as STATIC FILES ONLY (no agent engine).
   This is the footgun guard: the static server hands you the STARNET UI but NOTHING behind
   it works — no agents, no web_search, no /api/*, no tools — because the engine isn't here.
   It exists only for pure UI/CSS iteration. For the real product run `npm start`, which
   serves the UI *and* the agent runtime together on http://127.0.0.1:8787.

   We print a loud banner first so this can never masquerade as "the full version". */
'use strict';
const { spawn } = require('child_process');

const PORT = String(parseInt(process.env.SKYNET_UI_PORT, 10) || 8087);   // numeric only — safe to interpolate
const bar = '═'.repeat(58);
console.log('\n' + bar);
console.log('  ⚠  UI ONLY — static files, NO agent engine.');
console.log('     Agents, web search, and every /api/* feature are DEAD here.');
console.log('     This is NOT the full app — use it only for UI/CSS tweaks.');
console.log('');
console.log('     ►  THE FULL PRODUCT:   npm start   →   http://127.0.0.1:8787');
console.log(bar + '\n');

// shell:true is required so Windows can resolve npx.cmd (Node >=20 refuses to spawn .cmd directly),
// and it keeps this cross-platform (/bin/sh -c on POSIX). Pass ONE command string (not an args array)
// to avoid the DEP0190 warning; PORT is coerced to a bare integer above, so there's no injection surface.
const child = spawn('npx -y http-server frontend -c-1 -p ' + PORT, { stdio: 'inherit', shell: true });
child.on('exit', code => process.exit(code == null ? 0 : code));
child.on('error', err => { console.error('failed to launch static server:', err.message); process.exit(1); });
