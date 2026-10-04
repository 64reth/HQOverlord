/* node test/hooks.test.js — THE HOOK SPINE.

   StarNet had no extension point of this kind at all: skills add instructions, MCP adds tools, routines add a
   schedule, and nothing let a Commander say "whenever the agent edits a file, run prettier" or "never let it
   run that command". These assertions pin the contract every hook — shell script or JS plugin — rides on.

   The load-bearing one is the LAW: a hook may DENY, never GRANT. If that ever inverts, one user script becomes
   a privilege escalation and the consent model is decoration. */
'use strict';
const A = require('./_assert.js');
const { makeHooks, EVENTS, _internals } = require('../sidecar/hooks.js');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  // ---- 1. THE COMMON CASE IS FREE: nothing registered, nothing runs, nothing blocks ----
  {
    const h = makeHooks();
    const r = await h.invoke('pre_tool_call', { tool_name: 'shell_exec' });
    A.eq(r, { blocked: false, reason: '', context: '', ran: 0 }, 'no handlers -> a zero-cost, non-blocking no-op');
    A.eq(h.count('pre_tool_call'), 0, 'nothing registered');
  }

  // ---- 2. THE EVENT NAMES ARE THE REFERENCE HARNESS'S, VERBATIM — a ported script must fire ----
  {
    for (const e of ['pre_tool_call', 'post_tool_call', 'pre_llm_call', 'post_llm_call', 'on_session_start', 'on_session_end', 'subagent_stop', 'on_pre_compress', 'on_memory_write']) {
      A.ok(EVENTS.indexOf(e) >= 0, 'event exists under its reference name: ' + e);
    }
    let threw = false;
    try { makeHooks().register('on_whatever', () => {}); } catch (_) { threw = true; }
    A.ok(threw, 'an unknown event is a registration error, not a handler that silently never fires');
  }

  // ---- 3. BOTH DECISION SHAPES ARE ACCEPTED, so a script written for either harness works unchanged ----
  {
    const h = makeHooks();
    h.register('pre_tool_call', () => ({ decision: 'block', reason: 'claude-code style' }), { name: 'a' });
    A.eq((await h.invoke('pre_tool_call', {})).reason, 'claude-code style', '{decision, reason} blocks');

    const h2 = makeHooks();
    h2.register('pre_tool_call', () => ({ action: 'block', message: 'canonical style' }), { name: 'b' });
    A.eq((await h2.invoke('pre_tool_call', {})).reason, 'canonical style', '{action, message} blocks');

    A.eq(_internals.readDecision({ decision: 'allow' }), null, 'an explicit allow is NOT a block');
    A.eq(_internals.readDecision({}), null, 'a silent handler is not a block');
    A.eq(_internals.readDecision(null), null, 'a handler that returned nothing is not a block');
  }

  // ---- 4. BLOCK WINS, and the reason names the handler that actually stopped it ----
  {
    const h = makeHooks();
    const order = [];
    h.register('pre_tool_call', () => { order.push('one'); }, { name: 'one' });
    h.register('pre_tool_call', () => { order.push('two'); return { decision: 'block', reason: 'no rm -rf' }; }, { name: 'two' });
    h.register('pre_tool_call', () => { order.push('three'); return { decision: 'block', reason: 'a later objection' }; }, { name: 'three' });
    const r = await h.invoke('pre_tool_call', { tool_name: 'shell_exec' });
    A.eq(r.blocked, true, 'one blocking handler blocks the call');
    A.eq(r.reason, 'no rm -rf', 'the FIRST block owns the reason');
    A.eq(r.by, 'two', 'and the handler that stopped it is named');
    A.eq(order.join(','), 'one,two,three', 'every handler still runs — order is registration order, and it is deterministic');
    A.eq(r.ran, 3, 'the run count is honest');
  }

  // ---- 5. THE LAW: A HOOK MAY DENY, NEVER GRANT ----
  {
    // post_* and observe-only events cannot block, no matter what they return. A hook that could veto a
    // finished tool result would be rewriting history; one that could approve would be an escalation.
    for (const e of ['post_tool_call', 'post_llm_call', 'on_session_start', 'on_session_end', 'subagent_stop', 'on_pre_compress', 'on_memory_write']) {
      const h = makeHooks();
      h.register(e, () => ({ decision: 'block', reason: 'try me' }), { name: 'x' });
      A.eq((await h.invoke(e, {})).blocked, false, e + ' can never block — it is observe-only');
    }
    // And nothing a hook returns is an approval: there is no allow/grant/approve channel out of invoke().
    const h = makeHooks();
    h.register('pre_tool_call', () => ({ decision: 'allow', approve: true, grant: 'workbench', consent: true }), { name: 'y' });
    const r = await h.invoke('pre_tool_call', {});
    A.eq(r.blocked, false, 'an allow-shaped return is simply not a block');
    A.eq(Object.prototype.hasOwnProperty.call(r, 'allowed') || Object.prototype.hasOwnProperty.call(r, 'grant'), false,
      'invoke() has NO grant channel at all — a hook cannot widen authority even by trying');
  }

  // ---- 6. CONTEXT CONCATENATES in order, and is bounded ----
  {
    const h = makeHooks();
    h.register('pre_llm_call', () => ({ context: 'on-call: alice' }), { name: 'a' });
    h.register('pre_llm_call', () => ({ context: 'deploy freeze until friday' }), { name: 'b' });
    const r = await h.invoke('pre_llm_call', {});
    A.eq(r.context, 'on-call: alice\n\ndeploy freeze until friday', 'contexts compose in registration order');

    const big = makeHooks();
    big.register('pre_llm_call', () => ({ context: 'z'.repeat(50000) }), { name: 'flood' });
    A.ok((await big.invoke('pre_llm_call', {})).context.length <= 8000, 'a runaway hook cannot own the context window');
  }

  // ---- 7. A BROKEN HOOK IS THE COMMANDER'S CODE AND IT WILL BE BROKEN SOMETIMES — never fatal ----
  {
    const errs = [];
    const h = makeHooks({ onError: (e) => errs.push(e) });
    h.register('pre_tool_call', () => { throw new Error('boom'); }, { name: 'thrower' });
    h.register('pre_tool_call', () => ({ context: 'still ran' }), { name: 'after' });
    const r = await h.invoke('pre_tool_call', {});
    A.eq(r.blocked, false, 'a throwing hook does NOT block — fail-open is deliberate; a hook that wants to deny must say so');
    A.eq(r.context, 'still ran', 'the handlers after it still run');
    A.eq(errs.length, 1, 'the failure is reported, not swallowed silently');
    A.eq(errs[0].hook, 'thrower', 'and it names the hook that broke');
  }

  // ---- 8. A WEDGED HOOK CANNOT HANG THE RUN IT IS OBSERVING ----
  {
    const errs = [];
    const h = makeHooks({ timeoutMs: 40, onError: (e) => errs.push(e) });
    h.register('pre_tool_call', async () => { await sleep(400); return { decision: 'block', reason: 'too late' }; }, { name: 'slow' });
    const t0 = Date.now();
    const r = await h.invoke('pre_tool_call', {});
    A.ok(Date.now() - t0 < 250, 'the hook is abandoned at its timeout rather than awaited forever');
    A.eq(r.blocked, false, 'a decision that arrives after the timeout is discarded, not applied out of order');
    A.ok(/timeout/.test(errs[0].error), 'the timeout is reported');
  }

  // ---- 9. THE PAYLOAD CARRIES ITS OWN EVENT NAME (the wire contract a shell script reads off stdin) ----
  {
    const h = makeHooks();
    let seen = null;
    h.register('pre_tool_call', (p) => { seen = p; }, { name: 'spy' });
    await h.invoke('pre_tool_call', { tool_name: 'fs_write', tool_input: { path: 'a.js' }, session_id: 's1' });
    A.eq(seen.hook_event_name, 'pre_tool_call', 'hook_event_name is stamped by the spine, not by each call site');
    A.eq(seen.tool_name, 'fs_write', 'the call site payload passes through');
    A.eq(seen.tool_input.path, 'a.js', 'nested input survives');
  }

  // ---- 10. unregister actually detaches ----
  {
    const h = makeHooks();
    let hits = 0;
    const off = h.register('post_tool_call', () => { hits++; }, { name: 'temp' });
    await h.invoke('post_tool_call', {});
    off();
    await h.invoke('post_tool_call', {});
    A.eq(hits, 1, 'an unregistered handler stops firing');
    A.eq(h.count('post_tool_call'), 0, 'and is gone from the registry');
  }

  // ---- 11. clear() rebuilds IN PLACE — the reload path depends on it ----
  {
    // The spine is captured by reference at boot (dispatch ctx, in-flight runs), so approving a new hook has
    // to rebuild THIS object. Handing out a fresh one would leave those holders on the old spine and the
    // reload would silently do nothing — and clearing first is what stops a double-register.
    const h = makeHooks();
    let hits = 0;
    const add = () => h.register('pre_tool_call', () => { hits++; }, { name: 'x' });
    add();
    await h.invoke('pre_tool_call', {});
    A.eq(hits, 1, 'one handler, one hit');

    h.clear();
    A.eq(h.count('pre_tool_call'), 0, 'clear() detaches everything');
    add(); add();
    hits = 0;
    await h.invoke('pre_tool_call', {});
    A.eq(hits, 2, 'a rebuilt spine runs exactly what was re-registered — no ghosts from before the clear');

    h.clear('pre_tool_call');
    h.register('post_tool_call', () => {}, { name: 'other' });
    h.clear('pre_tool_call');
    A.eq(h.count('post_tool_call'), 1, 'clearing one event leaves the others alone');
  }

  A.report('hooks.test');
})().catch(e => { console.log('FAIL: hooks.test threw -- ' + (e && e.stack || e)); process.exit(1); });
