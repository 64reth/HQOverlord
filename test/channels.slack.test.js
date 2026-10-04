/* node test/channels.slack.test.js — the Slack channel: Socket Mode transport (envelope ack + buffer drain +
   chat.postMessage) and binding (normalize + token split + owner gate through the generic adapter). No real
   network — injected fake fetch + fake WebSocketImpl. */
'use strict';
const A = require('./_assert.js');
const { makeSlackTransport } = require('../sidecar/channels/slack.transport.js');
const { makeSlackAdapter, normalize, parseSlackTokens, MAX_MESSAGE_LENGTH } = require('../sidecar/channels/slack.js');

const tick = () => new Promise(r => setTimeout(r, 0));
const jres = (status, body, headers) => ({ ok: status >= 200 && status < 300, status, async json() { return body; }, headers: { get: (k) => (headers && headers[k]) || null } });

// a fake Socket Mode WebSocket: records sends, lets the test push server frames via .emit(data).
class FakeWS {
  constructor(url) { this.url = url; this.sent = []; this.closed = false; FakeWS.last = this; }
  send(s) { this.sent.push(s); }
  close() { this.closed = true; if (this.onclose) this.onclose({}); }
  emit(obj) { if (this.onmessage) this.onmessage({ data: JSON.stringify(obj) }); }
}

(async () => {
  // ---- A. token split + normalize ----
  {
    A.eq(parseSlackTokens('xoxb-111 xapp-222'), { botToken: 'xoxb-111', appToken: 'xapp-222' }, 'combined secret splits by prefix');
    A.eq(parseSlackTokens('xapp-222,\nxoxb-111'), { botToken: 'xoxb-111', appToken: 'xapp-222' }, 'order/separator independent');
    A.eq(parseSlackTokens('xoxb-only'), { botToken: 'xoxb-only', appToken: '' }, 'a missing half comes back empty (host validates)');

    const ev = (over) => Object.assign({ type: 'message', channel: 'D123', channel_type: 'im', user: 'U1', text: 'hi', ts: '1.2' }, over);
    A.eq(normalize(ev({})).message, { chatId: 'D123', chatType: 'dm', userId: 'U1', userName: 'U1', text: 'hi', messageId: '1.2' }, 'an IM normalizes to a dm InboundMessage');
    A.eq(normalize(ev({ channel_type: 'channel', channel: 'C9' })).message.chatType, 'group', 'a channel message is group (allowlist-gated)');
    A.eq(normalize(ev({ bot_id: 'B1' })), null, 'a bot message (incl. our own echo) delivers nothing');
    A.eq(normalize(ev({ subtype: 'message_changed' })), null, 'an edited/system message delivers nothing');
    A.eq(normalize({ type: 'reaction_added' }), null, 'a non-message event delivers nothing');
    A.eq(MAX_MESSAGE_LENGTH, 4000, 'declared chunking limit');
  }

  // ---- B. transport: socket opens lazily, envelopes are ACKed + buffered, disconnect frame refreshes ----
  {
    const calls = [];
    const fakeFetch = async (url, opts) => {
      calls.push({ url, method: opts && opts.method, headers: (opts && opts.headers) || {}, body: opts && opts.body });
      if (/apps\.connections\.open$/.test(url)) return jres(200, { ok: true, url: 'wss://slack.test/socket' });
      if (/chat\.postMessage$/.test(url)) return jres(200, { ok: true, ts: '99.1' });
      return jres(404, { ok: false, error: 'unknown_method' });
    };
    const t = makeSlackTransport({ fetch: fakeFetch, botToken: 'xoxb-1', appToken: 'xapp-2', WebSocketImpl: FakeWS, parkMs: 1 });
    const first = await t.getUpdates({});
    A.eq(first, [], 'first poll opens the socket (nothing buffered yet)');
    A.ok(FakeWS.last && FakeWS.last.url === 'wss://slack.test/socket', 'socket opened at the URL apps.connections.open returned');
    const open = calls.find(c => /connections\.open/.test(c.url));
    A.ok(/xapp-2/.test(open.headers.Authorization), 'connections.open uses the app-level token');

    FakeWS.last.emit({ type: 'hello' });
    FakeWS.last.emit({ envelope_id: 'env1', type: 'events_api', payload: { event: { type: 'message', channel: 'D1', channel_type: 'im', user: 'U1', text: 'yo', ts: '5.5' } } });
    const ups = await t.getUpdates({});
    A.eq(ups.length, 1, 'the envelope\'s event was buffered and drained');
    A.eq(ups[0].text, 'yo', 'raw event passes through untouched');
    A.eq(FakeWS.last.sent, [JSON.stringify({ envelope_id: 'env1' })], 'every envelope is ACKed by envelope_id');

    const sock = FakeWS.last;
    sock.emit({ type: 'disconnect', reason: 'refresh_requested' });
    A.ok(sock.closed, 'a disconnect frame closes the socket');
    await t.getUpdates({});
    A.ok(FakeWS.last !== sock, 'the next poll lazily reopened a fresh socket');

    const sr = await t.send('D1', 'hello', {});
    A.eq(sr, { ok: true, messageId: '99.1' }, 'send returns the message ts');
    const post = calls[calls.length - 1];
    A.ok(/xoxb-1/.test(post.headers.Authorization), 'chat.postMessage uses the bot token');
    A.eq(JSON.parse(post.body), { channel: 'D1', text: 'hello' }, 'send body carries channel + text');
    t.disconnect();
  }

  // ---- C. transport error classes: fatal auth on open, ratelimited send retryable ----
  {
    const tBad = makeSlackTransport({ fetch: async (url) => /connections\.open/.test(url) ? jres(200, { ok: false, error: 'invalid_auth' }) : jres(200, { ok: true }), botToken: 'xoxb-1', appToken: 'xapp-bad', WebSocketImpl: FakeWS, parkMs: 1 });
    let err = null; try { await tBad.getUpdates({}); } catch (e) { err = e; }
    A.ok(err && err.fatal === true, 'invalid_auth on connections.open is FATAL (stop polling for good)');

    const t429 = makeSlackTransport({ fetch: async (url) => /postMessage/.test(url) ? jres(429, { ok: false, error: 'ratelimited' }, { 'retry-after': '7' }) : jres(200, { ok: true, url: 'wss://x' }), botToken: 'xoxb-1', appToken: 'xapp-2', WebSocketImpl: FakeWS, parkMs: 1 });
    const r = await t429.send('D1', 'x', {});
    A.eq(r.ok, false, '429 send fails'); A.eq(r.retryable, true, '429 send is retryable'); A.eq(r.retryAfter, 7, 'Retry-After surfaces for the bounded wait');

    const tNet = makeSlackTransport({ fetch: async (url) => { if (/postMessage/.test(url)) throw new Error('ECONNRESET'); return jres(200, { ok: true, url: 'wss://x' }); }, botToken: 'xoxb-1', appToken: 'xapp-2', WebSocketImpl: FakeWS, parkMs: 1 });
    const rn = await tNet.send('D1', 'x', {});
    A.eq(rn.ok, false, 'network send failure is normalized (never throws)');
    A.eq(rn.retryable, true, 'network send failure is retryable');
  }

  // ---- C2. reconnect truth: a DROPPED socket whose reopen fails must NOT poll as "up" ----
  {
    let openOk = true;   // flip to simulate apps.connections.open failing transiently after the drop
    const fakeFetch = async (url) => {
      if (/connections\.open/.test(url)) return openOk ? jres(200, { ok: true, url: 'wss://slack.test/socket' }) : jres(500, { ok: false });
      return jres(200, { ok: true });
    };
    const t = makeSlackTransport({ fetch: fakeFetch, botToken: 'xoxb-1', appToken: 'xapp-2', WebSocketImpl: FakeWS, parkMs: 1 });
    A.eq(await t.getUpdates({}), [], 'first poll opens the socket');
    const sock = FakeWS.last;

    // buffer an event, then kill the socket AND make reopen fail — the buffered event must still drain…
    sock.emit({ envelope_id: 'e1', type: 'events_api', payload: { event: { type: 'message', channel: 'D1', channel_type: 'im', user: 'U1', text: 'buffered', ts: '1.1' } } });
    sock.close();
    openOk = false;
    const drained = await t.getUpdates({});
    A.eq(drained.length, 1, 'events buffered before the drop still drain (never stranded)');
    A.eq(drained[0].text, 'buffered', 'the buffered event passes through');

    // …but the NEXT empty poll with no live socket must throw a TRANSIENT error, not "succeed" as [].
    let err = null; try { await t.getUpdates({}); } catch (e) { err = e; }
    A.ok(err, 'a dead socket + failed reopen surfaces an error (adapter reports down, not CONNECTED)');
    A.ok(err && !err.fatal, 'the lost-socket error is transient (backoff + retry, never kill the channel)');

    // reopen recovers: once connections.open works again, the poll succeeds and events flow.
    openOk = true;
    A.eq(await t.getUpdates({}), [], 'a later poll reopens the socket and succeeds again');
    A.ok(FakeWS.last !== sock, 'a fresh socket was opened');
    FakeWS.last.emit({ envelope_id: 'e2', type: 'events_api', payload: { event: { type: 'message', channel: 'D1', channel_type: 'im', user: 'U1', text: 'after', ts: '2.2' } } });
    A.eq((await t.getUpdates({}))[0].text, 'after', 'events flow again after the reconnect');
    t.disconnect();
  }

  // ---- D. binding end-to-end: adapter + fake transport honors normalize + owner trust-on-first-use ----
  {
    const seq = [[
      { type: 'message', channel: 'D9', channel_type: 'im', user: 'STRANGER', text: 'steal it', ts: '1.1' },
      { type: 'message', channel: 'D1', channel_type: 'im', user: 'OWNER', text: 'owner msg', ts: '1.2' }
    ]];
    const inbound = [];
    const transport = {
      getUpdates: async () => seq.length ? seq.shift() : (await new Promise(r => setTimeout(() => r([]), 1))),
      send: async () => ({ ok: true })
    };
    const ad = makeSlackAdapter({ transport, clock: { now: () => 3 }, ownerUserId: 'OWNER', onInbound: m => inbound.push(m), sleep: () => Promise.resolve() });
    A.eq(ad.name, 'slack', 'adapter carries the channel name');
    A.eq(ad.MAX_MESSAGE_LENGTH, 4000, 'adapter declares the slack limit');
    await ad.connect();
    for (let i = 0; i < 20 && inbound.length < 1; i++) await tick();
    await ad.disconnect();
    A.eq(inbound.length, 1, 'preset owner: the stranger\'s DM never reached onInbound');
    A.eq(inbound[0].text, 'owner msg', 'the owner\'s message flowed through');
    A.eq(inbound[0].channel, 'slack', 'inbound is stamped with the channel');
  }

  A.report('channels.slack.test');
})().catch(e => { console.error(e); process.exit(1); });
