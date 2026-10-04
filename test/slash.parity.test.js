/* node test/slash.parity.test.js -- the slash registry and the browser's fallback list must agree, field by field.

   WHY THIS EXISTS. Every command is declared TWICE: once in sidecar/slash.js (the server catalog) and once in
   frontend/app/chat.js's FALLBACK_SLASH_COMMANDS (what the palette shows before the catalog fetch lands, or when
   the sidecar is unreachable). Nothing compared them, so they drifted silently — a user saw different help text
   for the same command depending on whether a fetch had returned yet, and argsHints published by the registry
   were simply absent from the fallback, so arg-taking commands looked arg-less on a cold start.

   These are pure metadata assertions: they cannot fail for any reason except a real disagreement. */
'use strict';

const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const S = require('../sidecar/slash.js');

const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'chat.js'), 'utf8');

// Pull the FALLBACK_SLASH_COMMANDS array out of chat.js and evaluate it. The entries are pure Object.freeze
// literals with no identifiers, so this is a total, deterministic parse — not a heuristic grep.
const start = src.indexOf('const FALLBACK_SLASH_COMMANDS = Object.freeze([');
A.ok(start >= 0, 'chat.js declares FALLBACK_SLASH_COMMANDS');
const open = src.indexOf('[', start);
let depth = 0, end = -1;
for (let i = open; i < src.length; i++) {
  if (src[i] === '[') depth++;
  else if (src[i] === ']') { depth--; if (depth === 0) { end = i; break; } }
}
A.ok(end > open, 'the fallback array literal terminates');
let fallback = [];
try { fallback = eval(src.slice(open, end + 1)); } catch (e) { A.ok(false, 'fallback array parses: ' + e.message); }

const norm = c => ({
  name: c.name,
  aliases: (c.aliases || []).slice().sort(),
  desc: c.desc || '',
  argsHint: c.argsHint || '',
  action: c.action || c.name
});
const reg = S.BUILTIN_COMMANDS.map(norm).sort((a, b) => (a.name < b.name ? -1 : 1));
const fbk = fallback.map(norm).sort((a, b) => (a.name < b.name ? -1 : 1));

A.eq(fbk.map(c => c.name), reg.map(c => c.name), 'the fallback list carries exactly the registry commands');

const byName = new Map(fbk.map(c => [c.name, c]));
for (const r of reg) {
  const f = byName.get(r.name);
  if (!f) continue;   // the name-set assertion above already reported this
  A.eq(f.aliases, r.aliases, '/' + r.name + ' aliases match the registry');
  A.eq(f.desc, r.desc, '/' + r.name + ' description matches the registry');
  // argsHint is what renderSlash paints next to the name — a fallback that omits it makes an arg-taking
  // command look arg-less until the catalog lands.
  A.eq(f.argsHint, r.argsHint, '/' + r.name + ' argsHint matches the registry');
  A.eq(f.action, r.action, '/' + r.name + ' action matches the registry');
}

// A dispatch:'server' command must have NO local handler, or the browser would shadow the sidecar's answer with
// its own — which is exactly the class of bug that made /usage and /tools lie.
const serverNames = S.BUILTIN_COMMANDS.filter(c => c.dispatch === 'server').map(c => c.name);
A.ok(serverNames.length > 0, 'there is at least one server-executed command to check');
const mapStart = src.indexOf('function localSlashActions()');
const mapEnd = src.indexOf('}', src.indexOf('return {', mapStart));
const mapSrc = src.slice(mapStart, mapEnd);
for (const n of serverNames) {
  const key = /^[a-z][a-z0-9]*$/.test(n) ? (n + ':') : ("'" + n + "':");
  A.ok(mapSrc.indexOf(key) === -1, '/' + n + ' is server-executed and has no local handler shadowing it');
}

A.report('slash.parity.test');
