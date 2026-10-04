/* node test/agent-config-target.test.js — a dossier config edit must land on the agent whose dossier is OPEN.

   THE BUG (reported on v0.6.6, "I add context to my agents, save it, and it always erases to zero"):
   the dossier's four .md editors were the ONE per-agent control that never named its target. Every neighbour
   on that same panel already passed an id (setAgentModelPin / setAgentPersona / setAgentApproval /
   setAgentWorkshop / setAgentName / setAgentSkin); `access.config.apply({[key]: val})` did not. So
   applyAgentConfig wrote to the FOCUSED agent — whoever COMMS happened to be on — and then the card repainted
   from the agent actually on screen, whose doc was untouched. On a freshly summoned specialist (purpose /
   context / manual all empty) that repaint reads "0 chars": the erase. The focused agent's own doc was
   silently overwritten in the same stroke, with the toast still claiming the save landed.

   app.js is a browser-flow IIFE (not node-loadable), so — following roster-clause.test.js — applyAgentConfig is
   extracted from the source and EXECUTED against a stub station. Its collaborators are either injected here or
   left undefined so the module's own `typeof X !== 'undefined'` guards skip them.

   Locked: the patch lands on the named agent · bystanders are never written · an omitted/unknown id still means
   "the focused agent" (the awakening, deploySpecialty, the marketplace recruit path and App.applyConfig all call
   it that way) · the recompose follows the target · LIVE side effects (chat prompt, channels) stay focus-only ·
   and the dossier's SAVE button actually passes the selected agent's id. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs'); const path = require('path');
const appjs = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'app.js'), 'utf8');
const stationui = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'stationui.js'), 'utf8');

// ---- extract applyAgentConfig and run it against a stub station ----
const m = appjs.match(/function applyAgentConfig\(patch, agentId\) \{[\s\S]*?\n  \}/);
A.ok(m, 'applyAgentConfig(patch, agentId) found in app.js — the target id is part of the signature');
// no signature, no behaviour to test: report the one real failure instead of crashing the runner on an
// empty extraction (which is exactly what a revert to the id-less applyAgentConfig(patch) would do).
if (!m) A.report('agent-config-target.test');
const SRC = m[0];

// build a two-agent station focused on `focusId`; returns the callable + the live objects + side-effect spies.
// composeSystemPrompt models the ONE structural thing that matters here: an orchestrator's prompt embeds the
// live crew's roles (real rosterClause + rosterRole, which read each specialist's purpose), so a stale lead
// prompt is observable. recomposeOrchestrators mirrors app.js's own focused-follows behaviour.
function station(focusId) {
  const mk = (id, name) => ({ id, name, role: id === 'agent' ? 'orchestrator' : 'specialist',
    purpose: '', systemPrompt: 'SYS:' + id + ':', docs: { identity: 'ID-' + id, purpose: '', manual: '', context: '' } });
  const agents = new Map([['agent', mk('agent', 'NOVA')], ['scout', mk('scout', 'SCOUT')]]);
  const spy = { chatSystem: [], syncChannels: 0, pushRoster: 0, persist: 0, recompose: 0 };
  const apply = new Function('CTX', `
    const agents = CTX.agents, spy = CTX.spy;
    let agent = agents.get(CTX.focusId);
    function agentDocs(a) {
      if (!a.docs || typeof a.docs !== 'object') a.docs = {};
      for (const k of ['identity', 'purpose', 'manual', 'context']) if (typeof a.docs[k] !== 'string') a.docs[k] = '';
      return a.docs;
    }
    function crewClause(a) {
      if (a.role !== 'orchestrator') return '';
      return '|CREW:' + [...agents.values()].filter(x => x.id !== a.id).map(x => x.name + '=' + (x.purpose || 'general')).join(',');
    }
    function composeSystemPrompt(a) { return 'SYS:' + a.id + ':' + a.docs.context + crewClause(a); }
    function recomposeOrchestrators() {
      spy.recompose++;
      for (const x of agents.values()) {
        if (x.role !== 'orchestrator') continue;
        x.systemPrompt = composeSystemPrompt(x);
        if (agent && agent.id === x.id) Chat.setSystem(x.systemPrompt);
      }
    }
    function el() { return null; }
    function syncChannels() { spy.syncChannels++; }
    function pushRoster() { spy.pushRoster++; }
    function persist() { spy.persist++; }
    const Chat = { setSystem(s) { spy.chatSystem.push(s); } };
    ${SRC}
    return applyAgentConfig;
  `)({ agents, spy, focusId });
  return { apply, hero: agents.get('agent'), scout: agents.get('scout'), spy };
}

/* ---------- A. THE REPORTED BUG: a specialist's doc edit lands on the specialist ---------- */
{
  const s = station('agent');   // hero focused, dossier open on SCOUT
  s.apply({ context: 'SCOUT-ONLY CONTEXT' }, 'scout');
  A.eq(s.scout.docs.context, 'SCOUT-ONLY CONTEXT', 'the context.md edit lands on the agent whose dossier is open');
  A.eq(s.hero.docs.context, '', 'the FOCUSED agent\'s context.md is not overwritten by a bystander\'s edit');
  A.eq(s.scout.systemPrompt, 'SYS:scout:SCOUT-ONLY CONTEXT', 'the recompose follows the edited agent');
  A.eq(s.hero.systemPrompt, 'SYS:agent:', 'the focused agent\'s composed prompt is untouched');
}

/* ---------- B. the reverse direction: editing the hero while a specialist is focused ---------- */
{
  const s = station('scout');   // SCOUT focused, dossier open on the hero
  s.apply({ purpose: '  HERO PURPOSE  ' }, 'agent');
  A.eq(s.hero.docs.purpose, '  HERO PURPOSE  ', 'purpose.md lands on the hero, verbatim');
  A.eq(s.hero.purpose, 'HERO PURPOSE', 'the agent.purpose mirror (BRIEF tab / summon copy) is trimmed onto the SAME agent');
  A.eq(s.scout.docs.purpose, '', 'the focused specialist does not inherit the hero\'s purpose');
  A.eq(s.scout.purpose, '', 'nor its trimmed mirror');
}

/* ---------- C. back-compat: no id (or an unknown one) still means THE FOCUSED AGENT ---------- */
{
  const s = station('scout');
  s.apply({ manual: 'HOUSE RULES' });                       // the awakening / deploySpecialty / slash shape
  A.eq(s.scout.docs.manual, 'HOUSE RULES', 'an omitted agentId re-specs the focused agent (every existing caller)');
  A.eq(s.hero.docs.manual, '', 'and only the focused agent');
  s.apply({ identity: 'REWRITTEN' }, 'ghost-agent-that-left');
  A.eq(s.scout.docs.identity, 'REWRITTEN', 'an unknown id falls back to the focused agent — a write is never silently dropped');
}

/* ---------- D. every doc key is targeted (the bug hit all four, not just context.md) ---------- */
{
  const s = station('agent');
  s.apply({ identity: 'I', purpose: 'P', manual: 'M', context: 'C' }, 'scout');
  A.eq([s.scout.docs.identity, s.scout.docs.purpose, s.scout.docs.manual, s.scout.docs.context], ['I', 'P', 'M', 'C'], 'identity/purpose/operating-manual/context all land on the named agent');
  A.eq([s.hero.docs.identity, s.hero.docs.purpose, s.hero.docs.manual, s.hero.docs.context], ['ID-agent', '', '', ''], 'the focused agent keeps all four of its own docs');
}

/* ---------- E. non-doc fields are targeted too (they ride the same patch) ---------- */
{
  const s = station('agent');
  s.apply({ model: 'anthropic/claude-sonnet-4-5', approvalMode: 'full', workshop: true }, 'scout');
  A.eq(s.scout.model, 'anthropic/claude-sonnet-4-5', 'a model in the patch pins the named agent');
  A.eq(s.scout.approvalMode, 'full', 'approval posture is per-agent');
  A.eq(s.scout.workshop, true, 'the away-workshop grant is per-agent');
  A.eq(s.hero.model, undefined, 'the focused agent\'s transport is not retargeted by a bystander edit');
  A.eq(s.hero.approvalMode, undefined, 'nor its approval posture');
}

/* ---------- F. LIVE side effects belong to the focused agent only ---------- */
{
  const away = station('agent');
  away.apply({ context: 'C' }, 'scout');
  A.eq(away.spy.chatSystem, [], 'a bystander\'s prompt is never pushed into the running COMMS session');
  A.eq(away.spy.syncChannels, 0, 'nor re-points a connected Telegram bot at the wrong identity');
  A.eq(away.spy.pushRoster, 1, 'the sidecar roster still learns the new prompt (delegation + cron runs read it)');
  A.eq(away.spy.persist, 1, 'and the edit is persisted');

  const live = station('agent');
  live.apply({ context: 'C' }, 'agent');
  A.eq(live.spy.chatSystem, ['SYS:agent:C|CREW:SCOUT=general'], 'editing the FOCUSED agent hands the recomposed prompt to the live chat');
  A.eq(live.spy.syncChannels, 1, 'and re-syncs its channels');
}

/* ---------- G. THE CACHED-PROMPT TRAP: re-purposing a specialist re-composes the lead ----------
   rosterRole() reads a crew member's purpose, and the lead's "YOUR CREW: <name> — <role>" line is baked into
   its STORED systemPrompt (roster-clause.test §D locks the same trap for summon / rehydrate / rename). Before
   this was wired, a purpose.md edit on a specialist left the orchestrator briefing itself — and the sidecar —
   on a job that specialist no longer had. */
{
  const s = station('agent');
  A.eq(s.hero.systemPrompt, 'SYS:agent:', 'baseline: the lead carries its stored prompt');
  s.apply({ purpose: 'hunts flaky tests' }, 'scout');
  A.eq(s.spy.recompose, 1, 'a specialist re-purpose recomposes the orchestrators');
  A.eq(s.hero.systemPrompt, 'SYS:agent:|CREW:SCOUT=hunts flaky tests', 'the lead\'s crew line carries the specialist\'s NEW purpose');
  A.eq(s.spy.chatSystem, ['SYS:agent:|CREW:SCOUT=hunts flaky tests'], 'the focused lead\'s own live session follows (its prompt genuinely changed)');
  A.ok(s.spy.recompose <= s.spy.pushRoster, 'the recompose lands BEFORE the roster push, so the pushed lead prompt is fresh');
}
{
  // …and only when the crew line can actually move: a doc that is not part of rosterRole costs nothing.
  const quiet = station('agent');
  quiet.apply({ context: 'C', manual: 'M', identity: 'I' }, 'scout');
  A.eq(quiet.spy.recompose, 0, 'context/manual/identity edits do not touch the crew line, so no needless recompose');
  const own = station('agent');
  own.apply({ purpose: 'P' }, 'agent');
  A.eq(own.spy.recompose, 0, 'the orchestrator editing its OWN purpose is already recomposed in place — no second pass');
}

/* ---------- H. the dossier SAVE button names the agent it is showing ---------- */
A.ok(stationui.indexOf('access.config.apply({ [key]: val }, a && a.id)') >= 0, 'the .md SAVE handler passes the selected agent\'s id');
A.ok(stationui.indexOf('access.config.apply({ [key]: val })') === -1, 'the id-less call (the erase) is gone');
A.ok(/function wireConfig\(body\) \{[\s\S]{0,600}const a = present\[sel\];/.test(stationui), 'wireConfig resolves the selected agent BEFORE wiring the .md editors');
// parity: no per-agent control on the dossier may go back to being id-less.
A.eq((stationui.match(/access\.config\.(apply|setModel|setPersona|setApproval|setWorkshop|setName|setSkin)\(/g) || []).length,
     // accepted id-carrying shapes: the dossier's `a && a.id`, setSkin's `a.id`, and the settings
     // PERMISSIONS pane's approval rows (`setApproval(id, …)` from the row's data attr / `setApproval(a.id, …)`
     // in the whole-station loops) — every shape still passes an explicit agent id as the first argument.
     (stationui.match(/access\.config\.(apply|setModel|setPersona|setApproval|setWorkshop|setName|setSkin)\([^)]*a(?:gent)?\s*&&\s*a\.id|access\.config\.setSkin\(a\.id|access\.config\.setApproval\((?:id|a\.id),/g) || []).length,
     'every per-agent dossier control passes the selected agent\'s id');

A.report('agent-config-target.test');
