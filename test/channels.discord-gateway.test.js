/* node test/channels.discord-gateway.test.js — the REAL Discord gateway v10 WS client (P2-E).

   discord.gateway.js is the missing default injection for discord.transport.js's connectGateway seam: a bot token
   -> a live push of raw MESSAGE_CREATE payloads. Everything ambient (fetch, WebSocket, timers, rng) is injected, so
   this drives the full handshake + heartbeat + reconnect/resume logic deterministically with a FAKE WebSocket and a
   FAKE timer queue — no real network, no wall clock.

   Coverage:
     A. Handshake: HELLO -> IDENTIFY (with the four intents) -> READY records session/bot id.
     B. Dispatch: MESSAGE_CREATE -> onMessage(raw d); the bot's OWN message is ignored; seq is tracked.
     C. Heartbeat: op 1 sent on the interval with the last seq; op 11 ACK clears the zombie flag; a MISSED ack ->
        reconnect.
     D. op 7 RECONNECT and op 9 INVALID_SESSION drive a reconnect (RESUME when resumable, fresh IDENTIFY when not).
     E. Unexpected close -> exponential backoff reconnect; a fatal close code (bad token) stops for good.
     F. close() tears everything down and stops reconnecting. */
'use strict';
const A = require('./_assert.js');
const { makeDiscordGateway, DEFAULT_INTENTS, INTENT } = require('../sidecar/channels/discord.gateway.js');

// ---- a deterministic fake timer queue: setTimeout enqueues; run() fires due timers in order ----
function fakeTimers() {
  let clock = 0, id = 0;
  const q = [];   // { id, at, fn }
  const setT = (fn, ms) => { const t = { id: ++id, at: clock + (ms || 0), fn }; q.push(t); return t; };
  const clearT = (t) => { const i = q.indexOf(t); if (i !== -1) q.splice(i, 1); };
  // advance the clock by ms, firing every timer whose deadline passes (in time order). Guards against runaway loops.
  const advance = (ms) => {
    const target = clock + ms;
    let guard = 0;
    while (guard++ < 100000) {
      const due = q.filter(t => t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      clock = due.at;
      clearT(due);
      try { due.fn(); } catch (_) {}
    }
    clock = target;
  };
  return { setTimeoutImpl: setT, clearTimeoutImpl: clearT, advance, now: () => clock, pending: () => q.length };
}

// ---- a fake WebSocket: records outbound frames; test drives inbound via .emit(...) ----
function makeFakeWS() {
  const instances = [];
  class FakeWS {
    constructor(url) {
      this.url = url; this.readyState = 1; this.sent = []; this._lis = {};
      instances.push(this);
    }
    addEventListener(ev, fn) { (this._lis[ev] = this._lis[ev] || []).push(fn); }
    send(s) { this.sent.push(JSON.parse(s)); }
    close(code, reason) { this.readyState = 3; this._fire('close', { code: code || 1000, reason: reason || '' }); }
    // test helpers
    _fire(ev, data) { (this._lis[ev] || []).forEach(fn => { try { fn(data); } catch (_) {} }); }
    open() { this._fire('open', {}); }
    emit(payload) { this._fire('message', { data: JSON.stringify(payload) }); }
    serverClose(code) { this.readyState = 3; this._fire('close', { code }); }
  }
  FakeWS._instances = instances;
  FakeWS._last = () => instances[instances.length - 1];
  return FakeWS;
}

function okFetch(url) {
  return { ok: true, status: 200, async json() { return { url: 'wss://gw.test' }; } };
}

(async () => {
  // ---- A. handshake: HELLO -> IDENTIFY (intents) -> READY ----
  {
    const timers = fakeTimers();
    const FakeWS = makeFakeWS();
    const inbox = [];
    const states = [];
    const gw = makeDiscordGateway({
      token: 'BOT', onMessage: m => inbox.push(m), onState: s => states.push(s.state),
      fetch: okFetch, WebSocketImpl: FakeWS, gatewayUrl: 'wss://gw.test',
      setTimeoutImpl: timers.setTimeoutImpl, clearTimeoutImpl: timers.clearTimeoutImpl, now: timers.now, random: () => 0.5
    });
    await Promise.resolve(); await Promise.resolve();   // let the async openConnection() settle (fetch/resolveUrl)
    const ws = FakeWS._last();
    A.ok(ws, 'a websocket was opened');
    A.ok(/v=10/.test(ws.url) && /encoding=json/.test(ws.url), 'connects to gateway v10 json');
    ws.open();
    ws.emit({ op: 10, d: { heartbeat_interval: 45000 } });   // HELLO
    const identify = ws.sent.find(f => f.op === 2);
    A.ok(identify, 'IDENTIFY (op 2) sent after HELLO');
    A.eq(identify.d.token, 'BOT', 'IDENTIFY carries the bot token');
    A.eq(identify.d.intents, DEFAULT_INTENTS, 'IDENTIFY requests the default intents');
    A.ok((identify.d.intents & INTENT.MESSAGE_CONTENT) !== 0, 'MESSAGE_CONTENT intent is set (needed to read text)');
    A.ok((identify.d.intents & INTENT.DIRECT_MESSAGES) !== 0, 'DIRECT_MESSAGES intent is set');
    // READY
    ws.emit({ op: 0, t: 'READY', s: 1, d: { session_id: 'sess123', resume_gateway_url: 'wss://resume.test', user: { id: 'BOTID' } } });
    A.ok(states.indexOf('up') !== -1, 'state goes up on READY');
    A.eq(gw._state().sessionId, 'sess123', 'session id recorded from READY');
    A.eq(gw._state().botUserId, 'BOTID', 'bot user id recorded from READY (for self-ignore)');
    gw.close();
  }

  // ---- B. dispatch: MESSAGE_CREATE delivered; own message ignored; seq tracked ----
  {
    const timers = fakeTimers();
    const FakeWS = makeFakeWS();
    const inbox = [];
    const gw = makeDiscordGateway({
      token: 'BOT', onMessage: m => inbox.push(m), fetch: okFetch, WebSocketImpl: FakeWS, gatewayUrl: 'wss://gw.test',
      setTimeoutImpl: timers.setTimeoutImpl, clearTimeoutImpl: timers.clearTimeoutImpl, now: timers.now, random: () => 0.5
    });
    await Promise.resolve(); await Promise.resolve();
    const ws = FakeWS._last(); ws.open();
    ws.emit({ op: 10, d: { heartbeat_interval: 45000 } });
    ws.emit({ op: 0, t: 'READY', s: 1, d: { session_id: 's', user: { id: 'BOTID' } } });
    // a real user message -> delivered raw
    ws.emit({ op: 0, t: 'MESSAGE_CREATE', s: 2, d: { id: '900', channel_id: '111', content: 'hi', author: { id: 'USER', username: 'andro' } } });
    A.eq(inbox.length, 1, 'a user MESSAGE_CREATE is delivered to onMessage');
    A.eq(inbox[0].content, 'hi', 'the raw d payload is passed through (normalize() parses it downstream)');
    // the bot's OWN message -> ignored
    ws.emit({ op: 0, t: 'MESSAGE_CREATE', s: 3, d: { id: '901', channel_id: '111', content: 'self', author: { id: 'BOTID' } } });
    A.eq(inbox.length, 1, "the bot's own message is ignored (author.id === bot id)");
    // a non-message dispatch is ignored but still advances seq
    ws.emit({ op: 0, t: 'TYPING_START', s: 4, d: {} });
    A.eq(gw._state().lastSeq, 4, 'last seq tracks every dispatch (for heartbeat/resume)');
    gw.close();
  }

  // ---- C. heartbeat: op 1 with last seq; ACK clears zombie flag; a MISSED ack -> reconnect ----
  {
    const timers = fakeTimers();
    const FakeWS = makeFakeWS();
    const gw = makeDiscordGateway({
      token: 'BOT', onMessage: () => {}, fetch: okFetch, WebSocketImpl: FakeWS, gatewayUrl: 'wss://gw.test',
      setTimeoutImpl: timers.setTimeoutImpl, clearTimeoutImpl: timers.clearTimeoutImpl, now: timers.now, random: () => 0   // no jitter -> first beat immediate
    });
    await Promise.resolve(); await Promise.resolve();
    const ws1 = FakeWS._last(); ws1.open();
    ws1.emit({ op: 10, d: { heartbeat_interval: 10000 } });
    ws1.emit({ op: 0, t: 'READY', s: 5, d: { session_id: 'sX', user: { id: 'B' } } });
    ws1.sent.length = 0;                       // clear IDENTIFY
    timers.advance(1);                          // fire the (jitter=0) first heartbeat
    const hb = ws1.sent.find(f => f.op === 1);
    A.ok(hb, 'a heartbeat (op 1) is sent');
    A.eq(hb.d, 5, 'the heartbeat carries the last seq');
    ws1.emit({ op: 11 });                       // ACK -> not a zombie
    A.eq(gw._state().awaitingAck, false, 'a heartbeat ACK clears the awaiting-ack (zombie) flag');
    // now MISS an ack: advance a full interval so the next beat fires while still awaiting -> reconnect (new socket)
    const before = FakeWS._instances.length;
    timers.advance(10000);                      // next beat -> awaitingAck true
    timers.advance(10000);                      // beat again while awaiting -> zombie -> reconnect
    await Promise.resolve(); await Promise.resolve();
    A.ok(FakeWS._instances.length > before, 'a missed heartbeat ACK triggers a reconnect (a new socket opens)');
    gw.close();
  }

  // ---- D. op 7 reconnect + op 9 invalid-session (resumable) -> RESUME with session_id + seq ----
  {
    const timers = fakeTimers();
    const FakeWS = makeFakeWS();
    const gw = makeDiscordGateway({
      token: 'BOT', onMessage: () => {}, fetch: okFetch, WebSocketImpl: FakeWS, gatewayUrl: 'wss://gw.test',
      setTimeoutImpl: timers.setTimeoutImpl, clearTimeoutImpl: timers.clearTimeoutImpl, now: timers.now, random: () => 0
    });
    await Promise.resolve(); await Promise.resolve();
    let ws = FakeWS._last(); ws.open();
    ws.emit({ op: 10, d: { heartbeat_interval: 10000 } });
    ws.emit({ op: 0, t: 'READY', s: 7, d: { session_id: 'RESUMABLE', resume_gateway_url: 'wss://resume.test', user: { id: 'B' } } });
    // server asks us to reconnect (op 7). We have a session -> next HELLO should RESUME.
    ws.emit({ op: 7 });
    timers.advance(1);
    await Promise.resolve(); await Promise.resolve();
    const ws2 = FakeWS._last();
    A.ok(ws2 !== ws, 'op 7 opens a fresh socket');
    ws2.open();
    ws2.emit({ op: 10, d: { heartbeat_interval: 10000 } });
    const resume = ws2.sent.find(f => f.op === 6);
    A.ok(resume, 'RESUME (op 6) sent on reconnect when a session exists');
    A.eq(resume.d.session_id, 'RESUMABLE', 'RESUME carries the session id');
    A.eq(resume.d.seq, 7, 'RESUME carries the last seq');
    // now op 9 invalid-session, NOT resumable -> session cleared -> next HELLO IDENTIFYs fresh
    ws2.emit({ op: 9, d: false });
    timers.advance(5000);
    await Promise.resolve(); await Promise.resolve();
    const ws3 = FakeWS._last();
    A.ok(ws3 !== ws2, 'op 9 (non-resumable) opens a fresh socket');
    ws3.open();
    ws3.emit({ op: 10, d: { heartbeat_interval: 10000 } });
    A.ok(ws3.sent.find(f => f.op === 2), 'a non-resumable invalid-session forces a fresh IDENTIFY (op 2), not RESUME');
    A.ok(!ws3.sent.find(f => f.op === 6), '...and does NOT RESUME');
    gw.close();
  }

  // ---- D2. NO RECONNECT STORM: op 9 waits 1-5s, and repeated no-READY immediates escalate to backoff ----
  // A persistently invalid session used to reconnect with delay 0 (backoffAttempt neither read nor bumped
  // on the immediate path) — a tight ws+REST loop against Discord that ends in a CloudFlare IP ban.
  {
    const timers = fakeTimers();
    const FakeWS = makeFakeWS();
    const gw = makeDiscordGateway({
      token: 'BOT', onMessage: () => {}, fetch: okFetch, WebSocketImpl: FakeWS, gatewayUrl: 'wss://gw.test',
      setTimeoutImpl: timers.setTimeoutImpl, clearTimeoutImpl: timers.clearTimeoutImpl, now: timers.now, random: () => 0
    });
    await Promise.resolve(); await Promise.resolve();
    let ws = FakeWS._last(); ws.open();
    ws.emit({ op: 10, d: { heartbeat_interval: 10000 } });
    // op 9: the reconnect must NOT fire immediately — Discord guidance is a 1-5s wait before re-identify.
    let count = FakeWS._instances.length;
    ws.emit({ op: 9, d: false });
    timers.advance(999);
    await Promise.resolve(); await Promise.resolve();
    A.eq(FakeWS._instances.length, count, 'op 9 does not reconnect inside the first second');
    timers.advance(2);
    await Promise.resolve(); await Promise.resolve();
    A.ok(FakeWS._instances.length > count, 'op 9 reconnects after the guided wait');
    // repeated op 7 with no READY in between: the first two ride free, the third pays backoff.
    for (let i = 0; i < 2; i++) {
      const w = FakeWS._last(); w.open(); w.emit({ op: 10, d: { heartbeat_interval: 10000 } });
      const n = FakeWS._instances.length;
      w.emit({ op: 7 });
      timers.advance(0);
      await Promise.resolve(); await Promise.resolve();
      A.ok(FakeWS._instances.length > n, 'immediate reconnect #' + (i + 1) + ' still fires with no delay');
    }
    const w3 = FakeWS._last(); w3.open(); w3.emit({ op: 10, d: { heartbeat_interval: 10000 } });
    const n3 = FakeWS._instances.length;
    w3.emit({ op: 7 });
    timers.advance(0);
    await Promise.resolve(); await Promise.resolve();
    A.eq(FakeWS._instances.length, n3, 'the third consecutive no-READY immediate pays a backoff instead of 0ms');
    timers.advance(120000);
    await Promise.resolve(); await Promise.resolve();
    A.ok(FakeWS._instances.length > n3, 'and still reconnects after the backoff elapses');
    // PERSISTENT op 9 escalates past the guided wait too (review pass: fixedDelayMs used to bypass both
    // backoff mechanisms — a flat 1-5s IDENTIFY loop forever, ~29k identifies/day, still a ban).
    for (let i = 0; i < 6; i++) {
      const wN = FakeWS._last(); wN.open(); wN.emit({ op: 10, d: { heartbeat_interval: 10000 } });
      wN.emit({ op: 9, d: false });
      timers.advance(10000);
      await Promise.resolve(); await Promise.resolve();
    }
    const wX = FakeWS._last(); wX.open(); wX.emit({ op: 10, d: { heartbeat_interval: 10000 } });
    const nX = FakeWS._instances.length;
    wX.emit({ op: 9, d: false });
    timers.advance(1500);
    await Promise.resolve(); await Promise.resolve();
    A.eq(FakeWS._instances.length, nX, 'a persistent invalid-session no longer retries at the flat guided wait — backoff has taken over');
    timers.advance(60000);
    await Promise.resolve(); await Promise.resolve();
    A.ok(FakeWS._instances.length > nX, 'but the reconnect still happens once the escalated backoff elapses');
    gw.close();
  }

  // ---- E. unexpected close -> backoff reconnect; a fatal close code stops for good ----
  {
    const timers = fakeTimers();
    const FakeWS = makeFakeWS();
    const states = [];
    const gw = makeDiscordGateway({
      token: 'BOT', onMessage: () => {}, onState: s => states.push(s.state),
      fetch: okFetch, WebSocketImpl: FakeWS, gatewayUrl: 'wss://gw.test',
      setTimeoutImpl: timers.setTimeoutImpl, clearTimeoutImpl: timers.clearTimeoutImpl, now: timers.now, random: () => 0.5
    });
    await Promise.resolve(); await Promise.resolve();
    let ws = FakeWS._last(); ws.open();
    ws.emit({ op: 10, d: { heartbeat_interval: 10000 } });
    ws.emit({ op: 0, t: 'READY', s: 1, d: { session_id: 's', resume_gateway_url: 'wss://r.test', user: { id: 'B' } } });
    const before = FakeWS._instances.length;
    ws.serverClose(1006);                       // abnormal close -> should schedule a backoff reconnect
    A.ok(states.indexOf('down') !== -1, 'an unexpected close reports a down state');
    timers.advance(60000);                      // let any backoff delay elapse
    await Promise.resolve(); await Promise.resolve();
    A.ok(FakeWS._instances.length > before, 'an abnormal close reconnects after a backoff');
    gw.close();

    // fatal close 4004 (auth failed) -> stops for good, reports error, no reconnect
    const timers2 = fakeTimers();
    const FakeWS2 = makeFakeWS();
    const states2 = [];
    const gw2 = makeDiscordGateway({
      token: 'BAD', onMessage: () => {}, onState: s => states2.push(s.state),
      fetch: okFetch, WebSocketImpl: FakeWS2, gatewayUrl: 'wss://gw.test',
      setTimeoutImpl: timers2.setTimeoutImpl, clearTimeoutImpl: timers2.clearTimeoutImpl, now: timers2.now, random: () => 0.5
    });
    await Promise.resolve(); await Promise.resolve();
    const wsb = FakeWS2._last(); wsb.open();
    const n = FakeWS2._instances.length;
    wsb.serverClose(4004);                       // authentication failed -> fatal
    A.ok(states2.indexOf('error') !== -1, 'a fatal close (4004) reports an error state');
    timers2.advance(60000);
    await Promise.resolve(); await Promise.resolve();
    A.eq(FakeWS2._instances.length, n, 'a fatal close does NOT reconnect (stops for good)');
    A.eq(gw2._state().closed, true, 'the gateway marks itself closed after a fatal close');
    gw2.close();
  }

  // ---- F. close() stops the client and cancels reconnects ----
  {
    const timers = fakeTimers();
    const FakeWS = makeFakeWS();
    const gw = makeDiscordGateway({
      token: 'BOT', onMessage: () => {}, fetch: okFetch, WebSocketImpl: FakeWS, gatewayUrl: 'wss://gw.test',
      setTimeoutImpl: timers.setTimeoutImpl, clearTimeoutImpl: timers.clearTimeoutImpl, now: timers.now, random: () => 0.5
    });
    await Promise.resolve(); await Promise.resolve();
    const ws = FakeWS._last(); ws.open();
    ws.emit({ op: 10, d: { heartbeat_interval: 10000 } });
    ws.emit({ op: 0, t: 'READY', s: 1, d: { session_id: 's', user: { id: 'B' } } });
    gw.close();
    A.eq(gw._state().closed, true, 'close() marks the gateway closed');
    const n = FakeWS._instances.length;
    // even if a stray close event arrives after shutdown, no reconnect happens.
    ws.serverClose(1006);
    timers.advance(60000);
    await Promise.resolve(); await Promise.resolve();
    A.eq(FakeWS._instances.length, n, 'no reconnect after close() (a late close event is a no-op)');
  }

  // ---- G. end-to-end through the transport: makeConnectGateway feeds MESSAGE_CREATE into the transport buffer ----
  {
    const { makeConnectGateway } = require('../sidecar/channels/discord.gateway.js');
    const { makeDiscordTransport } = require('../sidecar/channels/discord.transport.js');
    const timers = fakeTimers();
    const FakeWS = makeFakeWS();
    const connectGateway = makeConnectGateway({
      fetch: okFetch, WebSocketImpl: FakeWS, gatewayUrl: 'wss://gw.test',
      setTimeoutImpl: timers.setTimeoutImpl, clearTimeoutImpl: timers.clearTimeoutImpl, now: timers.now, random: () => 0.5
    });
    const transport = makeDiscordTransport({ fetch: async () => ({ ok: true, status: 200, json: async () => ({}), headers: { get: () => null } }), token: 'T', connectGateway, parkMs: 1, sleep: () => Promise.resolve() });
    transport.connect();                         // opens the gateway
    await Promise.resolve(); await Promise.resolve();
    const ws = FakeWS._last(); ws.open();
    ws.emit({ op: 10, d: { heartbeat_interval: 10000 } });
    ws.emit({ op: 0, t: 'READY', s: 1, d: { session_id: 's', user: { id: 'BOT' } } });
    ws.emit({ op: 0, t: 'MESSAGE_CREATE', s: 2, d: { id: '1', channel_id: 'c', content: 'yo', author: { id: 'U', username: 'u' } } });
    const drained = await transport.getUpdates({});
    A.eq(drained.length, 1, 'the real gateway pushes MESSAGE_CREATE into the transport buffer, drained by getUpdates');
    A.eq(drained[0].content, 'yo', 'the raw payload survives the gateway -> transport hop');
    transport.disconnect();
  }

  A.report('channels.discord-gateway');
})().catch(e => { console.error(e); process.exit(1); });
