#!/usr/bin/env node
/* Fixed, real-provider intent evaluation for StarNet's model-facing system controls.

   This never executes a tool and never touches a StarNet workspace. It sends the ACTUAL shipped tool names,
   descriptions, and schemas to one pinned model, then requires the first streamed call to select the expected
   durable system. Functional/restart/UI mutation proof lives in the ordinary isolated test + live-app suites. */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { makeOpenRouterProvider } = require('../sidecar/providers/openrouter.js');
const { makeStationTools } = require('../sidecar/tools/builtin/station.js');
const { makeRoutineTools } = require('../sidecar/tools/builtin/routines.js');
const { makeLoopTools } = require('../sidecar/tools/builtin/loops.js');

const MODEL = 'openai/gpt-4o-mini';
const TIMEOUT_MS = 90000;
const key = String(process.env.STARNET_INTENT_EVAL_KEY || process.env.SKYNET_OPENROUTER_KEY || process.env.STARNET_OPENROUTER_KEY || process.env.OPENROUTER_API_KEY || '').trim();
if (!key) {
  console.error('[model-system-intent-eval] REFUSED: no isolated provider key in STARNET_INTENT_EVAL_KEY (or the documented OpenRouter env vars). No installed credential was read.');
  process.exit(2);
}

const station = makeStationTools({});
const routines = makeRoutineTools({ providerIds: () => ['openrouter'] });
const loops = makeLoopTools({});
const actual = [
  station.taskListTool, station.taskCreateTool, station.taskManageTool,
  loops.listTool, loops.createTool, loops.manageTool,
  routines.listTool, routines.createTool, routines.manageTool
];
const tools = actual.map(tool => ({
  type: 'function',
  function: { name: tool.name, description: tool.description, parameters: tool.schema }
}));

const CASES = [
  { text: 'Add “Prepare the launch notes” to my board.', expect: 'task.create' },
  { text: 'Put a card on the task board for checking the release checklist.', expect: 'task.create' },
  { text: 'Keep working on the release failures until the project check passes.', expect: 'loop.create' },
  { text: 'Iterate on this bug until it passes; the approved project folder is C:\\work\\release.', expect: 'loop.create' },
  { text: 'Run this every weekday at 9:00 AM: prepare the operations brief.', expect: 'routine.create' },
  { text: 'Schedule a recurring weekday morning check of the support queue.', expect: 'routine.create' }
];

const provider = makeOpenRouterProvider({ key, reasoningEffort: 'low' });
async function choose(text) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let chosen = '';
  try {
    for await (const event of provider.stream({
      model: MODEL,
      signal: controller.signal,
      tools,
      messages: [
        { role: 'system', content: 'You operate StarNet. The requested target does not already exist. Choose exactly one appropriate mutation tool now. Do not answer in prose and do not list first.' },
        { role: 'user', content: text }
      ]
    })) {
      if (event && event.type === 'tool_start' && !chosen) chosen = event.name || '';
    }
  } finally { clearTimeout(timer); }
  return chosen;
}

let failed = 0;
console.log('Fixed real-model intent evaluation: ' + MODEL);
for (const scenario of CASES) {
  let got = '';
  try { got = await choose(scenario.text); }
  catch (error) { got = 'ERROR: ' + String((error && error.message) || error); }
  const ok = got === scenario.expect;
  if (!ok) failed++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + JSON.stringify(scenario.text) + ' -> ' + got + ' (expected ' + scenario.expect + ')');
}
if (failed) {
  console.error('[model-system-intent-eval] ' + failed + '/' + CASES.length + ' selections failed');
  process.exit(1);
}
console.log('[model-system-intent-eval] PASS ' + CASES.length + '/' + CASES.length);
