/* Adapted MIT helpers from sidecar/openai-compat.js. Copyright (c) 2026 Andrew Sims. See ../LICENSE. */
'use strict';
const nodeCrypto = require('node:crypto');


const DEFAULT_MAX_CONCURRENT = 0;   // unlimited by default; env STARNET_V1_MAX_CONCURRENT opts into a ceiling
const MIN_KEY_LEN = 16;              // below this, refuse to enable (guessable key on a terminal-capable surface = RCE)
const AID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const DEFAULT_MODEL_ID = 'hq-agent';   // the stable advertised model id
const RUN_TTL_MS = 60 * 60 * 1000;   // terminal /v1/runs records are swept an hour after they finish
const MAX_BODY = 10 * 1024 * 1024;   // 10MB — long agent conversations with tool calls

// ---- pure helpers (no ambient clock/rng; all injected) ---------------------------------------------------

// OpenAI-style error envelope. Every field is always present (even null) so an OpenAI SDK never trips on a
// missing key — mirrors the reference harness _openai_error.
function openAiError(message, opts) {
  const o = opts || {};
  return { error: { message: String(message == null ? '' : message), type: o.type || 'invalid_request_error', param: o.param == null ? null : o.param, code: o.code == null ? null : o.code } };
}

// Is the configured key strong enough to ENABLE /v1 at all? Empty/whitespace or <16 chars => disabled.
function keyUsable(key) { const k = String(key == null ? '' : key).trim(); return k.length >= MIN_KEY_LEN; }

// Extract the bearer token from the Authorization header ("Bearer <key>"). '' when absent/malformed.
function bearerToken(req) {
  const h = String(((req && req.headers) || {})['authorization'] || '');
  if (h.slice(0, 7).toLowerCase() === 'bearer ') return h.slice(7).trim();
  return '';
}

// constant-time compare (never throws; false on length mismatch/empty). Reused from apiauth via injection, but
// kept here too so the pure helpers are self-contained for unit tests.
function constTimeEq(a, b) {
  a = String(a == null ? '' : a); b = String(b == null ? '' : b);
  if (!a || !b || a.length !== b.length) return false;
  try { return nodeCrypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); } catch (_) { return false; }
}

// the path portion of a url, query stripped.
function pathOf(url) { const u = String(url || ''); const i = u.indexOf('?'); return i < 0 ? u : u.slice(0, i); }

// sanitize any string to the notebook/fs-jail agentId grammar.
function sanitizeAid(s) { return String(s == null ? '' : s).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40); }

// Flatten OpenAI chat message content (string, or array of typed parts) into a plain string. Mirrors the reference harness
// _normalize_chat_content: pulls text/input_text/output_text parts, skips images/other. Bounded for safety.
function normalizeContent(content, depth) {
  depth = depth || 0;
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    if (depth > 6) return '';
    const parts = [];
    for (const item of content.slice(0, 1000)) {
      if (typeof item === 'string') { if (item) parts.push(item); continue; }
      if (item && typeof item === 'object') {
        const t = String(item.type || '').trim().toLowerCase();
        if (t === 'text' || t === 'input_text' || t === 'output_text') { if (item.text != null) parts.push(String(item.text)); }
      }
    }
    return parts.join('\n');
  }
  try { return String(content); } catch (_) { return ''; }
}

// Split an OpenAI `messages` array into { system, history, lastUser }. System messages are \n-joined into an
// ephemeral system prompt; the LAST user message is the input; every user/assistant message before it is history.
// Returns { ok:false } when there is no user message to act on (caller answers 400). Mirrors the reference harness's parsing.
function splitMessages(messages) {
  if (!Array.isArray(messages) || !messages.length) return { ok: false, reason: 'messages' };
  const systems = [];
  const convo = [];   // {role, content} for user/assistant/tool turns, in order
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;
    const role = String(m.role || '').toLowerCase();
    const content = normalizeContent(m.content);
    if (role === 'system' || role === 'developer') { if (content) systems.push(content); continue; }
    if (role === 'user' || role === 'assistant') convo.push({ role, content });
  }
  // find the last user turn — that is the directive; everything before it is history context.
  let lastUserIdx = -1;
  for (let i = convo.length - 1; i >= 0; i--) { if (convo[i].role === 'user') { lastUserIdx = i; break; } }
  if (lastUserIdx < 0) return { ok: false, reason: 'no_user' };
  const lastUser = convo[lastUserIdx].content;
  if (!String(lastUser || '').trim()) return { ok: false, reason: 'no_user' };
  const history = convo.slice(0, lastUserIdx);
  return { ok: true, system: systems.join('\n'), history, lastUser, convo };
}

// coerce a bool-ish payload value (some frontends serialize `stream` as the STRING "false", which is truthy).
function coerceBool(v, def) {
  if (typeof v === 'boolean') return v;
  if (v == null) return !!def;
  if (typeof v === 'string') { const s = v.trim().toLowerCase(); if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true; if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false; return !!def; }
  if (typeof v === 'number') return !!v;
  return !!def;
}

// Only a proven terminal event may assert completion. Earlier recoverable errors do not
// override a later successful end; a missing end is interrupted, never implicit success.
function runOutcome(reason, hadText, error) {
  const status = reason === 'done' ? 'completed'
    : reason === 'error' ? 'failed'
    : reason === 'cancelled' ? 'cancelled'
    : reason === 'max_iters' || reason === 'budget' ? 'limited'
    : reason === 'clarifying' ? 'awaiting_input'
    : reason === 'refusal' ? 'refused' : 'interrupted';
  return { status, reason: reason || 'missing_terminal', completed: status === 'completed',
    partial: !!hadText && status !== 'completed', failed: status === 'failed',
    error: ['failed', 'interrupted'].includes(status) ? (error || 'Agent run ended without a successful terminal event') : null };
}
function finishReasonFor(reason) {
  const status = runOutcome(reason, false).status;
  if (status === 'limited') return 'length';
  if (['completed', 'awaiting_input', 'refused'].includes(status)) return 'stop';
  return 'error';
}
function runTerminalEvent(reason) { return 'run.' + runOutcome(reason, false).status; }

// build the sync chat.completion object (real usage numbers from the summed counters).
function chatCompletionObject(o) {
  return {
    id: o.id, object: 'chat.completion', created: o.created, model: o.model,
    choices: [{ index: 0, message: { role: 'assistant', content: o.content }, finish_reason: o.finishReason }],
    usage: { prompt_tokens: o.usage.prompt_tokens, completion_tokens: o.usage.completion_tokens, total_tokens: o.usage.total_tokens }
  };
}

// build one streaming chat.completion.chunk.
function chatChunk(o) {
  const c = { id: o.id, object: 'chat.completion.chunk', created: o.created, model: o.model, choices: [{ index: 0, delta: o.delta || {}, finish_reason: o.finishReason == null ? null : o.finishReason }] };
  if (o.usage) c.usage = o.usage;
  return c;
}

// derive a stable session id from the conversation seed (used when no explicit session header is supplied, so a
// multi-turn OpenAI client that resends full history threads onto one agent/transcript). Mirrors the reference harness.
function deriveSessionId(system, firstUser) {
  const seed = String(system || '') + '\n' + String(firstUser || '');
  return 'api-' + nodeCrypto.createHash('sha256').update(seed, 'utf8').digest('hex').slice(0, 16);
}


module.exports={openAiError,keyUsable,bearerToken,constTimeEq,normalizeContent,splitMessages,coerceBool,runOutcome,finishReasonFor,chatChunk,deriveSessionId,DEFAULT_MODEL_ID};
