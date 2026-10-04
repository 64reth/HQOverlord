// PU-08 live seeded journey. Start with: SKYNET_PORT=<port> node dev/seed.js --keep
// Then run with the same SKYNET_PORT. Proves candidate -> click -> roster -> reload identity,
// plus the reachable 19-character and explicit-duplicate failure/confirmation paths.
import { launchChrome, connectCDP, evalJS, collectDiagnostics, sleep } from '../lib/cdp.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = process.env.SKYNET_PORT || '8787';
const CDP_PORT = Number(process.env.STARNET_CDP_PORT || 9762);
const profileDir = mkdtempSync(join(tmpdir(), 'recruit-identity-'));
const { proc } = launchChrome({ cdpPort: CDP_PORT, profileDir });
const failures = [];
const check = (name, ok, detail = '') => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' :: ' + detail : ''));
  if (!ok) failures.push(name);
};

try {
  const cdp = await connectCDP(CDP_PORT);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const { exceptions } = collectDiagnostics(cdp);
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await sleep(6500);

  // Establish the audited starting state: an existing Researcher.
  await evalJS(cdp, `(() => {
    if (!App.agents().some(a => a.id === 'researcher')) App.summonAgent(Specialties.get('researcher'), { activate:false });
    App.openSummonBay(); return App.agents().map(a => ({id:a.id,name:a.name}));
  })()`);
  await sleep(900);
  await evalJS(cdp, `document.querySelector('.mkt-card[data-id="researcher"]').click()`);
  await sleep(250);
  // the candidate name is echoed on the SUMMON button itself now (the commit-summary strip it used to live in
  // was dropped when CONFIGURE moved into the dossier — the fields it restated now sit directly above the CTA).
  const candidate = await evalJS(cdp, `(document.querySelector('.mkt-cta-main .mkt-candidate-name')||{}).textContent || ''`);
  check('second Researcher proposes a distinct visible name', candidate === 'RESEARCHER 2', JSON.stringify(candidate));

  await evalJS(cdp, `document.querySelector('.mkt-deploy').click()`);
  await sleep(700);
  const afterDefault = await evalJS(cdp, `App.agents().map(a=>({id:a.id,name:a.name}))`);
  const created = afterDefault.find(a => a.id === 'researcher-2');
  check('clicked candidate equals created roster identity', !!created && created.name === candidate, JSON.stringify(afterDefault));
  const crewText = await evalJS(cdp, `[...document.querySelectorAll('#crew .crew-name')].map(e=>e.textContent.trim())`);
  check('crew roster card shows the clicked candidate', crewText.some(t => t.startsWith(candidate)), JSON.stringify(crewText));

  await cdp.send('Page.reload', { ignoreCache: true }); await sleep(6500);
  const afterReload = await evalJS(cdp, `App.agents().map(a=>({id:a.id,name:a.name}))`);
  check('distinct specialist identity survives reload', afterReload.some(a => a.id === 'researcher-2' && a.name === 'RESEARCHER 2'), JSON.stringify(afterReload));

  // A long paste stays visible and blocks summon with an inline 19 / 18 explanation.
  await evalJS(cdp, `App.openSummonBay()`); await sleep(700);
  // no config strip to expand any more — CONFIGURE renders open inside the dossier the card click opens.
  await evalJS(cdp, `document.querySelector('.mkt-card[data-id="researcher"]').click()`); await sleep(250);
  const beforeLong = await evalJS(cdp, `App.agents().length`);
  await evalJS(cdp, `(() => { const i=document.querySelector('#mkt-summon-name'); i.value='ABCDEFGHIJKLMNOPQRS'; i.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  const longState = await evalJS(cdp, `({value:document.querySelector('#mkt-summon-name').value,count:document.querySelector('.mkt-name-count').textContent,invalid:document.querySelector('#mkt-summon-name').getAttribute('aria-invalid')})`);
  check('19-character paste is not silently truncated', longState.value.length === 19, JSON.stringify(longState));
  check('19-character paste has clear counter and invalid state', /19\s*\/\s*18/.test(longState.count) && longState.invalid === 'true', JSON.stringify(longState));
  await evalJS(cdp, `document.querySelector('.mkt-deploy').click()`); await sleep(300);
  check('over-cap name cannot summon', await evalJS(cdp, `App.agents().length`) === beforeLong);

  // Explicit historical duplicate remains possible only through an admitted second confirmation.
  await evalJS(cdp, `(() => { const i=document.querySelector('#mkt-summon-name'); i.value='researcher'; i.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  const duplicateHelp = await evalJS(cdp, `(document.querySelector('.mkt-name-help')||{}).textContent || ''`);
  check('explicit duplicate warns inline', /duplicate name/i.test(duplicateHelp), JSON.stringify(duplicateHelp));
  await evalJS(cdp, `document.querySelector('.mkt-deploy').click()`); await sleep(150);
  const armedDuplicate = await evalJS(cdp, `({count:App.agents().length,label:(document.querySelector('.mkt-deploy')||{}).textContent||''})`);
  check('first duplicate click only arms confirmation', armedDuplicate.count === beforeLong && /DUPLICATE NAME/.test(armedDuplicate.label), JSON.stringify(armedDuplicate));
  await evalJS(cdp, `document.querySelector('.mkt-deploy').click()`); await sleep(500);
  check('second duplicate click summons exactly once', await evalJS(cdp, `App.agents().length`) === beforeLong + 1);
  check('historical duplicates show secondary ids', (await evalJS(cdp, `[...document.querySelectorAll('#crew .crew-id')].map(e=>e.textContent)`)).length >= 2);
  check('no uncaught page exceptions', exceptions.length === 0, exceptions.join(' ; '));
} catch (e) {
  console.log('FAIL harness :: ' + (e && e.stack || e)); failures.push('harness');
} finally {
  try { proc.kill(); } catch {}
}

console.log('\n=== ' + (failures.length ? 'FAILURES: ' + failures.join(', ') : 'ALL CHECKS PASSED') + ' ===');
process.exit(failures.length ? 1 : 0);
