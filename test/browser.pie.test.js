/* node test/browser.pie.test.js — browser.pdf / browser.intercept / browser.emulate.

   Three specialist moves on the station browser:
     · pdf       — render the CURRENT document into the agent's jailed workspace (whole page, kind:'file').
     · intercept — block heavy resource types (Fetch.enable patterns) for cheap text-first browsing.
     · emulate   — device/UA/locale/timezone overrides for responsive and localization checks.

   The lines these assertions hold:
     · a PDF lands in the SAME jail as screenshots, content-addressed, and emits a deliverable — or the
       tool says plainly that there was no workspace / the render failed; it never fabricates a file.
     · intercept/emulate are REFUSED while attached to the Commander's own Chrome (ownership: their real
       browser is not the station's to reconfigure); pdf still works there (it is a read).
     · a Fetch.requestPaused reply goes to the SESSION THE EVENT CAME FROM — answering on the active
       session would leave a background tab's paused request hanging and wedge its load.
     · an unknown intercept kind fails loudly on ANY driver; it is never silently dropped. */
'use strict';
const A = require('./_assert.js');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { makeBrowserTools, _internals: T } = require('../sidecar/tools/builtin/browser.js');

async function rejects(p, re, msg) {
  try { await p; A.ok(false, msg + ' — did not reject'); }
  catch (e) { A.ok(re.test((e && e.message) || String(e)), msg + ' (got: ' + ((e && e.message) || e) + ')'); }
}

// enough of a driver for the session/tool layer; individual tests override the fns they observe.
function fakeDriver(over) {
  return Object.assign({
    navigate: async u => u,
    snapshot: async () => [{ role: 'button', text: 'Go', x: 1, y: 2, w: 10, h: 10 }],
    click: async () => 'clicked', type: async () => 'typed', press: async k => k,
    scroll: async () => 'scrolled', back: async () => '', forward: async () => '',
    getText: async () => 'text', tabs: async () => [], selectTab: async () => '', closeTab: async () => '',
    consoleLog: () => [], networkLog: () => [], handleDialog: async () => ({}),
    screenshot: async () => '', evalPublic: async () => ({ ok: true, value: 1 }),
    usingPersistentProfile: () => false, close: () => {}
  }, over || {});
}

// base64 of "%PDF-1.4\n% fake": what a real Page.printToPDF hands back, in miniature.
const PDF_B64 = Buffer.from('%PDF-1.4\n% fake').toString('base64');

(async () => {
  // The CDP client unrefs its timeout timers, so a mid-await drain would exit 0 with nothing verified
  // (see the guard in _assert.js). A ref'd interval holds the loop open for the duration.
  const hold = setInterval(() => {}, 1000);

  // ---- 1. THE SURFACE CONTRACT — names, scopes, consent ----
  {
    const B = makeBrowserTools({ driver: fakeDriver() });
    const pdf = B.tools.find(t => t.name === 'browser.pdf');
    const icp = B.tools.find(t => t.name === 'browser.intercept');
    const emu = B.tools.find(t => t.name === 'browser.emulate');
    A.ok(pdf && icp && emu, 'all three tools are registered');
    A.eq(pdf.scope, 'read', 'pdf is a READ — it renders what is already on screen');
    A.eq(pdf.requiresConsent, false, 'pdf costs no prompt, same as screenshot');
    A.eq(icp.scope, 'execute', 'intercept mutates browser state: execute scope');
    A.eq(icp.requiresConsent, false, 'intercept is station-browser-only, no prompt (attach mode refuses it outright)');
    A.eq(emu.scope, 'execute', 'emulate mutates browser state: execute scope');
    A.eq(emu.requiresConsent, false, 'emulate is station-browser-only, no prompt (attach mode refuses it outright)');
    for (const t of [pdf, icp, emu]) A.eq(t.capability, 'web', t.name + ' rides the web capability');
  }

  // ---- 2. browser.pdf — the file lands in the jail, content-addressed, with a deliverable ----
  {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-pie-'));
    try {
      const events = [];
      const B = makeBrowserTools({ driver: fakeDriver({ pdf: async () => PDF_B64 }), fsp, pathMod: path, root: ws });
      const tool = B.tools.find(t => t.name === 'browser.pdf');
      const r = await tool.run({}, { agentId: 'a1', emit: (n, d) => events.push({ n, d }) });
      const m = /pdf\/page-([0-9a-f]{12})\.pdf/.exec(r.content);
      A.ok(m, 'the saved path is content-addressed under pdf/ (got: ' + r.content + ')');
      const disk = fs.readFileSync(path.join(ws, 'a1', 'pdf', 'page-' + m[1] + '.pdf'));
      A.eq(disk.toString(), '%PDF-1.4\n% fake', 'the decoded PDF bytes are what the driver rendered');
      const dl = events.find(e => e.n === 'deliverable');
      A.ok(dl, 'saving a PDF emits a deliverable');
      A.eq(dl.d.kind, 'file', 'a PDF is kind:file — a document to open, not pixels to inline');
      A.ok(/\/api\/file\?agent=a1&path=pdf%2F/.test(r.content), 'the viewer link is included');
      // Idempotence: the same page renders to the same name, never a pile of near-duplicates.
      const r2 = await tool.run({}, { agentId: 'a1', emit: () => {} });
      A.ok(r2.content.indexOf('page-' + m[1] + '.pdf') >= 0, 'an unchanged page re-uses the same content-addressed file');
    } finally { fs.rmSync(ws, { recursive: true, force: true }); }
  }

  // ---- 3. browser.pdf honesty: no workspace, and a driver refusal ----
  {
    const B = makeBrowserTools({ driver: fakeDriver({ pdf: async () => PDF_B64 }) });   // no fsp/root: no jail
    const r = await B.tools.find(t => t.name === 'browser.pdf').run({}, {});
    A.ok(/no workspace to save into/.test(r.content), 'without a jail the tool says the render was discarded, never invents a path');

    // Headed Chrome builds can refuse Page.printToPDF — the tool reports the refusal, no fake file.
    const F = makeBrowserTools({ driver: fakeDriver({ pdf: async () => { throw new Error('PrintToPDF is not implemented'); } }) });
    const fr = await F.tools.find(t => t.name === 'browser.pdf').run({}, {});
    A.ok(/browser\.pdf failed: PrintToPDF is not implemented/.test(fr.content), 'a driver refusal surfaces verbatim');
    A.eq(fr.summary, 'pdf failed', 'and the summary says failed, not done');
  }

  // ---- 4. browser.intercept — kinds reach the driver; off is off; bad kinds fail loudly ----
  {
    const got = [];
    const B = makeBrowserTools({ driver: fakeDriver({ intercept: async kinds => { got.push(kinds); return kinds; } }) });
    const tool = B.tools.find(t => t.name === 'browser.intercept');
    const on = await tool.run({ kinds: ['image', 'FONT', 'image'] });
    A.eq(got[0], ['image', 'font'], 'kinds are normalized (case, dupes) before the driver sees them');
    A.ok(/Now blocking: image, font/.test(on.content), 'the answer names exactly what is blocked');
    const off = await tool.run({ kinds: [] });
    A.eq(got[1], [], 'an empty list reaches the driver as OFF');
    A.ok(/Blocking is off/.test(off.content), 'and reads as off');
    await rejects(tool.run({ kinds: ['image', 'script'] }), /unknown kind\(s\): script.*supported: image, media, font, stylesheet/,
      'an unknown kind is refused BY NAME with the supported list — blocking "script" would break every page');
  }

  // ---- 5. browser.emulate — presets merge with explicit fields; reset clears; empty asks for input ----
  {
    const got = [];
    const B = makeBrowserTools({ driver: fakeDriver({ emulate: async e => { got.push(e); return e; } }) });
    const tool = B.tools.find(t => t.name === 'browser.emulate');
    const r = await tool.run({ device: 'iphone', timezone: 'Europe/Berlin' });
    A.eq(got[0].width, 390, 'the iphone preset sets phone metrics');
    A.eq(got[0].mobile, true, 'mobile flag rides the preset');
    A.eq(got[0].touch, true, 'touch emulation rides the preset');
    A.ok(/iPhone/.test(got[0].userAgent), 'the preset carries a matching user agent');
    A.eq(got[0].timezone, 'Europe/Berlin', 'an explicit timezone overlays the preset');
    A.ok(/fresh browser\.snapshot/.test(r.content), 'the answer says refs expired');
    const off = await tool.run({ reset: true });
    A.eq(got[1], null, 'reset hands the driver null — clear everything');
    A.ok(/Emulation cleared/.test(off.content), 'and reads as cleared');
    await rejects(tool.run({}), /needs a device, userAgent, locale, timezone, or reset/, 'an empty call is a bad question, not a no-op');
    await rejects(tool.run({ device: 'blackberry' }), /unknown device/, 'an unknown device preset is refused by name');
  }

  // ---- 6. ATTACHED MODE: intercept/emulate are refused (ownership), pdf still works (a read) ----
  {
    const S = T.makeBrowserSession({
      driver: fakeDriver({ pdf: async () => PDF_B64, intercept: async k => k, emulate: async e => e }),
      fetchImpl: async () => ({ json: async () => ({ Browser: 'Chrome/141', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/x' }) })
    });
    await S.attach(9222);
    A.eq(S.attachedToUser(), true, 'the session is attached to the Commander\'s own Chrome');
    await rejects(S.intercept(['image']), /refused while attached/, 'intercept never reconfigures THEIR browser');
    await rejects(S.emulate({ locale: 'de-DE' }), /refused while attached/, 'emulate never spoofs THEIR browser');
    A.eq(await S.pdf({}), PDF_B64, 'pdf still renders — printing the page you are looking at is a read');
  }

  // ---- 7. THE CDP WIRE — patterns, session-targeted failRequest, re-apply on tab focus ----
  {
    const sent = [];
    let currentUrl = 'about:blank';
    class FakeWS {
      constructor() { this.handlers = {}; FakeWS.last = this; setTimeout(() => this.fire('open', {}), 0); }
      addEventListener(n, fn) { (this.handlers[n] = this.handlers[n] || []).push(fn); }
      fire(n, v) { for (const fn of this.handlers[n] || []) fn(v); }
      send(raw) {
        const m = JSON.parse(raw); sent.push(m);
        if (m.method === 'Page.navigate') currentUrl = m.params.url;
        let value = currentUrl;
        if (m.method === 'Runtime.evaluate' && /return \{ready:/.test(String(m.params && m.params.expression || ''))) {
          value = { ready: true, error: null };
        }
        let result = m.method === 'Runtime.evaluate' ? { result: { value } } : {};
        if (m.method === 'Page.printToPDF') result = { data: PDF_B64 };
        setTimeout(() => this.fire('message', { data: JSON.stringify({ id: m.id, result }) }), 0);
      }
      close() {}
    }
    const fakeProc = () => {
      let onClose;
      return { pid: 7, on(ev, fn) { if (ev === 'close') onClose = fn; }, kill() { if (onClose) queueMicrotask(() => onClose(0)); } };
    };
    const d = T.makeCdpDriver({
      chrome: 'fake-chrome.exe', forceHeadless: true, syntheticInputOnly: true, timeoutMs: 1000, cdpPort: 9361,
      fetchImpl: async () => ({ json: async () => [{ type: 'page', webSocketDebuggerUrl: 'ws://fake-pie' }] }),
      WebSocketImpl: FakeWS,
      spawn: () => fakeProc()
    });
    await d.navigate('http://127.0.0.1:5173/');

    await d.intercept(['image', 'media']);
    const en = sent.find(m => m.method === 'Fetch.enable');
    A.ok(en, 'intercept enables the Fetch domain');
    A.eq(en.params.patterns, [
      { urlPattern: '*', resourceType: 'Image', requestStage: 'Request' },
      { urlPattern: '*', resourceType: 'Media', requestStage: 'Request' }
    ], 'patterns pre-filter by resource type, so only blocked kinds ever pause');

    // A paused request from a BACKGROUND tab's session must be failed ON THAT SESSION — replying on
    // the active one leaves it paused forever and wedges the tab.
    FakeWS.last.fire('message', { data: JSON.stringify({ method: 'Fetch.requestPaused', sessionId: 'bg-tab', params: { requestId: 'req-9' } }) });
    await new Promise(r => setTimeout(r, 20));
    const fail = sent.find(m => m.method === 'Fetch.failRequest');
    A.ok(fail, 'a paused request is failed, never left hanging');
    A.eq(fail.params, { requestId: 'req-9', errorReason: 'BlockedByClient' }, 'blocked as BlockedByClient — browser.network then shows the truth');
    A.eq(fail.sessionId, 'bg-tab', 'the reply targets the session the event came from');

    // Emulation: one call fans out to the Emulation domain, with acceptLanguage riding the UA override.
    await d.emulate({ width: 390, height: 844, scale: 3, mobile: true, touch: true, userAgent: 'UA-X', locale: 'de-DE', timezone: 'Europe/Berlin' });
    const metrics = sent.find(m => m.method === 'Emulation.setDeviceMetricsOverride' && m.params.width === 390);
    A.ok(metrics && metrics.params.mobile === true, 'device metrics land with the mobile flag');
    const ua = sent.find(m => m.method === 'Emulation.setUserAgentOverride' && m.params.userAgent === 'UA-X');
    A.ok(ua, 'the user agent override lands');
    A.eq(ua.params.acceptLanguage, 'de-DE', 'the locale rides Accept-Language on the same override');
    A.ok(sent.some(m => m.method === 'Emulation.setTimezoneOverride' && m.params.timezoneId === 'Europe/Berlin'), 'the timezone override lands');
    A.ok(sent.some(m => m.method === 'Emulation.setTouchEmulationEnabled' && m.params.enabled === true), 'touch emulation lands');

    const resetMark = sent.length;
    await d.emulate(null);
    A.ok(sent.slice(resetMark).some(m => m.method === 'Emulation.setDeviceMetricsOverride' && m.params.width === 1440 && m.params.screenWidth === 1440), 'reset restores the coherent station screen metrics');
    A.ok(sent.some(m => m.method === 'Emulation.setTimezoneOverride' && m.params.timezoneId === ''), 'reset clears the timezone');

    // pdf over the wire: printBackground always, and the data comes back decoded by the tool layer.
    const b64 = await d.pdf({});
    A.eq(b64, PDF_B64, 'Page.printToPDF data is returned');
    const printed = sent.find(m => m.method === 'Page.printToPDF');
    A.eq(printed.params.printBackground, true, 'backgrounds print — a page without its CSS backgrounds is not the page');

    // A tab adopted AFTER intercept was set has no Fetch enabled; focusing it re-applies.
    await d.intercept(['image']);
    FakeWS.last.fire('message', { data: JSON.stringify({ method: 'Target.attachedToTarget', params: { sessionId: 'popup-pie', targetInfo: { type: 'page', targetId: 'popup-t' } } }) });
    await new Promise(r => setTimeout(r, 60));
    sent.length = 0;
    await d.selectTab(1);
    A.ok(sent.some(m => m.method === 'Fetch.enable' && m.sessionId === 'popup-pie'), 'focusing a later-adopted tab re-applies the block there');
    await d.close();
  }

  clearInterval(hold);
  A.report('browser.pie.test');
})().catch(e => { console.log('FAIL: browser.pie.test threw -- ' + (e && e.stack || e)); process.exit(1); });
