I now have complete ground truth. The findings assumed a greenfield browser app, but the codebase is at ~M4: frozen event bus, deterministic injectable loop, provider seam, cap-gated registry, working web.js, cost engine. The decisive spec must **build on these real seams**, not reinvent a `{t:...}` protocol. The two genuinely missing pieces are: (1) `providers/openrouter.js` (the SSE adapter — the only OR-aware module), and (2) the Node HTTP host (`index.js` + bridge) that wires real `fetch`/store into `createHarness` and streams the *existing* `agent.*` events as NDJSON. Plus `fs.js` (jailed) which doesn't exist yet.

I'll write the spec to honor the existing contract exactly. No more reads needed.

# STARNET Sidecar — BUILD SPEC (Lead Engineer, decisive)

> **Reconciliation note (read first).** The three research findings assumed a greenfield browser app and proposed a fresh ESM single-file sidecar with an invented `{t:'token', d}` NDJSON protocol. **That is wrong for this repo.** The codebase is already at ~M4 of `docs/HARNESS_ARCHITECTURE.md`: a **frozen `agent.*` event bus** (`shared/events.js`), a **deterministic, dependency-injected loop** (`sidecar/loop.js`), a **provider seam** (`stream(req) -> AsyncIterable<HarnessEvent>`), a **cap-gated registry with consent** (`sidecar/tools/registry.js`), a **working `web.js`**, a **cost engine**, and a **UMD module style** (CommonJS-under-node / global-under-browser). This spec builds the MVP **on those real seams**. We do **not** invent a new event vocabulary; the NDJSON wire is literally `{name, payload}` pairs of existing `agent.*` events. We do **not** rewrite the loop; we feed it a real provider + dispatcher + emitter. Two files are genuinely missing (`providers/openrouter.js`, the Node host `sidecar/index.js`) plus `tools/builtin/fs.js`. That's the build.

---

## 1. Architecture in 5 sentences

1. A zero-dependency Node 18+ process (`node sidecar/index.js`, bind `127.0.0.1:8787`) **serves the static `frontend/`** *and* exposes `POST /api/run`, `POST /api/cancel`, `GET /api/health`.
2. `/api/run` builds the **existing** `createHarness(...)` graph with real ambient deps — global `fetch`, a JSON-file `store`, real `clock`, the **new** `makeOpenRouterProvider`, the cap-gated `registry.dispatch`, and the `makeCostEngine` — then runs the **unchanged** `runAgentLoop`.
3. The harness emits its normal **validated `agent.*` U.bus events**; on the server the "bus" is an adapter that writes each event as **one NDJSON line `{"name":"agent.token","payload":{…}}\n`** to the streaming response body — so the wire format *is* the frozen contract, not a parallel invention.
4. The browser's `harness.js` keeps its **frozen public surface** (`chat/run/cancel/totals/listModels/priceOf/…`); only the transport inside changes — it `POST`s to `/api/run` and reads NDJSON, **re-emitting each `{name,payload}` onto the real `U.bus`** so `telemetry.js`/`chat.js`/`world.js` light up from genuine runtime transitions.
5. The agent loop (`model → tool → result → loop → final`) runs server-side where tools can actually reach the web and disk (jailed to `sidecar/workspaces/<agentId>/`), with per-run iteration/cost/timeout caps and a hard kill path on browser disconnect.

---

## 2. The exact OpenRouter tool-calling wire (real JSON) + loop

The **only** module that knows the OpenRouter wire format is the new `sidecar/providers/openrouter.js`. The loop already consumes the normalized `HarnessEvent` stream — so the provider's whole job is "OR SSE → `HarnessEvent`s".

### 2a. Request the provider sends (per turn)

```json
POST https://openrouter.ai/api/v1/chat/completions
Authorization: Bearer <USER_BYOK_KEY>
Content-Type: application/json
HTTP-Referer: http://127.0.0.1
X-Title: STARNET

{
  "model": "anthropic/claude-sonnet-4.5",
  "stream": true,
  "messages": [
    { "role": "system", "content": "<frozen sectioned system prompt>" },
    { "role": "user", "content": "Research the 2026 EU AI Act enforcement timeline and write a brief to disk." }
  ],
  "tools": [
    { "type": "function", "function": {
        "name": "web_search",
        "description": "Search the web and get a list of results (title, url, snippet).",
        "parameters": { "type": "object", "required": ["query"],
          "properties": { "query": { "type": "string" } } } } }
  ],
  "tool_choice": "auto",
  "parallel_tool_calls": false
}
```

- **Do NOT send `usage: { include: true }`** — Finding A verified it is a deprecated no-op; usage/cost is always returned. (The current browser `harness.js:62` still sends it; the new provider must drop it.)
- `tools` comes verbatim from `registry.wireFormat(perCallToolList)` — already in exactly this shape (`registry.js:54`).
- ~~`parallel_tool_calls:false` for the MVP keeps the in-game visualization linear (one search → one result → next). The loop executes sequentially regardless, so this just simplifies streaming accumulation.~~ **SUPERSEDED 2026-08-17:** the loop gained a concurrent dispatch path (all-read-only batches run under `Promise.all` with order-preserving emits; `parallelSafe` in index.js keeps browser/shell/MCP/consent tools serial), so the adapters now omit the param and accept the provider default (parallel enabled).
- `tools` is included **every** turn of the loop (omitting it on follow-ups → 400). `tool_choice` is omitted when the per-call tool list is empty (pure-talk turns).

### 2b. Streamed response (SSE) → what the provider must yield

OR streams `data:`-prefixed lines, `: OPENROUTER PROCESSING` keep-alives, terminating `data: [DONE]`. Tool-call args arrive **fragmented, keyed by `index`**. The provider normalizes to the existing `HarnessEvent` union (`provider.js:5-13`):

| OR SSE delta | provider yields |
|---|---|
| `choices[0].delta.content` | `{ type:'text', delta }` |
| first `delta.tool_calls[i]` (has `id`+`function.name`) | `{ type:'tool_start', index:i, id, name }` |
| later `delta.tool_calls[i].function.arguments` fragment | `{ type:'tool_args', index:i, chunk }` |
| `data.usage` (last chunk before `[DONE]`) | `{ type:'usage', usage }` |
| `choices[0].finish_reason` | `{ type:'done', finishReason: normalizeFinish(r) }` |
| `data.error` mid-stream | throw `Error(data.error.message)` |

The loop (`loop.js:118-125`) already handles every one of these event types. **The provider must not `JSON.parse` the args** — it concatenates the raw arg string fragments into `tool_start`/`tool_args`; the loop's `parseCall` (`loop.js:27-31`) does the single guarded `JSON.parse` after the stream. This is the existing, tested contract — match it exactly.

### 2c. The tool-result message format (already implemented — do not change)

`loop.js:41-44` builds:

```js
{ role: 'tool', tool_call_id: callId, content: isError ? ('ERROR: ' + body) : body }
```

and `assistantTurn` (`loop.js:33-39`) re-serializes tool calls back to OR shape (`{ id, type:'function', function:{ name, arguments: argsRaw } }`) when appending the assistant turn. `assertPaired` (`loop.js:46-52`) enforces "exactly one result per requested id" — the hard invariant that prevents 400s. **Nothing in §2c needs writing; it exists and is test-covered by `test/loop.replay.test.js`.**

### 2d. The loop (already exists — `sidecar/loop.js`)

The findings' proposed loop is functionally what's already in `loop.js`. Do **not** rewrite it. It already does: guards-before-paid-call → stream one turn → reconcile cost → append assistant turn → stop iff zero tool calls → execute calls sequentially (each throw/timeout/deny → `isError` result, never thrown) → `assertPaired` → continue. The MVP's job is to **supply its injected dependencies** (`provider`, `dispatch`, `capCtx`, `cost`, `emit`, `limits`, `signal`), not to author the loop.

---

## 3. Chosen `web_search` + `web_fetch` (one primary each — already built)

`sidecar/tools/builtin/web.js` is **already implemented, validated, and is the deliverable** from Finding B. Keep it. Final decisions:

- **`web_search` primary → DuckDuckGo HTML** (`POST https://html.duckduckgo.com/html/`), parsed to `[{title,url,snippet}]`, with the `uddg=` unwrap. Fallback chain (already coded, `web.js:203-217`): **DDG-html → DDG-lite → OpenRouter `openrouter:web_search`** (last only if `deps.openrouter.apiKey` is wired). The 202/"anomaly" shell is detected (`isDDGBlocked`, `web.js:105-108`) and treated as a soft failure that advances the chain — it never returns the empty shell as "no results."
- **`web_fetch` primary → Jina Reader** (`https://r.jina.ai/<url>`, keyless, `X-Return-Format: text`), with in-body upstream-error scan (`web.js:234-237`). Fallback → **direct fetch + `htmlToText` strip** (`web.js:243-250`). SSRF guard `assertSafeUrl` (`web.js:55-67`) blocks non-http(s), localhost, loopback, RFC-1918, link-local, `.local`/`.internal` — runs before any fetch.

**Two required integration changes to `web.js`'s environment (not its logic):**

1. **Self-throttle.** Finding B's #1 reliability risk is the DDG IP block under bursty use. The per-tool `timeoutMs` exists, but there's no min-interval. Add a per-process throttle to the **host wiring** (not inside `web.js`): wrap `searchTool.run` so consecutive `web_search` calls are spaced ≥1.1 s. Cheapest correct spot is a tiny gate in `index.js` when registering web tools (see §6). The per-run tool-call cap (`maxIters`/`maxRepeat`) already bounds total volume.
2. **`emit('tool.web', …)` is not in the frozen event registry.** `web.js:274/276/289/291` emits a `tool.web` event that `events.validate` will **reject** (and `makeEmitter` silently drops). The agent's visible tool activity already comes through the frozen `agent.tool_call` / `agent.tool_result` events the loop emits (`loop.js:59,67`) — those carry `name` and `summary` ("6 result(s) via duckduckgo-html"), which is exactly the COMMS line we want. **Decision: drop the `tool.web` emits** (make `ctx.emit` for `tool.web` a no-op by simply not passing a handler, which is already guarded by `typeof ctx.emit === 'function'`). Do **not** add `tool.web` to the frozen registry for the MVP — the architecture froze the event set on purpose to avoid re-freezes, and `agent.tool_call/result` already covers the visualization.

---

## 4. Full tool registry: schemas + jailed Node impls

Three tools already register through the existing `registry`: `notebook.read/write` (built), `web_search`/`web_fetch` (built, `web.js`). The MVP **adds `tools/builtin/fs.js`** (jailed file tools) — the one genuinely missing tool module — and registers the `cabinet` capability so the cap-gate grants them.

### 4a. JSON-Schema (the `schema` field on each tool; OR wire-format derived by `registry.wireFormat`)

```js
web_search  : { type:'object', required:['query'],
                properties:{ query:{ type:'string' } } }
web_fetch   : { type:'object', required:['url'],
                properties:{ url:{ type:'string' } } }
fs.write    : { type:'object', required:['path','content'],
                properties:{ path:{ type:'string' }, content:{ type:'string' } } }
fs.read     : { type:'object', required:['path'],
                properties:{ path:{ type:'string' } } }
fs.list     : { type:'object',
                properties:{ path:{ type:'string' } } }
```

(`web_search`/`web_fetch` schemas already live in `web.js:272,287`. The `fs.*` schemas are below, embedded in the tool defs.)

### 4b. `sidecar/tools/builtin/fs.js` (NEW — jailed, UMD, matches `notebook.js`/`web.js` style)

Naming: tools are `fs.read`/`fs.write`/`fs.list`, capability `cabinet`, matching the `CAP_REGISTRY` plan in `HARNESS_ARCHITECTURE.md` §8. `fs.write` is `scope:'write', requiresConsent:true`; reads are consent-free.

```js
/* sidecar/tools/builtin/fs.js — the CABINET capability: fs.read / fs.write / fs.list,
   jailed to workspaces/<agentId>/. The path guard is the security spine: every
   model/user-supplied path is resolved and PROVEN to stay inside the workspace.
   Node-only (needs node:path + node:fs/promises injected via deps for testability).

   makeFsTools({ fsp, pathMod, root, limits }) -> { writeTool, readTool, listTool, register(reg) }
     fsp     : node:fs/promises (injectable; tests pass an in-memory fake)
     pathMod : node:path        (injectable)
     root    : absolute path to .../sidecar/workspaces
     limits  : { writeBytes=1<<20, readReturn=200_000 } */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.SK = root.SK || {}; root.SK.tools = root.SK.tools || {}; (root.SK.tools.builtin = root.SK.tools.builtin || {}).fs = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function safeAgentId(id) {
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(id || '')) throw new Error('bad agentId');
    return id;
  }

  function makeFsTools(deps) {
    const fsp = deps.fsp, P = deps.pathMod, ROOT = deps.root;
    const WRITE_BYTES = (deps.limits && deps.limits.writeBytes) || (1 << 20);
    const READ_RETURN = (deps.limits && deps.limits.readReturn) || 200000;

    async function workspaceRoot(agentId) {
      const dir = P.join(ROOT, safeAgentId(agentId));
      await fsp.mkdir(dir, { recursive: true });
      return dir;
    }
    // Resolve a relative path and PROVE it stays inside the workspace.
    async function resolveInside(agentId, rel) {
      if (P.isAbsolute(rel || '') || /(^|[\\/])\.\.([\\/]|$)/.test(rel || '')) throw new Error('illegal path');
      const base = await workspaceRoot(agentId);
      const abs = P.resolve(base, rel || '.');
      if (abs !== base && !abs.startsWith(base + P.sep)) throw new Error('path escapes workspace');
      return { base, abs };
    }

    const writeTool = {
      name: 'fs.write', capability: 'cabinet', scope: 'write', requiresConsent: true, timeoutMs: 10000,
      description: 'Write a UTF-8 text file into your workspace (deliverables land here).',
      schema: { type:'object', required:['path','content'], properties:{ path:{ type:'string' }, content:{ type:'string' } } },
      run: async (args, ctx) => {
        const { abs } = await resolveInside((ctx && ctx.agentId) || 'agent', args.path);
        const buf = Buffer.from(String(args.content), 'utf8');
        if (buf.length > WRITE_BYTES) throw new Error('file too large (' + buf.length + ' > ' + WRITE_BYTES + ')');
        await fsp.mkdir(P.dirname(abs), { recursive: true });
        await fsp.writeFile(abs, buf);
        if (ctx && typeof ctx.emit === 'function') ctx.emit('deliverable', { id: 'file_' + Date.now(), agentId: (ctx.agentId||'agent'), kind: 'file', title: args.path });
        return { content: 'wrote ' + args.path + ' (' + buf.length + ' bytes)', summary: 'wrote ' + args.path + ' (' + kb(buf.length) + ')' };
      }
    };

    const readTool = {
      name: 'fs.read', capability: 'cabinet', scope: 'read', requiresConsent: false, timeoutMs: 10000,
      description: 'Read a UTF-8 text file from your workspace.',
      schema: { type:'object', required:['path'], properties:{ path:{ type:'string' } } },
      run: async (args, ctx) => {
        const { abs } = await resolveInside((ctx && ctx.agentId) || 'agent', args.path);
        const txt = await fsp.readFile(abs, 'utf8');
        const out = txt.length > READ_RETURN ? txt.slice(0, READ_RETURN) + '\n…[truncated]' : txt;
        return { content: out, summary: kb(Buffer.byteLength(txt)) + ' read' };
      }
    };

    const listTool = {
      name: 'fs.list', capability: 'cabinet', scope: 'read', requiresConsent: false, timeoutMs: 8000,
      description: 'List files in your workspace (optionally a subdirectory).',
      schema: { type:'object', properties:{ path:{ type:'string' } } },
      run: async (args, ctx) => {
        const { abs } = await resolveInside((ctx && ctx.agentId) || 'agent', (args && args.path) || '.');
        let names = [];
        try { names = await fsp.readdir(abs); } catch (e) { if (e.code === 'ENOENT') return { content: '(empty)', summary: '0 files' }; throw e; }
        return { content: names.length ? names.join('\n') : '(empty)', summary: names.length + ' file(s)' };
      }
    };

    function kb(n) { return n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB'; }

    return { writeTool, readTool, listTool, _internals: { resolveInside, workspaceRoot, safeAgentId },
             register(reg) { reg.register(writeTool); reg.register(readTool); reg.register(listTool); return reg; } };
  }

  return { makeFsTools };
});
```

### 4c. Add the `cabinet` capability to the registry

`sidecar/capability/registry.js` — append to `CAP_REGISTRY` so a "cabinet" (or "computer") object grants the fs tools. For the MVP, **grant `cabinet` + `web` off the `computer` object** so a single placed computer gives the agent a usable toolset (matches the game: one workstation = research + write). Two clean options — pick **Option A** for the MVP:

**Option A (MVP, simplest):** extend the `computer` grant list so placing one computer grants compute + web + cabinet:

```js
computer: [
  { capId: 'compute', tool: 'model.chat', scope: 'execute', requiresConsent: false, network: true },
  { capId: 'web',     tool: 'web_search', scope: 'read',    requiresConsent: false, network: true  },
  { capId: 'web',     tool: 'web_fetch',  scope: 'read',    requiresConsent: false, network: true  },
  { capId: 'cabinet', tool: 'fs.read',    scope: 'read',    requiresConsent: false, network: false },
  { capId: 'cabinet', tool: 'fs.list',    scope: 'read',    requiresConsent: false, network: false },
  { capId: 'cabinet', tool: 'fs.write',   scope: 'write',   requiresConsent: true,  network: false }
],
```

(`resolveTools` already expands these into the per-turn tool list and `approvalRules`; `web_fetch`/`fs.write` consent is auto-granted in the MVP host — see §6 consent shim. Option B, separate `dish`/`cabinet` objects, is the post-MVP shape and needs no code change here, only different `CAP_REGISTRY` rows + placing those objects.)

> Note `web.js` tags its tools `scope:'read'` already (`web.js:270,285`). Keep `requiresConsent:false` for search/fetch in the MVP so the loop doesn't stall waiting on a prompt UI that isn't built yet; the SSRF guard is the real safety boundary for fetch.

---

## 5. Event protocol + the agent loop (caps, timeouts, errors, final-answer streaming)

### 5a. The protocol IS the frozen `agent.*` bus — serialized as NDJSON

There is **no new event vocabulary**. Every line on `/api/run`'s response body is one validated bus event:

```
{"name":"agent.run.start","payload":{"agentId":"agent","runId":"…","trigger":"directive","model":"…"}}\n
{"name":"agent.reasoning","payload":{"agentId":"agent","runId":"…","on":true}}\n
{"name":"agent.token","payload":{"agentId":"agent","runId":"…","delta":"Look"}}\n
{"name":"agent.tool_call","payload":{"agentId":"agent","runId":"…","callId":"call_abc","name":"web_search","argsSummary":"{\"query\":\"EU AI Act 2026\"}"}}\n
{"name":"agent.tool_result","payload":{"agentId":"agent","runId":"…","callId":"call_abc","ok":true,"ms":812,"summary":"6 result(s) via duckduckgo-html","isError":false}}\n
{"name":"cost.estimate","payload":{"agentId":"agent","runId":"…","usd":0.0011,"tokens":216}}\n
{"name":"agent.cost","payload":{"agentId":"agent","runId":"…","usd":0.0012,"tokensIn":194,"tokensOut":22,"reasoningTokens":0,"cachedTokens":0,"model":"…","reconciled":true}}\n
{"name":"agent.run.end","payload":{"agentId":"agent","runId":"…","reason":"done","turns":4,"usd":0.0098}}\n
```

Full event table (all already frozen in `shared/events.js` — payloads are exact):

| Event | Payload (frozen) | Emitted when |
|---|---|---|
| `agent.run.start` | `{agentId, runId, trigger, model}` | once, first line |
| `agent.reasoning` | `{agentId, runId, on:bool}` | each model turn begin/end |
| `agent.token` | `{agentId, runId, delta}` | per content delta (final answer streams live) |
| `agent.tool_call` | `{agentId, runId, callId, name, argsSummary}` | model requests a tool |
| `agent.tool_result` | `{agentId, runId, callId, ok, ms, summary, isError}` | tool finishes/timeouts/denied |
| `cost.estimate` | `{agentId, runId, usd, tokens}` | usage delta arrives (marked estimate) |
| `agent.cost` | `{agentId, runId, usd, tokensIn, tokensOut, reasoningTokens, cachedTokens, model, reconciled:true}` | after each turn's reconcile |
| `agent.run.end` | `{agentId, runId, reason, turns, usd}` | terminal (one of) |
| `agent.run.error` | `{agentId, runId, message, transient}` | terminal (the other) |
| `deliverable` | `{id, agentId, kind, title}` | `fs.write`/`notebook.write` produces an artifact |

Guarantees (all already enforced by `loop.js`): `agent.run.start` first; exactly one of `agent.run.end`/`agent.run.error` last; every `agent.tool_call.callId` answered by exactly one `agent.tool_result.callId` before the next turn (`assertPaired`). **No secrets in any payload** — the BYOK key is read from the POST body, used only for the upstream `fetch`, never emitted; `argsSummary`/`summary` are short and payload-free.

### 5b. Loop limits / errors / streaming — supplied via the host, enforced by `loop.js`

The loop already implements every guard; the host passes the caps as `limits` and a real `AbortController` `signal`:

```js
limits = { maxIters: 8, maxCostUsd: 0.50 }   // loop.js reads maxIters + maxCostUsd
// per-tool timeout = tool.timeoutMs (web/fs set their own) OR ctx.timeoutMs fallback (registry.js:83)
```

- **maxIters (8):** `turns >= maxIters → end('max_iters')` (`loop.js:104`).
- **maxCostUsd (0.50/run):** checked against **reconciled** spend before each paid call → `end('budget')` (`loop.js:105`).
- **Compute gate:** if `capCtx.canRun()` is false (no computer in the room) → emit `capdenied`, `end('error')` (`loop.js:107-110`). For the MVP host, the resolved capabilities always include a computer (we synthesize a one-computer station — §6), so this passes.
- **Per-tool timeout:** `registry.dispatch` wraps `run()` in `withTimeout(tool.timeoutMs)` (`registry.js:83-91`); on timeout → `isError` result, loop continues.
- **Stuck-loop breaker:** the findings' `maxRepeat` is **not** in the current `loop.js`. Add it as a small guard in the host's `dispatch` wrapper (count identical `name+argsRaw`, after N=3 return an `isError` result) — see §6. This is a host-side wrapper, not a loop edit, keeping `loop.js` byte-stable and its replay tests green.
- **Errors never escape the loop:** any tool throw/timeout/deny becomes an `isError` `agent.tool_result` (`loop.js:62-70`); a provider/stream throw becomes `agent.run.error` + `end('error')` (`loop.js:126-129`).
- **Final-answer streaming:** the loop emits `agent.token` for every text delta on **every** turn (`loop.js:120`). Tool-decision turns usually carry little/no prose; the terminal turn (zero tool calls) is the streamed report. No special-casing needed — the typewriter falls out of the existing emit.
- **Cancellation:** `signal.aborted` is checked before each turn and mid-stream (`loop.js:103,119,132`); partial text is appended; `end('cancelled')`.

---

## 6. The sidecar host file (skeleton): static serve + `/api/run` NDJSON + jail + kill/caps

`sidecar/index.js` is **NEW** and is the only place that touches `node:http`/`node:fs`/`fetch`/`process.env`. It assembles the existing modules. **It is CommonJS (`require`) to match the repo's UMD modules** — *not* ESM, despite the findings. (No `package.json` `"type":"module"`; the repo deliberately uses the UMD tail so the same files load under node and the browser.)

```js
/* sidecar/index.js — the Node host. Serves frontend/ + runs the real harness loop,
   streaming the FROZEN agent.* events as NDJSON. The ONLY module with ambient I/O. */
'use strict';
const http = require('node:http');
const fsp  = require('node:fs/promises');
const fs   = require('node:fs');
const path = require('node:path');

const { runAgentLoop }      = require('./loop.js');
const { makeRegistry }      = require('./tools/registry.js');
const { makeWebTools }      = require('./tools/builtin/web.js');
const { makeFsTools }       = require('./tools/builtin/fs.js');
const { makeCostEngine }    = require('./cost.js');
const { resolveTools }      = require('./capability/resolve.js');
const { makeCapCtx }        = require('./capability/capGate.js');
const { makeOpenRouterProvider } = require('./providers/openrouter.js');   // NEW, §2

const PORT = Number(process.env.SKYNET_PORT) || 8787;
const FRONTEND = path.resolve(__dirname, '..', 'frontend');
const WORKSPACES = path.resolve(__dirname, 'workspaces');
const CAPS = { maxIters: 8, maxCostUsd: 0.50, maxRepeat: 3, toolTimeoutMs: 15000 };

const runs = new Map();   // runId -> AbortController (kill path)

// ---- NDJSON emit = the bus adapter: validate-then-write one line per event ----
//   (reuse shared/emitter.js so payloads are validated against the FROZEN registry;
//    a malformed payload is dropped+logged, NEVER written — same guarantee as the browser)
const { makeEmitter } = require('../shared/emitter.js');

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  if (req.method === 'POST' && req.url === '/api/run')    return handleRun(req, res);
  if (req.method === 'POST' && req.url === '/api/cancel') return handleCancel(req, res);
  if (req.method === 'GET'  && req.url === '/api/health') return res.writeHead(200).end('ok');
  return serveStatic(req, res);   // everything else -> frontend/ (path-jailed, see below)
}).listen(PORT, '127.0.0.1', () => console.log('STARNET sidecar → http://127.0.0.1:' + PORT));

async function handleRun(req, res) {
  let body; try { body = JSON.parse(await readBody(req, 1 << 20)); }
  catch { return res.writeHead(400).end('bad json'); }
  const { key, model, system, messages = [], agentId = 'agent', isTask = false } = body || {};
  if (!key || !model) return res.writeHead(400).end('missing key/model');

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', 'Connection': 'keep-alive'
  });

  const ac = new AbortController();
  const runId = require('node:crypto').randomUUID();
  runs.set(runId, ac);
  req.on('close', () => { ac.abort(); runs.delete(runId); });   // tab closed / DISCONNECT -> kill spend

  // bus adapter: one validated NDJSON line per event; never throws
  const bus = { emit: (name, payload) => { try { res.write(JSON.stringify({ name, payload }) + '\n'); } catch (_) {} } };
  const emit = makeEmitter(bus, e => console.warn('[event]', e.kind, e.event, e.errors || ''));

  // ---- build the real graph from the EXISTING seams ----
  const provider = makeOpenRouterProvider({ fetch: globalThis.fetch, key, baseUrl: 'https://openrouter.ai/api/v1' });
  const cost     = makeCostEngine({ priceOf: provider.priceOf });

  // tools: web (DDG/Jina, OR fallback uses the same key) + fs (jailed). Self-throttle web_search.
  const registry = makeRegistry();
  makeWebTools({ openrouter: { apiKey: key, model } }).register(registry);
  makeFsTools({ fsp, pathMod: path, root: WORKSPACES, limits: { writeBytes: 1 << 20, readReturn: 200000 } }).register(registry);
  throttleTool(registry, 'web_search', 1100);   // ≥1.1s between DDG hits (Finding B reliability fix)

  // capabilities: synthesize a one-computer station so the compute gate passes and the
  // computer-grants-web+cabinet rows resolve (CAP_REGISTRY Option A).
  const station = { agents: { [agentId]: { id: agentId, room: 'office' } },
                    rooms:  { office: { id: 'office', objects: [{ instanceId: 'pc1', objectType: 'computer' }] } } };
  const resolved = resolveTools(agentId, station);
  // MVP consent shim: auto-allow (no prompt UI yet). SSRF guard + jail are the real boundaries.
  const capCtx = makeCapCtx(resolved, {
    consent: async () => ({ allow: true }),
    timeoutMs: CAPS.toolTimeoutMs,
    emit   // so tools can emit 'deliverable'
  });

  // stuck-loop breaker + per-call ctx injection, wrapping the registry dispatch (keeps loop.js stable)
  const seen = new Map();
  const dispatch = async (call, ctx) => {
    const sig = (call.name + (call.argsRaw || '')).slice(0, 300);
    const n = (seen.get(sig) || 0) + 1; seen.set(sig, n);
    if (n > CAPS.maxRepeat) return { ok: false, isError: true, content: 'repeated identical call blocked', summary: 'loop-break' };
    return registry.dispatch(call, Object.assign({ agentId, emit, consent: capCtx.consent,
      canUse: capCtx.canUse, timeoutMs: CAPS.toolTimeoutMs }, ctx));
  };

  const msgs = system ? [{ role: 'system', content: system }, ...messages] : messages.slice();
  const tools = isTask ? registry.wireFormat(registry.list(new Set(resolved.tools))) : [];

  try {
    await runAgentLoop({
      messages: msgs, tools, provider, emit, dispatch, capCtx, cost,
      limits: { maxIters: CAPS.maxIters, maxCostUsd: CAPS.maxCostUsd },
      signal: ac.signal, clock: { now: () => Date.now() },
      agentId, runId, model, trigger: 'directive'
    });
  } catch (e) {
    try { emit('agent.run.error', { agentId, runId, message: 'sidecar failure', transient: false }); } catch (_) {}
  } finally { runs.delete(runId); res.end(); }
}

async function handleCancel(req, res) {
  const { runId } = JSON.parse((await readBody(req, 4096)) || '{}');
  const ac = runs.get(runId); if (ac) ac.abort();
  res.writeHead(200).end('ok');
}

// ---- helpers ----
function readBody(req, max) { return new Promise((resolve, reject) => {
  let b = '', n = 0; req.on('data', c => { n += c.length; if (n > max) { reject(new Error('too big')); req.destroy(); } else b += c; });
  req.on('end', () => resolve(b)); req.on('error', reject); }); }

function throttleTool(registry, name, minMs) {
  const t = registry.get(name); if (!t) return; let last = 0; const orig = t.run.bind(t);
  t.run = async (args, ctx) => { const wait = last + minMs - Date.now(); if (wait > 0) await new Promise(r => setTimeout(r, wait)); last = Date.now(); return orig(args, ctx); };
}

// static file server, JAILED to FRONTEND (no path traversal, no symlink escape)
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml', '.woff2':'font/woff2' };
async function serveStatic(req, res) {
  try {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    let rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
    const abs = path.resolve(FRONTEND, rel);
    if (abs !== FRONTEND && !abs.startsWith(FRONTEND + path.sep)) return res.writeHead(403).end('forbidden');
    const data = await fsp.readFile(abs);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404).end('not found'); }
}
```

**Workspaces jail:** `fs.js`'s `resolveInside` proves every path is inside `sidecar/workspaces/<agentId>/`; absolute paths, drive letters, and `..` are rejected before any I/O. `agentId` itself is validated `[A-Za-z0-9_-]{1,40}`. Add `sidecar/workspaces/.gitkeep` and gitignore the rest. **Kill/caps:** every run has an `AbortController` keyed by `runId`; `POST /api/cancel {runId}` and `req.on('close')` both abort it; `loop.js` enforces `maxIters`/`maxCostUsd`/per-tool-timeout; the host wrapper adds `maxRepeat` and the `web_search` throttle.

---

## 7. Exact frontend changes (key location, NDJSON reader, COMMS tool lines, World hold)

### 7a. `frontend/app/harness.js` — swap transport inside `chat()`, keep the frozen surface

Everything except `chat()` stays (`getKey/setKey/getModel/setModel/getProv/setProv/listModels/priceOf/totals/setTotals/resetTotals`). `listModels` still hits OR `/models` directly (no key, CORS-fine). Replace the body of `chat()` (`harness.js:53-117`) with a `/api/run` POST + NDJSON reader that **re-emits each `{name,payload}` onto `U.bus`** and keeps the old `onToken/onUsage` callbacks working, plus adds optional `onToolCall/onToolResult`:

```js
async function chat({ system, messages, onToken, onUsage, onToolCall, onToolResult, agentId, isTask, signal }) {
  const key = getKey(), model = getModel();
  if (!key)   throw new Error('no API key set');
  if (!model) throw new Error('no model selected');

  const res = await fetch('/api/run', {            // same origin — sidecar serves this page
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, model, system, messages, agentId: agentId || 'agent', isTask: !!isTask })
  });
  if (!res.ok || !res.body) throw new Error('sidecar HTTP ' + res.status);

  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '', full = '', lastUsage = null, runId = null, errMsg = null;

  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line) continue;
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      const { name, payload } = ev;
      // RE-EMIT the real bus event so telemetry.js / world.js / HUD light up (after M3).
      if (typeof U !== 'undefined' && U.bus) U.bus.emit(name, payload);
      switch (name) {
        case 'agent.run.start':  runId = payload.runId; break;
        case 'agent.token':      full += payload.delta; onToken && onToken(payload.delta); break;
        case 'agent.tool_call':  onToolCall && onToolCall(payload); break;
        case 'agent.tool_result':onToolResult && onToolResult(payload); break;
        case 'agent.cost':       // authoritative running totals
          totals.tokens += (payload.tokensIn || 0) + (payload.tokensOut || 0);
          totals.cost   += payload.usd || 0;
          lastUsage = { total_tokens: (payload.tokensIn||0)+(payload.tokensOut||0), cost: payload.usd };
          onUsage && onUsage(lastUsage); break;
        case 'agent.run.error':  errMsg = payload.message; break;
        case 'agent.run.end':    break;
      }
    }
  }
  totals.calls++;
  if (errMsg) throw new Error(errMsg);
  return { text: full, usage: lastUsage, runId };
}
```

- **Where the key goes:** still read from `localStorage` via `getKey()` and sent in the POST body to `127.0.0.1` **only** (and from there to OR). No key ever appears in an NDJSON event or a log. This is the honest MVP posture; the Tauri keychain step (`getKey()` → boolean) is the later swap the architecture doc already specifies — this MVP keeps the seam intact.
- The OR SSE parsing at `harness.js:64-116` is **deleted** — the sidecar owns it. The `OR` constant stays only for `listModels`. The deprecated `usage:{include:true}` (`harness.js:62`) goes away entirely.
- `cancel(runId)` is added to the returned surface: `POST /api/cancel {runId}` (wired to DISCONNECT — §7c).

### 7b. `frontend/app/chat.js` — tool lines in COMMS, hold `World.setActivity('task')` for the whole run

Pass `isTask` + the two new callbacks into `Harness.chat` (replace the call at `chat.js:94-98`):

```js
const { text: reply } = await Harness.chat({
  system: sys, messages: history, agentId: 'agent', isTask,
  onToken: d => { acc += d; out.append(d); if (!isTask) World.say(acc); App.refreshUsage(); },
  onUsage: () => App.refreshUsage(),
  onToolCall:   ev => toolLine('▶ ' + ev.name + ' ' + brief(ev.argsSummary)),
  onToolResult: ev => toolLine((ev.ok ? '◀ ' : '◁ ') + ev.name + ': ' + ev.summary + ' (' + ev.ms + 'ms)', !ev.ok)
});
```

Add two helpers (near `chat.js:45`):

```js
function toolLine(text, isErr) {
  const r = row('agent'); r.d.classList.add('tool'); if (isErr) r.d.classList.add('err');
  r.body.textContent = text; log.scrollTop = log.scrollHeight;
}
function brief(s) { s = String(s || ''); return s.length > 60 ? s.slice(0, 57) + '…' : s; }
```

**`World.setActivity('task')` already spans the whole turn** — it's set at `chat.js:85` and only cleared in `finally` at `chat.js:105`. Because the loop now runs multiple tool steps inside that single `await Harness.chat(...)`, the agent **stays seated and "working" for the entire multi-step run** with zero `world.js` change. The COMMS panel reads:

```
COMMANDER  research the best budget mechanical keyboard and write it up
AGENT      ▶ web_search {"query":"best budget mechanical keyboard 2026"}
AGENT      ◀ web_search: 6 result(s) via duckduckgo-html (812ms)
AGENT      ▶ web_fetch {"url":"https://…"}
AGENT      ◀ web_fetch: 5212 chars via jina (1430ms)
AGENT      ▶ fs.write {"path":"keyboards.md"}
AGENT      ◀ fs.write: wrote keyboards.md (2.3 KB) (4ms)
AGENT      Done, Commander. I compared four boards and saved keyboards.md …   ← streams live
```

### 7c. `frontend/index.html` — copy + DISCONNECT wiring (no structural change)

Scripts are relative and the sidecar serves the same `frontend/` tree, so paths resolve unchanged. Two edits: (1) connect-panel copy → "Your key + messages go to your **local** STARNET sidecar on this machine, which calls the model and runs the agent's web/file tools" (informed consent). (2) Wire the existing DISCONNECT button to also `POST /api/cancel {runId}` of the active run so closing down stops live spend immediately (belt-and-suspenders with `req.on('close')`).

---

## 8. `gen/` file tree additions + the `start` script

```
gen/
  sidecar/
    index.js                       NEW  node:http host: static + /api/run NDJSON + /api/cancel + /api/health + caps/kill
    providers/
      openrouter.js                NEW  OR SSE -> HarnessEvent stream (the ONLY OR-aware module; §2)
      catalog.js                   OPTIONAL  /models -> supportsTools (deferred; provider.listModels covers MVP)
    tools/
      builtin/
        fs.js                      NEW  fs.read/fs.write/fs.list, jailed to workspaces/<agentId>/ (§4b)
    workspaces/
      .gitkeep                     NEW  (gitignore the rest)
    capability/
      registry.js                  EDIT add web+cabinet grants to the `computer` object (§4c Option A)
  frontend/app/
    harness.js                     EDIT chat() transport -> /api/run NDJSON; re-emit on U.bus; keep surface (§7a)
    chat.js                        EDIT pass isTask + onToolCall/onToolResult; toolLine/brief helpers (§7b)
  index.html (frontend/)           EDIT connect copy + DISCONNECT -> /api/cancel (§7c)
  test/
    provider.openrouter.test.js    NEW  feed canned OR SSE bytes through makeOpenRouterProvider, assert HarnessEvents
    fs.jail.test.js                NEW  resolveInside rejects .. / absolute / drive / escape; write/read/list roundtrip
  package.json                     EDIT add "start" + "sidecar" scripts (NO "type":"module" — repo is UMD/CJS)
  .gitignore                       EDIT add sidecar/workspaces/*  (keep .gitkeep)
```

`package.json` scripts (add to the existing block — the repo is CommonJS, do **not** add `"type":"module"`):

```json
"start":   "node sidecar/index.js",
"sidecar": "node sidecar/index.js"
```

Run from `gen/`: `npm start` → `http://127.0.0.1:8787`. No `npm install` — Node 18+ only (`node:http`, global `fetch`, `AbortController`, `node:crypto`).

---

## 9. Top risks + the build/verify order (smallest test-backed steps)

**Top risks (and the mitigation already chosen):**

1. **Provider SSE correctness** is the whole ballgame — fragmented `index`-keyed tool args, `[DONE]`, `:`-keepalives, usage-only-on-last-chunk, mid-stream `error` chunks. → Build `openrouter.js` test-first against canned byte fixtures; it's the only new logic the proven loop depends on.
2. **`tool.web` event rejection** — `web.js` emits a non-frozen event that `validate` drops. → Decision in §3: don't pass an emit handler for `tool.web`; rely on the frozen `agent.tool_call/result`. (Cheap; avoids re-freezing the event registry.)
3. **DDG 202 IP-block under bursty use** (Finding B's #1 risk) → host-side `web_search` throttle (≥1.1 s) + the existing fallback chain + per-run `maxIters`/`maxRepeat`. Degrades gracefully; never returns the empty shell as results.
4. **Path-jail escape** on Windows (drive letters, `..`, UNC, symlinks) → `resolveInside` proves `abs.startsWith(base + sep)` *and* rejects absolute/`..` up front; covered by `fs.jail.test.js` including Windows-specific inputs (`C:\…`, `\\server\share`, `..\..`).
5. **Cost dishonesty** if `usage` is misread → reuse the existing `makeCostEngine` (real `usage.cost` wins; reconcile overwrites estimate). Don't reintroduce `usage:{include:true}`.
6. **Loop regression** — the loop is test-locked by `loop.replay.test.js`. → **Do not edit `loop.js`.** All MVP additions (`maxRepeat`, throttle, consent shim, ctx injection) live in the host wrapper, keeping replay determinism green.
7. **Key leakage** → key only in the POST body and the upstream `fetch` header; never in any event/log; `serveStatic` is jailed to `frontend/` so the sidecar can't be used to read arbitrary disk.

**Build/verify order (each step independently testable):**

1. **`providers/openrouter.js` + `provider.openrouter.test.js`** — feed recorded OR SSE bytes (a text-only turn, a tool-call turn with split args, a mid-stream error, a usage chunk) through `stream(req)`; assert the exact `HarnessEvent` sequence and `normalizeFinish`. *Gate: matches the replay provider's event shape.* No network.
2. **`tools/builtin/fs.js` + `fs.jail.test.js`** — inject an in-memory `fsp` fake + `node:path`; assert traversal/absolute/drive rejection and write→read→list roundtrip + size cap. No real disk.
3. **`capability/registry.js` edit + rerun `test/capgate.test.js` / `test/tools.test.js`** — confirm `resolveTools` on a one-computer station now yields `web_search/web_fetch/fs.*` and `hasCompute:true`, and existing cap-gate tests still pass.
4. **Headless loop integration (node, no browser, no key):** wire `registry` (web with an **injected `fetchImpl` fake** returning canned DDG/Jina bytes) + `fs` (in-mem) + **replay provider** into `runAgentLoop`; assert the full event sequence (`run.start → tool_call → tool_result → … → run.end`) and `assertPaired` holds across a search→fetch→write run. *This proves the whole MVP minus real I/O, deterministically.*
5. **`sidecar/index.js` smoke (real process):** `npm start`; `GET /api/health` → `ok`; `GET /` serves `index.html`; `POST /api/run` with a **fake/echo key against a stubbed provider base URL** (or a tiny canned model) → assert NDJSON lines parse and end with `agent.run.end`. Verify `req.on('close')` aborts (drop the connection mid-run, confirm spend stops).
6. **`harness.js` transport swap + manual browser run:** point the connect panel at a real BYOK key + a tool-capable model (`anthropic/claude-sonnet-4.5`); issue a research-and-write directive; confirm COMMS shows `▶/◀` tool lines, the final answer streams, a file lands in `sidecar/workspaces/agent/`, the HUD cost ticks from `agent.cost`, and DISCONNECT/`/api/cancel` stops a run mid-flight.
7. **`chat.js` + `index.html` polish:** tool-line styling, consent copy, DISCONNECT→cancel — verified visually against the COMMS transcript in §7b.

Steps 1–4 are pure/headless and gate CI exactly like the existing `test:fast` suite; steps 5–7 are the live integration. Ship after 6.

**Load-bearing files:** new — `C:\Users\<you>\OneDrive\Desktop\gen\sidecar\index.js`, `C:\Users\<you>\OneDrive\Desktop\gen\sidecar\providers\openrouter.js`, `C:\Users\<you>\OneDrive\Desktop\gen\sidecar\tools\builtin\fs.js`; edited — `C:\Users\<you>\OneDrive\Desktop\gen\sidecar\capability\registry.js`, `C:\Users\<you>\OneDrive\Desktop\gen\frontend\app\harness.js`, `C:\Users\<you>\OneDrive\Desktop\gen\frontend\app\chat.js`, `C:\Users\<you>\OneDrive\Desktop\gen\frontend\index.html`, `C:\Users\<you>\OneDrive\Desktop\gen\package.json`; reused unchanged — `loop.js`, `tools/registry.js`, `tools/builtin/web.js`, `cost.js`, `capability/resolve.js`, `capability/capGate.js`, `shared/events.js`, `shared/emitter.js`. Aligns with `C:\Users\<you>\OneDrive\Desktop\gen\docs\HARNESS_ARCHITECTURE.md` — this is the concrete M5/M6 landing: `providers/openrouter.js` + `tools/builtin/fs.js` + the Node host, with the frozen `agent.*` bus serialized as the NDJSON wire.