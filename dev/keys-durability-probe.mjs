// Sweep probe: existing saved keys must survive + round-trip through the refreshed UI.
// Saves a service key and an MCP connector (custom header + timeout) via the same APIs the old UI
// used, RESTARTS the sidecar (the update boundary), then drives the NEW UI: KEYS must list the key,
// the card must show 'added', edit must prefill with the advanced block unfolded and the token blank
// (never round-tripped) — and saving that edit must KEEP the stored token.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';
const PORT = process.env.SKYNET_SHOT_PORT || '9595';
const CDP = Number(process.env.SKYNET_CDP_PORT || 9597);
const URL = `http://127.0.0.1:${PORT}/`;
const scratch = mkdtempSync(join(tmpdir(), 'abkeys-'));
const ws = join(scratch, 'ws');
materializeSeedWorkspace(ws);
let side = bootSeededSidecar({ port: PORT, scratchDir: ws });
let chrome = null, cdp = null;
const api = async (path, opts) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/${path}`, {
    headers: { 'content-type': 'application/json' }, ...opts });
  return { status: r.status, body: await r.json().catch(() => null) };
};
try {
  if (!(await waitUp(URL))) throw new Error('sidecar down');
  chrome = launchChrome({ cdpPort: CDP, profileDir: join(scratch, 'chrome') });
  await sleep(1200);
  cdp = await connectCDP(CDP);
  await cdp.send('Runtime.enable');
  const diag = collectDiagnostics(cdp);
  await evalJS(cdp, `location.href = ${JSON.stringify(URL)}`);
  if (!(await waitDevReady(cdp, evalJS, { url: URL }))) throw new Error('no game screen');
  await sleep(1500);
  // ---- "the old install": write real data through the app's own authed fetch ----
  const seeded = await evalJS(cdp, `(async () => {
    const tok = await Harness.apiToken();
    const post = (p, b) => fetch('/api/' + p, { method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok },
      body: JSON.stringify(b) }).then(r => r.status);
    return { key: await post('servicekeys', { id: 'printify', name: 'Printify',
        key: 'pk_live_TESTVALUE_12345', docsUrl: 'https://developers.printify.com' }),
      connector: await post('connectors', { id: 'legacy-server', label: 'Legacy Server',
        url: 'https://example.invalid/mcp', token: 'tok_SECRET_999',
        headers: { 'X-Api-Version': '2024-01' }, timeoutMs: 45000 }) };
  })()`);
  console.log('SEEDED', JSON.stringify(seeded));
  // ---- the update boundary: restart the sidecar, then reload the app ----
  side.kill(); await sleep(1500);
  side = bootSeededSidecar({ port: PORT, scratchDir: ws });
  if (!(await waitUp(URL))) throw new Error('sidecar down after restart');
  await evalJS(cdp, `location.reload()`);
  if (!(await waitDevReady(cdp, evalJS, { url: URL }))) throw new Error('no game screen after restart');
  await sleep(1500);
  const survived = await evalJS(cdp, `(async () => {
    const tok = await Harness.apiToken();
    const get = p => fetch('/api/' + p, { headers: { authorization: 'Bearer ' + tok } }).then(r => r.json());
    const keys = await get('servicekeys'), cons = await get('connectors');
    const key0 = (keys.keys || []).find(k => k.id === 'printify') || {};
    const con0 = (cons.connectors || []).find(x => x.id === 'legacy-server') || {};
    // the list NEVER carries the value (masked last4 only) — last4 present = the secret survived
    return { keyId: key0.id, keyLast4: key0.last4, keyValueEchoed: !!key0.key,
      conHasToken: !!con0.hasToken, conHeader: (con0.headers || {})['X-Api-Version'], conTimeout: con0.timeoutMs };
  })()`);
  console.log('SURVIVED RESTART', JSON.stringify(survived));
  await evalJS(cdp, `StationUI.openTerm('connectors')`); await sleep(1600);
  const ui = await evalJS(cdp, `(async () => {
    const r = {};
    document.querySelector('#con-tab-connectors-keys').click();
    await new Promise(z => setTimeout(z, 600));
    const list = document.querySelector('#ky-list');
    r.keysPane = !!(list && /Printify/.test(list.textContent) && /2345/.test(list.textContent));
    const card = document.querySelector('#ky-catalog [data-ky-pick="printify"]');
    r.cardMarkedAdded = card ? card.classList.contains('added') : 'no-card';
    document.querySelector('#con-tab-connectors-mcp').click();
    await new Promise(z => setTimeout(z, 600));
    const mrow = document.querySelector('#mc-list .mc-row[data-id="legacy-server"]');
    r.mcpRow = !!mrow;
    if (mrow) { (mrow.querySelector('button[data-mc-edit], [data-act="edit"], .mc-edit') ||
                 [...mrow.querySelectorAll('button')].find(b => /edit/i.test(b.textContent)) || {}).click?.(); }
    await new Promise(z => setTimeout(z, 500));
    r.editPrefill = {
      id: (document.querySelector('#mc-id') || {}).value,
      headers: (document.querySelector('#mc-headers') || {}).value,
      timeout: (document.querySelector('#mc-timeout') || {}).value,
      tokenBlank: ((document.querySelector('#mc-token') || {}).value || '') === '',
      advOpen: !!(document.querySelector('.mc-adv') || {}).open };
    return r;
  })()`);
  console.log('NEW-UI ROUND-TRIP', JSON.stringify(ui));
  // ---- save the edit with token blank: the stored token must SURVIVE ----
  const saved = await evalJS(cdp, `(async () => {
    const t = document.querySelector('#mc-timeout'); if (t) t.value = '50000';
    document.querySelector('#mc-add').click();
    await new Promise(z => setTimeout(z, 2500));
    return (document.querySelector('#mc-msg') || {}).textContent || '';
  })()`);
  const conA = await evalJS(cdp, `(async () => {
    const tok = await Harness.apiToken();
    const j = await fetch('/api/connectors', { headers: { authorization: 'Bearer ' + tok } }).then(r => r.json());
    return (j.connectors || []).find(x => x.id === 'legacy-server') || {};
  })()`);
  console.log('EDIT-KEEPS-TOKEN', JSON.stringify({ msg: String(saved).slice(0, 60),
    stillHasToken: !!conA.hasToken, header: (conA.headers || {})['X-Api-Version'], timeout: conA.timeoutMs }));
  if (diag.exceptions.length) console.log('PAGE EXCEPTIONS:', diag.exceptions);
} finally {
  try { if (chrome && chrome.proc) chrome.proc.kill(); } catch {}
  try { if (side && side.kill) side.kill(); } catch {}
}
