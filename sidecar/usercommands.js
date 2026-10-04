/* sidecar/usercommands.js — COMMANDER-DEFINED slash commands.

   Lets the Commander add their own commands without touching code, in the shape the reference harness proved
   (© 2025 Nous Research, MIT — see NOTICE.md; its `quick_commands` config block has the same two types):

     alias — "/standup" runs "/routine list". Pure rewrite; the target is re-resolved through the registry,
             so an alias can never reach anything the Commander could not have typed themselves.
     exec  — "/disk" runs a shell snippet and prints its output.

   WHY THE FILE LIVES OUTSIDE THE AGENT JAIL. The reference harness's safety argument for shell-typed commands
   is that they are "user-defined shell snippets from config.yaml — not agent/LLM controlled". That argument
   only holds while an agent cannot author them, so this store sits beside the channel secrets in WORKSPACES
   root — NOT under WORKSPACES/<agentId>/ — where the fs jail keeps every agent's own tools out. If these ever
   move inside a jail, exec becomes a prompt-injection vector and must be disabled with them.

   Pure + injected fs so it is testable without touching a disk. */
'use strict';

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;   // same grammar the slash registry enforces
const MAX_COMMANDS = 100;
const MAX_CMD_LEN = 2000;

function makeUserCommands(deps) {
  const d = deps || {};
  const fs = d.fs;
  const file = d.file;
  const onWarn = typeof d.onWarn === 'function' ? d.onWarn : () => {};

  function readRaw() {
    try {
      if (!fs || !fs.existsSync || !fs.existsSync(file)) return null;
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) { onWarn('user commands unreadable: ' + ((e && e.message) || e)); return null; }
  }

  /* normalize(raw) -> { commands:[…], errors:[…] }. A malformed ENTRY is dropped with a named reason rather
     than failing the whole file — one typo must not silently remove every command the Commander defined. */
  function normalize(raw) {
    const out = [], errors = [];
    const list = (raw && Array.isArray(raw.commands)) ? raw.commands : [];
    const seen = Object.create(null);
    for (const item of list) {
      const c = item || {};
      const name = String(c.name || '').trim().toLowerCase().replace(/^\//, '');
      if (!NAME_RE.test(name)) { errors.push('bad name: ' + JSON.stringify(c.name)); continue; }
      if (seen[name]) { errors.push('duplicate: /' + name); continue; }
      const type = String(c.type || '').trim().toLowerCase();
      if (type === 'alias') {
        const target = String(c.target || '').trim();
        if (!target) { errors.push('/' + name + ' has no target'); continue; }
        seen[name] = 1;
        out.push({ name: name, type: 'alias', target: target.charAt(0) === '/' ? target : ('/' + target), desc: String(c.desc || c.description || '').slice(0, 200) });
      } else if (type === 'exec') {
        const command = String(c.command || '').trim();
        if (!command) { errors.push('/' + name + ' has no command'); continue; }
        if (command.length > MAX_CMD_LEN) { errors.push('/' + name + ' command is too long'); continue; }
        seen[name] = 1;
        out.push({ name: name, type: 'exec', command: command, desc: String(c.desc || c.description || '').slice(0, 200) });
      } else {
        errors.push('/' + name + ' has unsupported type ' + JSON.stringify(c.type) + " (use 'alias' or 'exec')");
      }
      if (out.length >= MAX_COMMANDS) { errors.push('stopped at the ' + MAX_COMMANDS + '-command cap'); break; }
    }
    return { commands: out, errors: errors };
  }

  function load() {
    const n = normalize(readRaw());
    for (const e of n.errors) onWarn(e);
    return n.commands;
  }

  // the shape sidecar/slash.js folds into its catalog
  function catalogEntries(list) {
    return (list || []).map(c => ({
      name: c.name,
      category: 'Yours',
      desc: c.desc || (c.type === 'alias' ? ('runs ' + c.target) : ('runs: ' + String(c.command).slice(0, 60))),
      source: 'user',
      userType: c.type,
      target: c.type === 'alias' ? c.target : '',
      command: c.type === 'exec' ? c.command : ''
    }));
  }

  return { load: load, normalize: normalize, catalogEntries: catalogEntries, NAME_RE: NAME_RE, MAX_COMMANDS: MAX_COMMANDS };
}

module.exports = { makeUserCommands, NAME_RE, MAX_COMMANDS, MAX_CMD_LEN };
