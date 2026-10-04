'use strict';

const fs = require('node:fs');
const path = require('node:path');
const A = require('./_assert.js');

const root = path.resolve(__dirname, '..');
const appCss = fs.readFileSync(path.join(root, 'frontend', 'css', 'app.css'), 'utf8');
const commsCss = fs.readFileSync(path.join(root, 'frontend', 'css', 'comms.css'), 'utf8');

// Transcript prose and the terse quest/trophy broadcast use separate renderers. The ordinary
// message path already wrapped, while broadcasts forced one intrinsic-width line and made the
// whole COMMS scroller wider than its panel. Keep both paths bounded to the live panel width.
A.ok(/\.cmsg\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s.test(appCss),
  'every COMMS message row may shrink to the transcript width');
A.ok(/\.cmsg \.body\s*\{[^}]*white-space:\s*pre-wrap;[^}]*overflow-wrap:\s*anywhere;[^}]*word-break:\s*break-word;/s.test(appCss),
  'ordinary conversation text wraps, including long unbroken tokens');
A.ok(/\.cmsg\.broadcast \.bc-stack\s*\{[^}]*min-width:\s*0;/s.test(commsCss),
  'the broadcast stack may shrink between its decorative hairlines');
A.ok(/\.cmsg\.broadcast \.bc-line\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;[^}]*word-break:\s*break-word;/s.test(commsCss),
  'quest, trophy, and level broadcasts wrap inside narrow COMMS panels');
A.ok(!/\.cmsg\.broadcast \.bc-line\s*\{[^}]*white-space:\s*nowrap;/s.test(commsCss),
  'broadcast text never restores the intrinsic-width overflow that clipped quest titles');

A.report('comms-responsive-text.test');
