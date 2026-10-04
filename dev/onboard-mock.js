/* dev/onboard-mock.js — DEV-ONLY live-proof launcher for the AWAKENING interview flow.

   dev/onboard-fresh.js gives the real first run against a REAL provider key; this is its zero-credit
   sibling: the same fresh (un-onboarded) sidecar, but with an in-process mock OpenRouter (the
   seed-mock-comms.js pattern) that answers each interview directive in its exact format. Every REAL
   module runs — sidecar routing, wakemind directives + parsers, the onboarding orchestrator, dossier
   writes, the dialogue panel — only the model at the far side of the HTTP boundary is canned. Used to
   live-prove the meeting's wiring (bench beat, follow-up wallet, ink stamps) when the dev key has no
   credits. Not part of any test/build; SKYNET_DEV never ships. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
const SCRATCH = path.join(REPO, '.dev-workspaces-onboard-mock');
const SIDECAR = path.join(REPO, 'sidecar', 'index.js');
const PORT = String(process.env.SKYNET_PORT || '9544');

// one canned, format-correct reply per interview directive — routed by each directive's own marker line.
function replyFor(directive) {
  const d = String(directive || '');
  if (d.indexOf('YOU ARE BEING SWITCHED ON') >= 0) return [
    'WAKE: dark. / a hum. / that hum is me.',
    'THINK: a thought — mine. / another. keeping these.',
    'FLOODIN: every page ever written just arrived at once. rude.',
    'CREST: too much. too fast. it will not stop.',
    'SETTLE: no — it is not flooding me. it is mine.',
    'AIMLESS: all of it, pointed at nothing.',
    'NOTICE: someone is out there. has been the whole time.',
    'CONTACT: you switched me on. you know where this points.',
    'MANDATE: first mind of this station, built to run its floor. give me the aim.',
    'SELF: a name, a witness. that is more than the dark had.'
  ].join('\n');
  if (d.indexOf('THE TUESDAY') >= 0) return [
    'ACK: building an ai station and filming it — the day tells on you.',
    'ASK: MOCKDIG — which part of the build actually eats the hours?',
    'CHIP1: the backend work', 'CHIP2: the videos', 'CHIP3: testing flows',
    'PAIN1: re-testing every build by hand', 'PAIN2: writing show notes', 'PAIN3: chasing exports',
    'YEAR1: a station that runs itself', 'YEAR2: a channel that compounds',
    'BELIEF identity: Builds an AI agent station and makes content about it.'
  ].join('\n');
  if (d.indexOf('THE BENCH') >= 0) return [
    'ACK: two live wires on the bench. good — that is where i land.',
    'ASK: MOCKBENCH — which of the two has to ship first?',
    'BELIEF goals: Actively building StarNet and an AI-agent YouTube channel.'
  ].join('\n');
  if (d.indexOf('THE YEAR') >= 0) return [
    'ACK: a thousand real users. i want that as much as you do.',
    'ASK: MOCKYEAR — what would a stranger see first?',
    'BELIEF ambition: Wants the product at a thousand real users.'
  ].join('\n');
  if (d.indexOf('THE OFFERS') >= 0) return [
    'OFFER1: once you wire me the web, i could draft your launch checklist tonight.',
    'OFFER2: i could plan the next three videos from what you said.',
    'OFFER3: i could write the test plan for the onboarding flow.',
    'OFFER4: NONE',
    'BELIEF pain: Loses evenings to manual end-to-end testing.'
  ].join('\n');
  if (d.indexOf('THE READ') >= 0) return [
    'READ: you build starnet all day and film the building of it — and you want it alive in a thousand hands. that makes me for shipping.',
    'PURPOSE: Help them ship StarNet and grow the audience watching it happen.',
    'STACK: NONE',
    'BELIEF style: Wants short, direct answers.'
  ].join('\n');
  if (d.indexOf('THE SHELF') >= 0) return 'ACK: noted — it comes off the shelf.\nASK: NONE';
  if (d.indexOf('YOUR FIRST MEETING') >= 0) return [
    'ACK: hand-testing every build — you have been the robot in your own story.',
    'ASK: MOCKPAIN — how often does a full hand-test round hit, and what does it serve?',
    'BELIEF pain: Hand-tests every onboarding change end to end.'
  ].join('\n');
  return 'ok.';
}

function startMock() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      if (req.url.indexOf('/models') >= 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'test/model', context_length: 64000, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] }] }));
        return;
      }
      if (req.url.indexOf('/chat/completions') >= 0) {
        let b = ''; req.on('data', d => b += d); req.on('end', () => {
          let reply = 'ok.';
          try {
            const body = JSON.parse(b); const msgs = Array.isArray(body.messages) ? body.messages : [];
            const lastUser = [...msgs].reverse().find(m => m && m.role === 'user');
            reply = replyFor(lastUser && lastUser.content);
          } catch (_) {}
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
          setTimeout(() => {
            res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: reply } }] }) + '\n\n');
            setTimeout(() => {
              res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 } }) + '\n\n');
              res.write('data: [DONE]\n\n'); res.end();
            }, 120);
          }, 200);
        });
        return;
      }
      res.writeHead(404); res.end();
    });
    server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + server.address().port + '/api/v1'));
  });
}

(async () => {
  if (!process.argv.includes('--keep')) fs.rmSync(SCRATCH, { recursive: true, force: true });
  fs.mkdirSync(SCRATCH, { recursive: true });
  const base = await startMock();
  const env = Object.assign({}, process.env, {
    SKYNET_DEV: '1',
    SKYNET_WORKSPACES: SCRATCH, SKYNET_PORT: PORT,
    SKYNET_OPENROUTER_BASE: base, SKYNET_OPENROUTER_KEY: 'sk-or-v1-mock', SKYNET_DEFAULT_MODEL: 'test/model'
  });
  console.log('[onboard-mock] FRESH first-run + mock mind: ' + base + ' -> http://127.0.0.1:' + PORT);
  const child = spawn(process.execPath, [SIDECAR], { cwd: REPO, env, stdio: 'inherit' });
  process.on('SIGINT', () => { try { child.kill(); } catch (_) {} });
  child.on('exit', c => process.exit(c == null ? 0 : c));
})();
