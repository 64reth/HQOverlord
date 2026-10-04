/* node test/browser.wait-recovery.test.js — CONDITIONAL WAITING and STALE-REF RECOVERY.

   The two things that decide whether agent browsing is reliable rather than merely capable:

   1. browser.wait. Every other browser action already auto-settles ("has the page stopped changing"),
      but settling cannot answer "has the thing I am waiting for happened". Without a conditional wait an
      agent's only options are a re-snapshot loop or a guessed sleep, and the guessed sleep is the flake.
      A timeout here is a FINDING, not a tool failure — the agent has to be able to branch on it.

   2. Stale-ref recovery. Refs expire on every snapshot, so an agent holding refs mid-task loses all of
      them the moment anything re-snapshots — over a page that did not change. Recovery re-finds the same
      element by identity. Because that makes a MUTATING action land on a node the agent did not name, it
      is fenced by three rules, and this file exists mostly to hold those three rules in place:
        · never across a navigation or a tab switch (a different document),
        · never when the identity is ambiguous (which "Delete" did you mean?),
        · never silently — the answer always says it recovered. */
'use strict';
const A = require('./_assert.js');
const { makeBrowserTools, _internals: T } = require('../sidecar/tools/builtin/browser.js');

async function rejects(p, re, msg) {
  try { await p; A.ok(false, msg + ' — did not reject'); }
  catch (e) { A.ok(re.test((e && e.message) || String(e)), msg + ' (got: ' + ((e && e.message) || e) + ')'); }
}

/* A driver whose page CONTENT is swappable, so a test can make an element appear, vanish or duplicate
   between snapshots — which is the whole point of both features under test. */
function fakeDriver(opts) {
  opts = opts || {};
  const log = { clicked: [], waited: [], dragged: [] };
  let nodes = opts.nodes || [
    { role: 'button', text: 'Search', x: 10, y: 20, w: 80, h: 30 },
    { role: 'textbox', text: 'Query', x: 10, y: 60, w: 200, h: 24 }
  ];
  const d = {
    log,
    setNodes: n => { nodes = n; },
    navigate: async url => url,
    snapshot: async () => nodes.map(n => Object.assign({}, n)),
    click: async node => { log.clicked.push(node.text + '@' + node.x + ',' + node.y); return 'clicked ' + node.text; },
    type: async (node, text) => 'typed ' + text,
    hover: async node => 'hovered ' + node.text,
    drag: async (a, b) => { log.dragged.push([a.text, b.text]); return 'dragged'; },
    selectOption: async (node, v) => ({ ok: true, value: v, label: String(v).toUpperCase() }),
    inspect: async node => ({ ok: true, tag: 'button', text: node.text, box: { x: node.x, y: node.y, w: node.w, h: node.h }, styles: {}, attrs: {}, data: {} }),
    viewport: async (w, h) => w + 'x' + h,
    back: async () => 'about:blank',
    forward: async () => 'about:blank',
    tabs: async () => [{ index: 0, url: 'https://example.com', title: 'x', active: true }, { index: 1, url: 'https://other.com', title: 'y', active: false }],
    selectTab: async () => 'https://other.com',
    closeTab: async () => 'closed',
    scroll: async () => 'scrolled',
    press: async k => 'pressed ' + k,
    getText: async () => 'page text',
    // waitFor is driven by a script so the test controls hit/miss deterministically — no clock, no sleep.
    waitFor: async (cond, budgetMs) => {
      log.waited.push({ cond, budgetMs });
      if (opts.waitResult) return opts.waitResult;
      return { ok: true, hit: true, ms: 120, url: 'https://example.com' };
    },
    close: () => {},
    consoleLog: () => [], networkLog: () => [], lastDialog: () => null, lastResponse: () => null,
    visible: () => false, headed: false, attachedPort: () => null, usingPersistentProfile: () => false
  };
  return d;
}

(async () => {
  // ---- 1. browser.wait REPORTS A MET CONDITION, and passes the condition through untouched ----
  {
    const d = fakeDriver();
    const B = makeBrowserTools({ driver: d });
    const wait = B.tools.find(t => t.name === 'browser.wait');
    A.eq(wait.scope, 'read', 'waiting changes nothing, so it is read scope');
    A.eq(wait.requiresConsent, false, 'and costs no consent prompt — a gated wait is a wait the agent skips');

    const r = await wait.run({ selector: '#results', timeoutMs: 5000 }, {});
    A.ok(/Condition met/.test(r.content), 'a met condition is reported as met');
    A.eq(d.log.waited[0].cond.selector, '#results', 'the selector reaches the driver');
    A.eq(d.log.waited[0].budgetMs, 5000, 'and so does the caller budget');
    A.eq(d.log.waited[0].cond.gone, false, 'gone defaults to false — waiting for a thing to APPEAR');
  }

  // ---- 2. A TIMEOUT IS AN HONEST FINDING, NOT A SUCCESS AND NOT A CRASH ----
  {
    const d = fakeDriver({ waitResult: { ok: true, hit: false, ms: 10000, timedOut: true, url: 'https://example.com' } });
    const wait = makeBrowserTools({ driver: d }).tools.find(t => t.name === 'browser.wait');
    const r = await wait.run({ text: 'Order complete' }, {});
    A.ok(/TIMED OUT/.test(r.content), 'a timeout says so LOUDLY — the agent must be able to branch on it');
    A.ok(/never appeared/.test(r.content), 'and says what did not happen, in plain words');
    A.eq(/Condition met/.test(r.content), false, 'it must never read as success');
    A.eq(r.summary, 'timed out', 'the summary carries it too, for the run log');
  }

  // ---- 3. A BAD SELECTOR IS REPORTED IMMEDIATELY, not as a timeout ----
  {
    // Burning the whole budget and then saying "timed out" would teach the agent the element is absent,
    // when in fact the question was malformed. Different diagnosis, different next move.
    const d = fakeDriver({ waitResult: { ok: false, hit: false, ms: 0, error: "'#((' is not a valid selector" } });
    const wait = makeBrowserTools({ driver: d }).tools.find(t => t.name === 'browser.wait');
    const r = await wait.run({ selector: '#((' }, {});
    A.ok(/could not be evaluated/.test(r.content), 'a thrown predicate is reported as a bad question');
    A.eq(/TIMED OUT/.test(r.content), false, 'and is NOT disguised as absence');
  }

  // ---- 4. wait needs an actual condition ----
  {
    const real = T.makeBrowserSession({ driver: fakeDriver() });
    await rejects(Promise.resolve().then(() => {
      const dd = fakeDriver();
      delete dd.waitFor;
      return T.makeBrowserSession({ driver: dd }).wait({ selector: 'a' });
    }), /unavailable in this driver/, 'a driver without waitFor says so rather than failing obscurely');
    A.ok(real, 'session builds');
  }

  // ---- 5. RECOVERY: a re-snapshot no longer destroys the agent's refs ----
  {
    const d = fakeDriver();
    const S = T.makeBrowserSession({ driver: d });
    const snap = await S.snapshot();
    const btn = snap.find(n => n.text === 'Search');
    await S.snapshot();                                   // anything re-snapshots -> every ref goes stale
    const out = await S.click(btn.ref);
    A.ok(/clicked Search/.test(out), 'the click still lands on the right element');
    A.ok(/had gone stale/.test(out), 'and the recovery is disclosed in the answer');
  }

  // ---- 6. RECOVERY USES FRESH COORDINATES, never the remembered ones ----
  {
    // This is the safety property the old "always reject" contract was protecting. Recovery keeps it:
    // it re-snapshots and takes the NEW node, so a reflowed page is clicked where the element now IS.
    const d = fakeDriver();
    const S = T.makeBrowserSession({ driver: d });
    const snap = await S.snapshot();
    const btn = snap.find(n => n.text === 'Search');
    d.setNodes([{ role: 'button', text: 'Search', x: 500, y: 900, w: 80, h: 30 }]);   // page reflowed
    await S.snapshot();
    await S.click(btn.ref);
    A.eq(d.log.clicked.pop(), 'Search@500,900', 'the click used the REFLOWED position (500,900), not the remembered one (10,20)');
  }

  // ---- 7. GUARD: recovery REFUSES across a navigation ----
  {
    const d = fakeDriver();
    const S = T.makeBrowserSession({ driver: d, lookup: null });
    const snap = await S.snapshot();
    const btn = snap.find(n => n.text === 'Search');
    await S.navigate('https://example.com/other');
    // Same role+text could exist on the new page and would be a COMPLETELY different control.
    await rejects(S.click(btn.ref), /navigated since that snapshot/, 'a ref never survives a navigation');
  }

  // ---- 8. GUARD: recovery REFUSES across a tab switch ----
  {
    const d = fakeDriver();
    const S = T.makeBrowserSession({ driver: d });
    const snap = await S.snapshot();
    const btn = snap.find(n => n.text === 'Search');
    await S.selectTab(1);
    await rejects(S.click(btn.ref), /navigated since that snapshot/, 'another tab is another document — no recovery');
  }

  // ---- 9. GUARD: AMBIGUITY FAILS LOUDLY rather than guessing ----
  {
    const d = fakeDriver();
    const S = T.makeBrowserSession({ driver: d });
    const snap = await S.snapshot();
    const btn = snap.find(n => n.text === 'Search');
    // Two identical controls now match. Picking either one is a coin flip on a MUTATING action.
    d.setNodes([
      { role: 'button', text: 'Search', x: 10, y: 20, w: 80, h: 30 },
      { role: 'button', text: 'Search', x: 10, y: 400, w: 80, h: 30 }
    ]);
    await S.snapshot();
    await rejects(S.click(btn.ref), /ambiguous/, 'two matching elements refuse rather than guess');
    A.eq(d.log.clicked.length, 0, 'and nothing was clicked while it was ambiguous');
  }

  // ---- 10. GUARD: an element that is GONE says so, in terms of what it was ----
  {
    const d = fakeDriver();
    const S = T.makeBrowserSession({ driver: d });
    const snap = await S.snapshot();
    const btn = snap.find(n => n.text === 'Search');
    d.setNodes([{ role: 'textbox', text: 'Query', x: 10, y: 60, w: 200, h: 24 }]);
    await S.snapshot();
    await rejects(S.click(btn.ref), /no longer on the page/, 'a vanished element is named, not "unknown ref"');
  }

  // ---- 11. GUARD: an UNKNOWN ref is still an unknown ref ----
  {
    const S = T.makeBrowserSession({ driver: fakeDriver() });
    await S.snapshot();
    await rejects(S.click('b9999'), /unknown browser ref/, 'a ref never minted here has nothing to recover');
  }

  // ---- 12. A TWO-REF DRAG recovers BOTH ends against ONE re-snapshot ----
  {
    /* The bug this pins: recovering the refs one at a time re-snapshots per ref, and each snapshot
       invalidates the ref resolved by the previous pass — so a two-ref call could never recover. */
    const d = fakeDriver();
    const S = T.makeBrowserSession({ driver: d });
    const snap = await S.snapshot();
    const [btn, box] = [snap.find(n => n.text === 'Search'), snap.find(n => n.text === 'Query')];
    await S.snapshot();
    const out = await S.drag(btn.ref, box.ref);
    A.eq(d.log.dragged.pop(), ['Search', 'Query'], 'both endpoints survived recovery together');
    A.ok(/had gone stale/.test(out), 'and the pair recovery is disclosed too');
  }

  /* ---- 13. browser.find — the answer to a page bigger than the snapshot cap.
       browser.snapshot lists the first 80 interactive elements. On a dense page the element the agent
       wants may not be in that list at all, and a zero-hit answer that cannot distinguish "not on this
       page" from "past the cap" sends it scrolling and re-snapshotting blind. ---- */
  {
    const many = [];
    for (let i = 0; i < 140; i++) many.push({ role: 'link', text: 'Item ' + i, x: 0, y: i * 10, w: 50, h: 10 });
    many.push({ role: 'button', text: 'Checkout now', x: 0, y: 2000, w: 90, h: 20 });
    const d = fakeDriver({ nodes: many });
    const B = makeBrowserTools({ driver: d });
    const find = B.tools.find(t => t.name === 'browser.find');
    A.eq(find.scope, 'read', 'finding is a read');
    A.eq(find.requiresConsent, false, 'and costs no consent prompt');

    // The target sits at index 140 — well past browser.snapshot's default cap of 80.
    const r = await find.run({ text: 'Checkout' }, {});
    A.ok(/Checkout now/.test(r.content), 'an element PAST the snapshot cap is still found');
    A.ok(/\[button\]/.test(r.content), 'and comes back with its role');
    A.ok(/b\d+/.test(r.content), 'and a usable ref');
    A.ok(/1 match/.test(r.summary), 'the summary counts the matches');

    const byRole = await find.run({ role: 'button' }, {});
    A.ok(/Checkout now/.test(byRole.content), 'role alone is a valid query');
    const both = await find.run({ text: 'Item 1', role: 'link', limit: 3 }, {});
    A.eq((both.content.match(/\[link\]/g) || []).length, 3, 'limit is honoured');
  }

  // ---- 14. A ZERO-HIT ANSWER STAYS INSIDE WHAT THE VIEWPORT SCAN CAN PROVE ----
  {
    const small = [{ role: 'button', text: 'Search', x: 1, y: 1, w: 10, h: 10 }];
    const B1 = makeBrowserTools({ driver: fakeDriver({ nodes: small }) });
    const r1 = await B1.tools.find(t => t.name === 'browser.find').run({ text: 'Checkout' }, {});
    A.ok(/current viewport/.test(r1.content), 'an uncapped zero reports only the viewport it actually scanned');
    A.eq(/genuinely not there|whole page/.test(r1.content), false, 'and never upgrades a visible scan into whole-page absence');
    A.ok(/off-screen/.test(r1.content) && /scroll/.test(r1.content), 'it preserves the correct below-fold next move');

    const huge = [];
    for (let i = 0; i < 240; i++) huge.push({ role: 'link', text: 'Row ' + i, x: 0, y: i, w: 10, h: 10 });
    const B2 = makeBrowserTools({ driver: fakeDriver({ nodes: huge }) });
    const r2 = await B2.tools.find(t => t.name === 'browser.find').run({ text: 'Checkout' }, {});
    A.ok(/scan cap/.test(r2.content), 'a CAPPED visible scan admits it was capped rather than claiming absence');
    A.ok(/scroll/i.test(r2.content), 'and says what to do about it');
  }

  // ---- 15. find needs something to match on ----
  {
    const S = T.makeBrowserSession({ driver: fakeDriver() });
    await rejects(S.find({}), /needs text or role/, 'an empty query is refused rather than dumping the page');
  }

  A.report('browser.wait-recovery.test');
})().catch(e => { console.log('FAIL: browser.wait-recovery.test threw -- ' + (e && e.stack || e)); process.exit(1); });
