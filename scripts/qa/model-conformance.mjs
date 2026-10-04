#!/usr/bin/env node
/* scripts/qa/model-conformance.mjs — per-MODEL harness conformance smoke.
 *
 * WHY THIS EXISTS (model-consistency lane, 2026-07-17): StarNet's promise is that every model the
 * Commander picks rides the SAME rails — same run lifecycle, same tool wire, same cost truth, same
 * error surfacing. Model families break in family-specific ways (Kimi K3's narrate-then-stop, the
 * <tool_call>-as-text class, broken argument JSON, missing usage frames), and today the only way to
 * find out is a frustrating live session. This probe answers, in under a minute, "does the harness
 * run THIS model cleanly?" — run it whenever a new provider/model is connected.
 *
 * WHAT IT DOES: drives the REAL run route (POST /api/run — the exact seam the browser uses; NOT a
 * bypass) on a live sidecar with two tiny paid probes, and tallies the bus events streamed back:
 *   A. TOOL probe (task): asks the model to call fs_list once, then answer with a marker.
 *   B. CHAT probe: asks for a bare marker reply, no tools.
 * Card (per check: PASS / WARN / FAIL):
 *   run.completes      — agent.run.end reason 'done' on both probes            (FAIL otherwise)
 *   tool.roundtrip     — ≥1 agent.tool_call + ok agent.tool_result in probe A  (FAIL otherwise)
 *   tool.wire          — calls arrived on the tool_calls wire; tool-call MARKUP in the streamed
 *                        text means the loop scrubbed + nudged (WARN: model mis-wires calls)
 *   args.clean         — no tool.args.repaired events (WARN: model emits broken JSON; repaired)
 *   cost.reported      — ≥1 reconciled agent.cost with real token counts       (FAIL otherwise)
 *   no.errors          — zero agent.run.error events                           (FAIL otherwise)
 *   no.fallback        — zero provider.fallback events (WARN: primary endpoint degraded)
 *   no.consent.stall   — zero permission.prompt events (probe A is read-only; a prompt = FAIL —
 *                        it would hang a headless run)
 * Plus latency/turn/spend stats per probe (first-token ms, wall ms, turns, usd).
 *
 * LIMITS (honest): the loop's continuation nudge is transcript-only (no bus event, by design — the
 * loop-guard warn precedent), so narrate-then-stop is covered by unit tests, not this card. Marker
 * checks tolerate decoration around the marker. This spends REAL provider credit (~cents).
 *
 * RUN IT (operator):
 *   npm start (or the installed app) so the sidecar is live, provider key connected, then:
 *     node scripts/qa/model-conformance.mjs --provider openrouter --model moonshotai/kimi-k2
 *   Options: --base http://127.0.0.1:8787 · --key <apiKey> (else the sidecar's runtime key) ·
 *            --token <apiToken> (if the API is token-gated; also SKYNET_API_TOKEN) ·
 *            --timeout-ms 180000 · --json (machine-readable card on stdout)
 * Exit code: 0 = all PASS/WARN, 1 = any FAIL, 2 = could not probe (sidecar unreachable etc.).
 *
 * HOUSE PATTERN: pure core (tallyRun/scoreCard are exported, dependency-free) + one CLI block with
 * the ambient effects, so the classifier tests headlessly (test/model-conformance.test.js). */
'use strict';
import { pathToFileURL } from 'node:url';

// ---------- pure core ----------

export const CHECKS = ['run.completes', 'tool.roundtrip', 'tool.wire', 'args.clean', 'cost.reported', 'no.errors', 'no.fallback', 'no.consent.stall'];

// Fold one probe's ordered {name, payload} bus events into a flat tally. Pure.
export function tallyRun(events) {
  const t = {
    end: null, errors: [], toolCalls: [], toolResults: [], repaired: 0, fallbacks: 0,
    consentPrompts: 0, costOk: false, usd: 0, turns: 0, firstTokenAt: null, tokens: 0, textMarkup: false
  };
  let allText = '';
  for (const ev of events || []) {
    if (!ev || !ev.name) continue;
    const p = ev.payload || {};
    if (ev.name === 'agent.run.end') { t.end = p; t.turns = p.turns || 0; t.usd = p.usd || 0; }
    else if (ev.name === 'agent.run.error') t.errors.push(String(p.message || 'error'));
    else if (ev.name === 'agent.tool_call') t.toolCalls.push({ id: String(p.callId || ''), name: String(p.name || '') });
    else if (ev.name === 'agent.tool_result') t.toolResults.push({ id: String(p.callId || ''), ok: !!p.ok });
    else if (ev.name === 'tool.args.repaired') t.repaired++;
    else if (ev.name === 'provider.fallback') t.fallbacks++;
    else if (ev.name === 'permission.prompt') t.consentPrompts++;
    else if (ev.name === 'agent.cost' && p.reconciled) { t.costOk = true; t.tokens += (p.tokensIn || 0) + (p.tokensOut || 0); }
    else if (ev.name === 'agent.token' && p.delta) {
      if (t.firstTokenAt == null) t.firstTokenAt = ev.at != null ? ev.at : -1;
      allText += p.delta;   // scrubbed from stored turns, but the raw stream still shows what the model emitted
    }
  }
  if (/<tool_call>|<function_call>|<tool_calls>|<function_calls>/i.test(allText)) t.textMarkup = true;
  return t;
}

// Score the two probe tallies into the card. Pure; returns { checks: {name -> {status, detail}}, fail, warn }.
export function scoreCard(toolT, chatT) {
  const c = {};
  const put = (name, status, detail) => { c[name] = { status, detail }; };
  const doneBoth = toolT.end && toolT.end.reason === 'done' && chatT.end && chatT.end.reason === 'done';
  put('run.completes', doneBoth ? 'PASS' : 'FAIL',
    'tool probe: ' + (toolT.end ? toolT.end.reason : 'no end event') + ' · chat probe: ' + (chatT.end ? chatT.end.reason : 'no end event'));
  const okResults = toolT.toolResults.filter(r => r.ok).length;
  put('tool.roundtrip', (toolT.toolCalls.length >= 1 && okResults >= 1) ? 'PASS' : 'FAIL',
    toolT.toolCalls.length + ' call(s), ' + okResults + ' ok result(s)');
  const markup = toolT.textMarkup || chatT.textMarkup;
  put('tool.wire', !markup ? 'PASS' : 'WARN', !markup ? 'calls arrived on the tool_calls wire' : 'tool-call MARKUP streamed as text — scrubbed + nudged, never executed; model mis-wires calls');
  put('args.clean', toolT.repaired === 0 ? 'PASS' : 'WARN', toolT.repaired === 0 ? 'argument JSON parsed as sent' : toolT.repaired + ' broken-JSON repair(s)');
  put('cost.reported', (toolT.costOk && toolT.tokens > 0) ? 'PASS' : 'FAIL', toolT.costOk ? toolT.tokens + ' tokens reconciled' : 'no reconciled usage — cost/compaction blind on this model');
  const errs = toolT.errors.concat(chatT.errors);
  put('no.errors', errs.length === 0 ? 'PASS' : 'FAIL', errs.length === 0 ? 'clean' : errs.slice(0, 3).join(' | '));
  const fb = toolT.fallbacks + chatT.fallbacks;
  put('no.fallback', fb === 0 ? 'PASS' : 'WARN', fb === 0 ? 'primary endpoint held' : fb + ' failover(s) mid-run');
  put('no.consent.stall', toolT.consentPrompts === 0 ? 'PASS' : 'FAIL',
    toolT.consentPrompts === 0 ? 'read-only probe stayed promptless' : toolT.consentPrompts + ' consent prompt(s) on a read-only probe — headless runs would hang');
  const statuses = CHECKS.map(k => c[k].status);
  return { checks: c, fail: statuses.filter(s => s === 'FAIL').length, warn: statuses.filter(s => s === 'WARN').length };
}

// ---------- CLI block (ambient effects live here only) ----------

async function probeRun(base, headers, body, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const started = Date.now();
  const events = [];
  try {
    const res = await fetch(base + '/api/run', { method: 'POST', headers, body: JSON.stringify(body), signal: ac.signal });
    if (!res.ok || !res.body) throw new Error('/api/run HTTP ' + res.status + ' ' + (await res.text().catch(() => '')).slice(0, 200));
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        try { const j = JSON.parse(line); j.at = Date.now() - started; events.push(j); } catch (_) { /* keep-alive/partial */ }
      }
    }
  } finally { clearTimeout(timer); }
  return { events, wallMs: Date.now() - started };
}

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return (i >= 0 && process.argv[i + 1] != null) ? process.argv[i + 1] : dflt;
}

async function main() {
  const base = String(arg('base', 'http://127.0.0.1:8787')).replace(/\/+$/, '');
  const providerId = arg('provider', 'openrouter');
  const model = arg('model', '');
  const key = arg('key', process.env.SKYNET_SMOKE_KEY || '');
  const token = arg('token', process.env.SKYNET_API_TOKEN || '');
  const timeoutMs = parseInt(arg('timeout-ms', '180000'), 10) || 180000;
  const asJson = process.argv.indexOf('--json') >= 0;
  if (!model) { console.error('usage: node scripts/qa/model-conformance.mjs --provider <id> --model <id> [--key <apiKey>] [--base url] [--token apiToken] [--json]'); process.exit(2); }

  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['x-starnet-token'] = token;
  const common = { provider: providerId, model, agentId: 'conformance-probe' };
  if (key) common.key = key;

  let toolProbe, chatProbe;
  try {
    toolProbe = await probeRun(base, headers, Object.assign({}, common, {
      isTask: true,
      placed: ['cabinet'],
      messages: [{ role: 'user', content: 'CONFORMANCE PROBE. Do exactly this, nothing else: (1) call the fs_list tool once on path "." now; (2) then reply with exactly: PROBE-OK. Do not ask any questions.' }]
    }), timeoutMs);
    chatProbe = await probeRun(base, headers, Object.assign({}, common, {
      isTask: false,
      messages: [{ role: 'user', content: 'CONFORMANCE PROBE. Reply with exactly: PONG' }]
    }), timeoutMs);
  } catch (e) {
    console.error('BLOCKED: could not complete probes against ' + base + ' — ' + (e && e.message));
    console.error('Is the app running (npm start), and is the provider key connected?');
    process.exit(2);
  }

  const toolT = tallyRun(toolProbe.events);
  const chatT = tallyRun(chatProbe.events);
  const card = scoreCard(toolT, chatT);
  const stats = {
    tool: { firstTokenMs: toolT.firstTokenAt, wallMs: toolProbe.wallMs, turns: toolT.turns, usd: toolT.usd },
    chat: { firstTokenMs: chatT.firstTokenAt, wallMs: chatProbe.wallMs, turns: chatT.turns, usd: chatT.usd }
  };

  if (asJson) {
    console.log(JSON.stringify({ provider: providerId, model, card: card.checks, fail: card.fail, warn: card.warn, stats }, null, 2));
  } else {
    console.log('\nMODEL CONFORMANCE — ' + providerId + ' / ' + model + '\n');
    for (const k of CHECKS) {
      const e = card.checks[k];
      console.log('  ' + (e.status === 'PASS' ? ' PASS ' : e.status === 'WARN' ? ' WARN ' : '*FAIL*') + '  ' + k.padEnd(18) + e.detail);
    }
    console.log('\n  tool probe: first token ' + stats.tool.firstTokenMs + 'ms · wall ' + stats.tool.wallMs + 'ms · ' + stats.tool.turns + ' turn(s) · $' + Number(stats.tool.usd).toFixed(4));
    console.log('  chat probe: first token ' + stats.chat.firstTokenMs + 'ms · wall ' + stats.chat.wallMs + 'ms · ' + stats.chat.turns + ' turn(s) · $' + Number(stats.chat.usd).toFixed(4));
    console.log('\n  ' + (card.fail ? card.fail + ' FAIL — this model does NOT ride the rails cleanly yet.' : card.warn ? 'No failures; ' + card.warn + ' warn(s) — harness is absorbing model quirks.' : 'Fully clean — this model rides the rails like any other.'));
  }
  process.exit(card.fail ? 1 : 0);
}

const INVOKED_DIRECTLY = (() => {
  try { return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href; }
  catch (_) { return false; }
})();
if (INVOKED_DIRECTLY) main().catch(e => { console.error('BLOCKED: ' + (e && e.stack || e)); process.exit(2); });
