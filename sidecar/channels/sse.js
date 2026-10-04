/* sidecar/channels/sse.js — a tiny Server-Sent-Events fan-out.

   The sidecar already validates + redacts every channel.* / workitem.* / queue.* event before it
   reaches chanBus.emit; this hub forwards each of those to every open browser EventSource so the
   live station world can animate them (a box riding the belt, a queue-depth gauge). It is the
   browser-facing half of the bridge the index.js comment reserved.

   Pure + testable: a "client" is any object with a .write(string) method (an http ServerResponse
   duck-types it). No node:http dependency, no ambient I/O — so test/channels.sse.test.js drives it
   with a fake res. A client whose write() throws (dead socket) is evicted on the next broadcast. */
'use strict';

/* G2.1 — the server-initiated-run egress policy: which runOnce lifecycle events a broadcast-opted
   AUTONOMOUS run (a routed channel message, a scheduled cron fire) may tee onto the SSE bus, and in
   what SHAPE. Pure (no IO/clock) so the redaction contract is unit-testable. ONE policy owned here so
   BOTH autonomous lanes — channels/sse.js's broadcast tee AND cron-driver.js's emit sink — obey the
   same B4 redacted-egress rule (2026-07-06 audit: the two lanes had drifted apart — the tee shipped
   too FEW events, the cron sink shipped tool_call args it should have stripped). runTeeView returns
   the payload VIEW to broadcast, or null for "never teed".
     • agent.run.start / agent.cost / agent.run.end — teed whole (the floor's run lifecycle).
     • agent.tool_call — teed NAME-ONLY: { agentId, runId, callId, name }. args/argsSummary are
       stripped STRUCTURALLY (never copied), so a routed run's tool arguments — which can carry user
       text, file paths, or fetched content — never leave the sidecar on this path. The four kept
       fields satisfy the frozen agent.tool_call schema, so every existing consumer (connector-portal
       pulse, G0 per-tool prop pulse, desk heat, delegation window) still fires for autonomous runs.
     • agent.tool_result — teed OUTCOME-ONLY: { agentId, runId, callId, ok, isError, ms }. The
       payload-bearing `summary` (a stringified tool result — may carry fetched content / file text)
       is stripped STRUCTURALLY. Lets the floor render a FAILED/denied tool call as a red/dim surge
       for autonomous runs without the result body ever leaving the sidecar.
     • deliverable / agent.run.error / memory.write / memory.recall / capdenied — teed whole. Their
       frozen schemas carry only metadata (ids, kinds, counts, a short error MESSAGE that context.js's
       redact() scrubs as a second backstop) — no tool args or result payloads — so an unattended run
       ships crates, pulses memory, and strobes errors on the floor exactly like a browser-watched one.
     • agent.token (and everything else) — null. The token stream stays off the SSE bus by design
       (that noise decision stands; desk heat for UNWATCHED runs rides tool_call instead). */
function runTeeView(name, payload) {
  const p = payload || {};
  if (name === 'agent.run.start' || name === 'agent.cost' || name === 'agent.run.end') return p;
  if (name === 'agent.tool_call') {
    return {
      agentId: String(p.agentId == null ? '' : p.agentId),
      runId: String(p.runId == null ? '' : p.runId),
      callId: String(p.callId == null ? '' : p.callId),
      name: String(p.name == null ? '' : p.name)
    };
  }
  if (name === 'agent.tool_result') {
    // OUTCOME-ONLY: keep the frozen schema's required fields + timing/error-kind; NEVER copy `summary`
    // (the result body). Structural strip — the payload text is never in the returned object at all.
    return {
      agentId: String(p.agentId == null ? '' : p.agentId),
      runId: String(p.runId == null ? '' : p.runId),
      callId: String(p.callId == null ? '' : p.callId),
      ok: !!p.ok,
      isError: !!p.isError,
      ms: Number(p.ms) || 0
    };
  }
  // metadata-only lifecycle events: no args/result payloads in their frozen schemas -> teed whole so an
  // autonomous run is as observable as a browser one (crates, memory pulses, error strobes, cap denials).
  if (name === 'deliverable' || name === 'agent.run.error' || name === 'memory.write'
      || name === 'memory.recall' || name === 'capdenied') return p;
  return null;
}

// Backpressure ceiling: a ZOMBIE client (still connected at TCP but not reading — a suspended laptop, a wedged
// tab) makes res.write() return false and the kernel/Node buffer the frame in process memory. Left alone that
// buffer grows without bound for the life of the (never-closing) socket — a slow memory leak the throw-based
// dead-socket eviction never catches (write() doesn't throw, it just returns false). So once a client's buffered
// bytes cross this ceiling, we treat it as gone and evict it. 4MB is ~thousands of queued HUD frames — a healthy
// reader drains far below it; only a truly stuck socket ever gets here.
const SSE_MAX_BUFFER_BYTES = 4 * 1024 * 1024;

// EventSource deliberately hides SSE comment lines from JavaScript. The station uses receipt of a
// MessageEvent as its proof that the live telemetry link is still carrying bytes, so the idle
// keepalive must be a DATA frame. An empty object is valid JSON but has neither a product-event
// `name` nor `payload`; world.js refreshes its link clock and then emits nothing to U.bus.
// Pure + exported so the exact browser-visible wire contract stays unit-testable.
function formatKeepalive() { return 'data: {}\n\n'; }

function makeSseHub(options) {
  const o = options || {};
  const epoch = String(o.epoch || 'local').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 80);
  const maxEvents = Math.max(1, Math.min(2048, Number(o.maxEvents) || 1024));
  const maxBytes = Math.max(256, Math.min(4 * 1024 * 1024, Number(o.maxBytes) || 2 * 1024 * 1024));
  let sequence = 0, bytes = 0;
  const history = [];
  const cursor = () => epoch + ':' + sequence;
  const clients = new Set();

  // SSE wire frame: one event per `data:` line, terminated by a blank line.
  function format(name, payload) { return 'data: ' + JSON.stringify({ name, payload }) + '\n\n'; }

  function add(res) { clients.add(res); return () => clients.delete(res); }
  function remove(res) { return clients.delete(res); }
  function size() { return clients.size; }

  function write(res, frame) {
    try {
      const ok = res.write(frame);
      if (ok === false && Number(res.writableLength) > SSE_MAX_BUFFER_BYTES) { evict(res); return false; }
      return true;
    } catch (_) { evict(res); return false; }
  }

  // Called synchronously after add: replay and live broadcasts cannot interleave. Control frames
  // are transport metadata, never product events. A restart/expired cursor requires a snapshot.
  function resume(res, lastId) {
    const raw = String(lastId || '');
    const prefix = epoch + ':';
    const tail = raw.startsWith(prefix) ? raw.slice(prefix.length) : '';
    const n = /^\d+$/.test(tail) ? Number(tail) : -1;
    const oldest = history.length ? history[0].sequence : sequence + 1;
    const valid = Number.isSafeInteger(n) && n >= oldest - 1 && n <= sequence;
    if (valid) for (const row of history) {
      if (row.sequence > n && row.frame && !write(res, row.frame)) return false;
    }
    return write(res, 'id: ' + cursor() + '\ndata: ' + JSON.stringify({ stream: 'ready', cursor: cursor(), reset: !valid }) + '\n\n');
  }

  // Hard-evict a backpressured/dead client: drop it from the set, then best-effort end+destroy the socket so the
  // buffered bytes are released (a plain delete would leave Node still holding the write buffer alive).
  function evict(res) {
    clients.delete(res);
    try { if (typeof res.end === 'function') res.end(); } catch (_) {}
    try { if (typeof res.destroy === 'function') res.destroy(); } catch (_) {}
  }

  // returns how many clients the event actually reached (dead/backpressured clients are dropped, not counted).
  function broadcast(name, payload) {
    const line = 'id: ' + epoch + ':' + (++sequence) + '\n' + format(name, payload);
    // Commands may already have timed out or executed. Reconnect restores observations,
    // never retries a renderer mutation. Keep a sequence tombstone so cursors remain valid.
    const replayable = name !== 'station.command';
    const length = replayable ? Buffer.byteLength(line, 'utf8') : 0;
    history.push({ sequence, frame: replayable ? line : null, bytes: length }); bytes += length;
    while (history.length && (history.length > maxEvents || bytes > maxBytes)) bytes -= history.shift().bytes;
    let n = 0;
    for (const res of clients) {
      let ok;
      try { ok = res.write(line); n++; }
      catch (_) { evict(res); continue; }   // socket gone (write threw) → evict so we never grow unbounded
      // write() returned false → the client isn't draining. Tolerate transient backpressure, but once the
      // buffered bytes cross the ceiling the client is a zombie: evict it (and don't count it as reached).
      if (ok === false && Number(res.writableLength) > SSE_MAX_BUFFER_BYTES) { evict(res); n--; }
    }
    return n;
  }

  // Keep one registered idle client visibly alive to EventSource.onmessage. This mirrors broadcast's
  // dead-socket and bounded-backpressure policy so the periodic frame cannot retain a zombie response.
  function keepalive(res) {
    if (!clients.has(res)) return false;
    let ok;
    try { ok = res.write(formatKeepalive()); }
    catch (_) { evict(res); return false; }
    if (ok === false && Number(res.writableLength) > SSE_MAX_BUFFER_BYTES) {
      evict(res);
      return false;
    }
    return true;
  }

  return { add, remove, size, broadcast, keepalive, format, resume, cursor, _internals: { SSE_MAX_BUFFER_BYTES } };
}

module.exports = { makeSseHub, runTeeView, formatKeepalive };
