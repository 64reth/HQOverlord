/* node test/session-creation.test.js — PU-13 blank-session coalescing.
   A +NEW action is idempotent while the active session is still untouched; real content
   makes the next action mint a genuinely new session, and only those legitimate rows persist. */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');
const W = require('../frontend/app/workstreams.js');

/* ---------- five synchronous +NEW actions coalesce onto one untouched row ---------- */
W.reset();
const first = W.active();
const opened = [];
for (let i = 0; i < 5; i++) opened.push(W.startSession());
A.eq(W.list().length, 1, 'five synchronous +NEW actions from a blank station leave one session row');
A.ok(opened.every(w => w === first), 'every rapid +NEW action focuses the same untouched session');
A.eq(W.activeId(), first.id, 'the coalesced blank remains active');

/* ---------- content makes the next +NEW legitimate ---------- */
first.history.push({ role: 'user', content: 'real work begins here' });
const second = W.startSession();
A.ok(second.id !== first.id, 'content then +NEW creates a distinct session');
A.eq(W.list().length, 2, 'only the content-bearing session and its new blank exist');

/* ---------- reload preserves only legitimate rows; rapid actions stay idempotent ---------- */
const saved = JSON.parse(JSON.stringify(W.serialize()));
W.init(saved);
A.eq(W.list().length, 2, 'reload preserves the two legitimate sessions');
const reloadedBlank = W.active();
for (let i = 0; i < 5; i++) A.ok(W.startSession() === reloadedBlank, 'post-reload +NEW reuses the active untouched blank');
A.eq(W.list().length, 2, 'reload plus rapid +NEW never resurrects duplicate blanks');

/* ---------- project +NEW only coalesces inside the same stored project scope ---------- */
W.reset();
const scoped = W.startSession({ projectRoot: 'C:\\projects\\alpha' });
A.eq(W.list().length, 2, 'entering a project from unscoped General creates one anchored session');
A.eq(scoped.projectRoot, 'C:\\projects\\alpha', 'project session carries its real root');
A.ok(W.startSession({ projectRoot: 'C:\\projects\\alpha' }) === scoped, 'same-project +NEW reuses its untouched blank');
const other = W.startSession({ projectRoot: 'C:\\projects\\beta' });
A.ok(other !== scoped, 'another project cannot steal or re-anchor the existing blank');
A.eq(W.list().length, 3, 'different project scope creates exactly one additional row');

/* ---------- both shipped +NEW handlers use the coalescing seam ---------- */
const app = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'app.js'), 'utf8');
A.ok(/function newWorkstream\(\)[\s\S]{0,220}Workstreams\.startSession\(/.test(app), 'global +NEW uses Workstreams.startSession');
A.ok(/function newSessionInProject\(root\)[\s\S]{0,260}Workstreams\.startSession\(\{[\s\S]{0,100}projectRoot:\s*root/.test(app), 'project +NEW uses the same scoped coalescing seam');

A.report('session-creation.test');
