/* node test/model-ack-honesty.test.js — /model must warn (not block) on ids the warmed catalog doesn't know.

   Adversarial sweep 2026-07-14, F4: `/model asdf/not-a-model-9000` acked "Model set … for future runs."
   with zero check against the warmed catalog; every subsequent real-provider run 404'd ("No endpoints
   found") while /whoami reported the dead id as live. Fix direction (sandbox law): warn-not-block at
   the ack seam — the id STAYS set (custom endpoints legitimately serve ids the catalog doesn't list),
   but the ack is followed by an honest catalog warning. An EMPTY catalog (sidecar offline / cold
   warm-up) is uncertainty, not evidence — it must never warn.

   chat.js is browser-flow (DOM + streaming), not node-loadable — the pure ack-warning judgment is
   extracted from the source and executed directly (the beat-coordination mold); the wiring into
   modelCommand is locked at the source (the steer-idle-honesty mold). */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../frontend/app/chat.js'), 'utf8');

// ---- pure judgment: extract modelAckWarning and run it ----
const pure = /function\s+modelAckWarning\s*\(id,\s*list\)\s*\{([\s\S]*?)\n  \}/.exec(src);
A.ok(pure, 'modelAckWarning exists in chat.js');
const modelAckWarning = new Function('id', 'list', pure ? pure[1] : 'return ""');

const catalog = [{ id: 'openai/gpt-5' }, { id: 'anthropic/claude-fable-5' }, { id: 'x-ai/grok-4' }];

A.eq(modelAckWarning('openai/gpt-5', catalog), '', 'a catalog-known id acks silently');
A.eq(modelAckWarning('asdf/not-a-model-9000', []), '', 'an EMPTY catalog never warns (offline is uncertainty, not evidence)');
A.eq(modelAckWarning('asdf/not-a-model-9000', null), '', 'a missing catalog never warns');

const warn = modelAckWarning('asdf/not-a-model-9000', catalog);
A.ok(/Warning/.test(warn), 'an unknown id against a warm catalog produces a warning');
A.ok(warn.includes('asdf/not-a-model-9000'), 'the warning names the exact id');
A.ok(/stays set/.test(warn), 'warn-not-block: the warning says the id stays set (sandbox law)');
A.ok(/model-not-found/.test(warn), 'the warning names the real failure mode');
A.ok(warn.includes('3 known ids'), 'the warning reports the catalog size it judged against');

// ---- wiring: modelCommand must consult the catalog after a successful set ----
const cmd = /function\s+modelCommand\s*\(args\)\s*\{([\s\S]*?)\n  \}/.exec(src);
A.ok(cmd, 'modelCommand exists in chat.js');
const body = cmd ? cmd[1] : '';
A.ok(/if\s*\(set\)\s*warnUnknownModel\(next\)/.test(body), 'a successful set triggers the catalog check (warn path wired)');
A.ok(/Model set to/.test(body), 'the ack line itself is unchanged — the id is still applied (never blocked)');

// warnUnknownModel must read the WARMED catalog through Harness.listModels, and stay fail-silent.
const wum = /async function\s+warnUnknownModel\s*\(id\)\s*\{([\s\S]*?)\n  \}/.exec(src);
A.ok(wum, 'warnUnknownModel exists in chat.js');
A.ok(/Harness\.listModels/.test(wum ? wum[1] : ''), 'the warning judges against the live warmed catalog (Harness.listModels)');
A.ok(/catch\s*\(_\)\s*\{\s*\}/.test(wum ? wum[1] : ''), 'a catalog failure never breaks the ack (fail-silent)');

A.report('model-ack-honesty.test');
