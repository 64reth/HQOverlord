#!/usr/bin/env node
/* scripts/provider-certify.mjs — REAL-KEY wire certification per advertised provider.
   npm run certify:providers [-- --provider openrouter,xai --model openai/gpt-4o-mini]

   Runs the provider seam (sidecar/providers/factory.js selectProvider) against the LIVE endpoint
   with real credentials and proves, per provider:
     models   — the catalog endpoint answers (or is honestly absent),
     chat     — a streamed completion produces text + a finish + (where supported) usage,
     tools    — a tool definition round-trips to a streamed tool call,
     cancel   — aborting mid-stream ends the generator cleanly (no throw, no hang),
     cost     — usage reconciles through the real cost engine (provider/catalog/unpriced labeled).

   Credentials come ONLY from the registry profile's documented env names (never hardcoded, never
   printed). A provider without a credential is reported SKIP env-blocked — this script never
   fabricates a verdict. Receipts land under .dogfood/provider-certify/ (gitignored evidence, same
   convention as the QA crews). Scope note: this certifies the WIRE seam; restart/auth persistence
   and a real autonomous cycle are app-level proofs that ride the live app, not this script. */
'use strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const factory = require('../sidecar/providers/factory.js');
const { makeCostEngine } = require('../sidecar/cost.js');

const STEP_TIMEOUT_MS = 90000;
const CHAT_PROMPT = 'Reply with exactly: OK';
const TOOL_PROMPT = 'Call the starnet_ping tool now. Do not answer in prose.';
const PING_TOOL = [{
  type: 'function',
  function: {
    name: 'starnet_ping',
    description: 'Reports harness readiness. When asked to ping, call this tool.',
    parameters: { type: 'object', properties: { note: { type: 'string' } }, required: [] }
  }
}];
// Cheap, tool-capable defaults for catalogs too large (or too absent) to pick from blind.
const DEFAULT_MODEL = {
  openrouter: 'openai/gpt-4o-mini',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-latest',
  gemini: 'gemini-2.0-flash',
  xai: 'grok-3-mini',
  groq: 'llama-3.3-70b-versatile',
  mistral: 'mistral-small-latest',
  deepseek: 'deepseek-chat',
  together: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  fireworks: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
  perplexity: 'sonar',
  cerebras: 'llama-3.3-70b'
};

function parseArgs(argv) {
  const out = { providers: null, model: null, receipts: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--provider' || a === '--providers') out.providers = String(argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--model') out.model = String(argv[++i] || '').trim();
    else if (a === '--receipts') out.receipts = String(argv[++i] || '').trim();
    else if (a === '--help' || a === '-h') { out.help = true; }
  }
  return out;
}

function envCredential(profile) {
  for (const name of (profile.keyEnv || [])) {
    const v = process.env[name];
    if (v && String(v).trim()) return { key: String(v).trim(), from: name };
  }
  return null;
}
function envBaseUrl(profile) {
  for (const name of (profile.baseUrlEnv || [])) {
    const v = process.env[name];
    if (v && String(v).trim()) return String(v).trim();
  }
  return profile.baseUrl || '';
}

function withTimeout(promise, ms, label) {
  let t;
  const gate = new Promise((_, reject) => { t = setTimeout(() => reject(new Error(label + ' timed out after ' + ms + 'ms')), ms); });
  return Promise.race([promise, gate]).finally(() => clearTimeout(t));
}

async function drainStream(provider, req, opts) {
  opts = opts || {};
  const got = { text: '', usage: null, finish: null, toolStarts: [], events: 0 };
  const run = (async () => {
    for await (const ev of provider.stream(req)) {
      got.events++;
      if (!ev) continue;
      if (ev.type === 'text') got.text += ev.delta || '';
      else if (ev.type === 'usage') got.usage = ev.usage;
      else if (ev.type === 'tool_start') got.toolStarts.push(ev.name || '');
      else if (ev.type === 'done') got.finish = ev.finishReason || 'done';
      if (opts.onEvent) opts.onEvent(ev, got);
    }
  })();
  await withTimeout(run, STEP_TIMEOUT_MS, opts.label || 'stream');
  return got;
}

function isConnRefused(e) {
  const m = String((e && e.message) || e || '');
  return /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(m) && !/http \d{3}/.test(m);
}

async function certifyProvider(id, cliModel) {
  const profile = factory.getProviderProfile(id);
  const steps = {};
  const receipt = { provider: id, at: new Date().toISOString(), model: null, steps, verdict: 'SKIP' };
  const skip = (why) => { receipt.verdict = 'SKIP'; receipt.why = why; return receipt; };

  if (!profile) return skip('unknown provider');
  if (profile.authType === 'oauth_device_code') return skip('OAuth sign-in flow — certify via the live app, not this script');
  if (profile.requiresBaseUrl && !envBaseUrl(profile)) return skip('needs a base URL (' + (profile.baseUrlEnv || []).join('/') + ')');
  const cred = envCredential(profile);
  if (profile.keyRequired && !cred) return skip('env-blocked: no key in ' + (profile.keyEnv || []).join('/'));

  let provider;
  try {
    provider = factory.selectProvider({ provider: id, fetch: globalThis.fetch, key: cred ? cred.key : '', baseUrl: envBaseUrl(profile) });
  } catch (e) { steps.init = { status: 'FAIL', detail: String(e && e.message || e) }; receipt.verdict = 'FAIL'; return receipt; }

  // 1) models — the adapter swallows connection errors into an empty catalog, so an empty result
  // gets a direct reachability probe: unreachable endpoint = SKIP (nothing to certify against),
  // reachable-but-empty = a real observation.
  let models = [];
  try {
    models = await withTimeout(provider.listModels(), STEP_TIMEOUT_MS, 'listModels');
    if (!models.length) {
      try { await withTimeout(globalThis.fetch(envBaseUrl(profile) + (profile.modelsPath || '/models')), 10000, 'probe'); }
      catch (e) { return skip('endpoint unreachable (' + envBaseUrl(profile) + ')'); }
    }
    steps.models = { status: models.length ? 'PASS' : 'WARN', detail: models.length + ' model(s) listed' + (models.length ? '' : ' (endpoint reachable, no usable catalog)') };
  } catch (e) {
    if (isConnRefused(e)) return skip('endpoint unreachable (' + envBaseUrl(profile) + ')');
    steps.models = { status: 'FAIL', detail: String(e && e.message || e) };
  }

  // model choice: explicit > provider default > first tool-capable catalog entry > first entry
  const model = cliModel || DEFAULT_MODEL[id] ||
    (models.find(m => m.supportsTools === true) || models[0] || {}).id;
  receipt.model = model || null;
  if (!model) { steps.chat = { status: 'FAIL', detail: 'no model to certify (empty catalog, no default)' }; receipt.verdict = 'FAIL'; return receipt; }

  // 2) streamed chat (+ usage capture for the cost step)
  let chatUsage = null;
  try {
    const got = await drainStream(provider, { model, messages: [{ role: 'user', content: CHAT_PROMPT }] }, { label: 'chat' });
    chatUsage = got.usage;
    const ok = got.text.trim().length > 0 && !!got.finish;
    steps.chat = { status: ok ? 'PASS' : 'FAIL', detail: 'text=' + JSON.stringify(got.text.trim().slice(0, 40)) + ' finish=' + got.finish + ' usage=' + (got.usage ? 'yes' : 'no') };
  } catch (e) {
    if (isConnRefused(e)) return skip('endpoint unreachable (' + envBaseUrl(profile) + ')');
    steps.chat = { status: 'FAIL', detail: String(e && e.message || e) };
  }

  // 3) tool task — only meaningful where tools are not provably unsupported
  if (provider.supportsTools(model) === false) {
    steps.tools = { status: 'SKIP', detail: 'provider/model asserts no tool support (honest up-front refusal path)' };
  } else {
    try {
      const got = await drainStream(provider, { model, messages: [{ role: 'user', content: TOOL_PROMPT }], tools: PING_TOOL }, { label: 'tools' });
      if (got.toolStarts.length) steps.tools = { status: 'PASS', detail: 'tool call streamed: ' + got.toolStarts.join(',') + ' finish=' + got.finish };
      else steps.tools = { status: 'WARN', detail: 'no tool call produced (model answered in prose) finish=' + got.finish };
    } catch (e) { steps.tools = { status: 'FAIL', detail: String(e && e.message || e) }; }
  }

  // 4) cancel — abort after the first event; the generator must end cleanly
  try {
    const ac = new AbortController();
    const got = await drainStream(provider, { model, messages: [{ role: 'user', content: 'Count from 1 to 200, one number per line.' }], signal: ac.signal },
      { label: 'cancel', onEvent: () => ac.abort() });
    steps.cancel = { status: 'PASS', detail: 'aborted after ' + got.events + ' event(s); generator returned cleanly' };
  } catch (e) { steps.cancel = { status: 'FAIL', detail: String(e && e.message || e) }; }

  // 5) cost — the chat usage must reconcile through the real engine
  if (chatUsage) {
    const c = makeCostEngine({ priceOf: provider.priceOf }).reconcile(chatUsage, model);
    steps.cost = { status: 'PASS', detail: 'usd=' + c.usd.toFixed(6) + ' source=' + c.costSource + ' in=' + c.tokensIn + ' out=' + c.tokensOut };
    receipt.usd = c.usd; receipt.costSource = c.costSource;
  } else {
    steps.cost = { status: 'WARN', detail: 'no usage reported on the chat stream — cost falls back to catalog/unpriced' };
  }

  const vals = Object.values(steps).map(s => s.status);
  receipt.verdict = vals.includes('FAIL') ? 'FAIL' : (vals.includes('WARN') ? 'PASS-WITH-WARNINGS' : 'PASS');
  return receipt;
}

(async () => {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log('usage: node scripts/provider-certify.mjs [--provider id,id] [--model id] [--receipts dir]');
    process.exit(0);
  }
  const ids = args.providers || factory.listProviderProfiles().map(p => p.id);
  const receiptsDir = args.receipts || path.join(process.cwd(), '.dogfood', 'provider-certify');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const results = [];
  for (const id of ids) {
    process.stdout.write('certifying ' + id + ' ... ');
    let r;
    try { r = await certifyProvider(id, args.model); }
    catch (e) { r = { provider: id, verdict: 'FAIL', steps: {}, why: String(e && e.message || e) }; }
    results.push(r);
    console.log(r.verdict + (r.why ? ' (' + r.why + ')' : ''));
    for (const [k, v] of Object.entries(r.steps || {})) console.log('    ' + k.padEnd(7) + v.status.padEnd(6) + v.detail);
  }
  try {
    fs.mkdirSync(receiptsDir, { recursive: true });
    const file = path.join(receiptsDir, stamp + '.json');
    fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
    console.log('\nreceipt: ' + file);
  } catch (e) { console.log('\n[warn] receipt not written: ' + (e && e.message)); }
  const ran = results.filter(r => r.verdict !== 'SKIP');
  const failed = ran.filter(r => r.verdict === 'FAIL');
  console.log('\nsummary: ' + results.map(r => r.provider + '=' + r.verdict).join('  '));
  console.log('certified: ' + ran.filter(r => r.verdict.indexOf('PASS') === 0).length + '/' + ran.length + ' run, ' + (results.length - ran.length) + ' skipped (no credential/endpoint)');
  process.exit(failed.length ? 1 : 0);
})();
