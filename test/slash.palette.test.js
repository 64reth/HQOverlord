/* node test/slash.palette.test.js -- lightweight regression pins for the chat slash palette wiring. */
'use strict';

const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'chat.js'), 'utf8');

A.ok(src.indexOf('FALLBACK_SLASH_COMMANDS') >= 0, 'palette keeps local fallback commands');
A.ok(src.indexOf("name: 'retry'") >= 0 && src.indexOf("name: 'stop'") >= 0, 'palette fallback includes retry and stop');
A.ok(src.indexOf("name: 'copy'") >= 0 && src.indexOf("name: 'help'") >= 0, 'palette fallback includes copy and help');
A.ok(src.indexOf("name: 'new'") >= 0 && src.indexOf("name: 'branch'") >= 0, 'palette fallback includes new and branch');
A.ok(src.indexOf("name: 'queue'") >= 0 && src.indexOf("name: 'steer'") >= 0, 'palette fallback includes queue and steer');
A.ok(src.indexOf("name: 'undo'") >= 0 && src.indexOf("name: 'compress'") >= 0, 'palette fallback includes undo and compress');
A.ok(src.indexOf("name: 'model'") >= 0 && src.indexOf("name: 'personality'") >= 0, 'palette fallback includes model and personality');
A.ok(src.indexOf("name: 'yolo'") >= 0 && src.indexOf("name: 'tools'") >= 0, 'palette fallback includes yolo and tools');
A.ok(src.indexOf("name: 'skills'") >= 0 && src.indexOf("name: 'reload-skills'") >= 0, 'palette fallback includes skills and reload-skills');
A.ok(src.indexOf("name: 'debug'") >= 0, 'palette fallback includes debug');
A.ok(src.indexOf("name: 'title'") >= 0 && src.indexOf("name: 'resume'") >= 0, 'palette fallback includes title and resume');
A.ok(src.indexOf("name: 'agents'") >= 0 && src.indexOf("name: 'background'") >= 0, 'palette fallback includes agents and background');
A.ok(src.indexOf("name: 'goal'") >= 0 && src.indexOf("name: 'subgoal'") >= 0, 'palette fallback includes goal and subgoal');
A.ok(src.indexOf("name: 'memory'") >= 0 && src.indexOf("name: 'bundles'") >= 0, 'palette fallback includes memory and bundles');
A.ok(src.indexOf("name: 'cron'") >= 0 && src.indexOf("name: 'suggestions'") >= 0, 'palette fallback includes cron and suggestions');
A.ok(src.indexOf("name: 'blueprint'") >= 0 && src.indexOf("name: 'reload-mcp'") >= 0, 'palette fallback includes blueprint and reload-mcp');
A.ok(src.indexOf("name: 'reasoning'") >= 0 && src.indexOf("name: 'fast'") >= 0 && src.indexOf("name: 'voice'") >= 0, 'palette fallback includes mode commands');
A.ok(src.indexOf("name: 'version'") >= 0, 'palette fallback includes version');
A.ok(src.indexOf('newWorkstreamCommand') >= 0 && src.indexOf('branchWorkstreamCommand') >= 0, 'palette maps workflow commands to workstream handlers');
A.ok(src.indexOf('statusCommand') >= 0, 'palette maps the status command');
// /usage and /tools are dispatch:'server' — they must have NO local handler, or the browser's own (lying)
// numbers would silently win whenever the fallback path ran.
A.ok(src.indexOf('function usageCommand') === -1 && src.indexOf('function toolsCommand') === -1, 'the browser-side usage/tools readouts are gone, not merely bypassed');
A.ok(src.indexOf('function toolRows') === -1, 'the hardcoded tool-name table is gone');
// Harness.totals() is still legitimately used for per-run/per-stream cost DELTAS and as /insights' explicitly
// session-labelled fallback. What must never come back is presenting it as lifetime SPEND.
A.ok(src.indexOf("'Usage: lifetime '") === -1, 'no command labels browser-observed totals as lifetime spend');
A.ok(src.indexOf('titleCommand') >= 0 && src.indexOf('resumeCommand') >= 0 && src.indexOf('backgroundCommand') >= 0, 'palette maps Plan5 session commands');
A.ok(src.indexOf('agentsCommand') >= 0 && src.indexOf('goalCommand') >= 0 && src.indexOf('subgoalCommand') >= 0, 'palette maps agent and goal commands');
A.ok(src.indexOf('modelCommand') >= 0 && src.indexOf('personalityCommand') >= 0 && src.indexOf('yoloCommand') >= 0, 'palette maps config commands');
A.ok(src.indexOf('reasoningCommand') >= 0 && src.indexOf('fastCommand') >= 0 && src.indexOf('voiceCommand') >= 0, 'palette maps mode commands');
A.ok(src.indexOf('skillsCommand') >= 0 && src.indexOf('reloadSkillsCommand') >= 0, 'palette maps skills commands');
A.ok(src.indexOf('memoryCommand') >= 0 && src.indexOf('bundlesCommand') >= 0 && src.indexOf('cronCommand') >= 0, 'palette maps Plan6 status commands');
A.ok(src.indexOf('suggestionsCommand') >= 0 && src.indexOf('blueprintCommand') >= 0 && src.indexOf('reloadMcpCommand') >= 0, 'palette maps Plan6 action commands');
A.ok(src.indexOf('versionCommand') >= 0, 'palette maps version command');
A.ok(src.indexOf('/api/slash/catalog') >= 0, 'palette fetches the sidecar slash catalog');
A.ok(src.indexOf('/api/slash/dispatch') >= 0, 'palette dispatches server-backed commands through the sidecar');
A.ok(src.indexOf('/api/cron') >= 0 && src.indexOf('/api/connectors/refresh') >= 0, 'palette uses real cron and MCP endpoints');
A.ok(src.indexOf('slashPlacedTypes') >= 0 && src.indexOf('World.heroCaps') >= 0, 'palette asks the sidecar for commands matching the active agent capabilities');
A.ok(src.indexOf('Recipes.list') >= 0 && src.indexOf("source: 'recipe'") >= 0, 'palette preserves recipe slash commands');
A.ok(src.indexOf('MintStore.candidates') >= 0 && src.indexOf('Recipes.saveCustom') >= 0, 'palette wires recurring-task suggestions to recipe saves');
A.ok(src.indexOf("directive.type === 'insert'") >= 0, 'palette applies insert directives from skill and recipe commands');
A.ok(src.indexOf('rawInput') >= 0, 'palette preserves typed slash arguments during dispatch');
A.ok(src.indexOf('item.serverBacked || typeof item.run !==') >= 0, 'server-backed commands try dispatch before local fallback');

// --- command-doors lane: server-executed commands + the in-session loop ---
A.ok(src.indexOf("name: 'away'") >= 0 && src.indexOf("name: 'routine'") >= 0, 'palette fallback includes the server-executed away and routine commands');
A.ok(src.indexOf("name: 'loop'") >= 0 && src.indexOf('loopCommand') >= 0, 'palette maps the loop command to its handler');
A.ok(src.indexOf("aliases: ['build-away', 'buildaway']") >= 0, 'away keeps the original build-away name reachable');
A.ok(src.indexOf("directive.type === 'say'") >= 0, 'palette prints say directives returned by server-executed commands');
A.ok(src.indexOf('typeof item.run !== ') >= 0, 'a server command with no local action refuses honestly instead of silently doing nothing');
A.ok(src.indexOf('argsHint') >= 0, 'palette carries the registry argsHint so arg-taking commands show their shape');
A.ok(src.indexOf('LOOP_MIN_MS') >= 0 && src.indexOf('LOOP_MAX_ITERS') >= 0, 'the loop carries a minimum cadence and an iteration budget');
A.ok(src.indexOf('loopStop(activeWs.id') >= 0, 'stop ends an armed loop, not just a live run');
// A loop tick goes through send(), which routes text into interview()/TaskIntent when one of those owns the
// input — so an unguarded tick would ANSWER the station's own question. It must obey the same gate /goal does.
A.ok(/goalBlocked\(activeWs\)/.test(src.slice(src.indexOf('function loopTick'), src.indexOf('function loopCommand'))), 'a loop tick obeys goalBlocked, so it cannot answer an interview or approval prompt');
A.ok(src.indexOf('LOOP_MAX_SKIPS') >= 0 && src.indexOf('loopEnded') >= 0, 'a loop that dies unattended is bounded and can still explain itself');
A.ok(src.indexOf('needsServer && await dispatchSlash') >= 0, 'a command with no local action still asks the sidecar before refusing');

// --- NO SILENT COMMANDS. A handler that returns without printing is indistinguishable from a broken app;
// /stop and /retry both used to no-op in silence on their most common empty state. ---
A.ok(src.indexOf('Nothing is running to stop.') >= 0, '/stop says so when there is nothing to stop');
A.ok(src.indexOf('Nothing to retry yet') >= 0, '/retry says so when there is nothing to retry');
A.ok(src.indexOf('This stream is still running — stop it first') >= 0, '/retry explains a busy stream rather than no-opping');
// /yolo TOGGLES on a bare call — the reply must read as a change, never as a status report, because the
// setting it flips is the approval gate.
A.ok(src.indexOf("'Approval mode: ' + was + ' → ' + now") >= 0, '/yolo states the approval transition, not just the resulting state');
A.ok(src.indexOf('Approval mode unchanged: ') >= 0, '/yolo reports an explicit no-op instead of implying a change');

// --- ARGUMENT-VALUE COMPLETION (design ported from the reference harness, MIT — see NOTICE.md) ---
// Static values are DERIVED from each command's argsHint pipe pattern, so a new "[on|off]" command gets
// completion with no per-command wiring. If this regex or its use goes, completion silently dies.
A.ok(src.indexOf('PIPE_VALUES_RE') >= 0 && /PIPE_VALUES_RE\s*=\s*\//.test(src), 'static values are derived from the argsHint pipe pattern');
A.ok(src.indexOf('function staticValuesFor') >= 0 && src.indexOf('function liveValuesFor') >= 0, 'both static and live value providers exist');
A.ok(src.indexOf('function completeSlashValue') >= 0, 'a value can be completed into the composer');
A.ok(/liveValuesFor[\s\S]{0,600}Personas\.list/.test(src), 'personalities come from the live persona list');
A.ok(/liveValuesFor[\s\S]{0,600}Workstreams\.list/.test(src), 'workstream names complete for /resume');
A.ok(src.indexOf('function warmModelValues') >= 0 && src.indexOf('Harness.listModels()') >= 0, '/model completes against the warmed catalog');
// THE LOAD-BEARING CONTRACT: Enter dispatches the COMMAND, never a value row. A regressed Enter is what
// fired "/personality direct" at the model as chat (2026-07-05); Tab is the completer instead.
A.ok(/e\.key === 'Tab' && slashValueMode/.test(src), 'TAB is what accepts a value');
A.ok(/e\.key === 'Enter' && slashValueMode[\s\S]{0,400}commandFromLine\(input\.value\)/.test(src),
  'ENTER in value mode still dispatches the command resolved from the typed line, never the highlighted value');
A.ok(src.indexOf('c.isValue ? c.name') >= 0, 'a value row renders without a leading slash (it is an argument, not a command)');
A.ok(/closeSlash[\s\S]{0,200}slashValueMode = null/.test(src), 'closing the palette leaves value mode');

A.report('slash.palette.test');
