// Live DOM journey for the surviving session power tools (the SESSION TOOLS window was retired
// 2026-07-17): rail search over 50 sessions, hit-click session switch, and per-row ⋯ menu export
// in both formats. Start a seeded StarNet app, then point SKYNET_PORT here.
import { launchChrome, connectCDP, evalJS, collectDiagnostics, sleep } from '../lib/cdp.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = process.env.SKYNET_PORT || '8787';
const CDP_PORT = Number(process.env.STARNET_CDP_PORT || 9774);
const profileDir = mkdtempSync(join(tmpdir(), 'session-power-tools-'));
const { proc } = launchChrome({ cdpPort: CDP_PORT, profileDir });
const failures = [];
const check = (name, ok, detail = '') => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' :: ' + detail : ''));
  if (!ok) failures.push(name);
};
async function waitFor(cdp, expr, label, tries = 80) {
  for (let i = 0; i < tries; i++) { if (await evalJS(cdp, expr).catch(() => false)) return; await sleep(100); }
  throw new Error('timed out waiting for ' + label);
}

let cdp;
try {
  cdp = await connectCDP(CDP_PORT);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const { exceptions } = collectDiagnostics(cdp);
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await waitFor(cdp, `typeof App === 'object' && typeof Workstreams === 'object' && !!document.querySelector('#screen-game.active')`, 'seeded station');

  const seeded = await evalJS(cdp, `(() => {
    const now=Date.now(), day=86400000, rows=[{id:'power-general',title:null,kind:'chat',lane:'active',createdAt:now,lastActiveAt:now,history:[]}];
    for(let i=1;i<=50;i++){
      rows.push({id:'power-'+i,title:i===17?'Orchid launch notes':'Session '+i,kind:'chat',lane:i%7===0?'shipped':'active',createdAt:now-i*day,lastActiveAt:now-i*day,pinned:i===49,history:i%5===0?[]:[{role:'user',content:i===23?'body NEBULA-NEEDLE':'Question '+i},{role:'assistant',content:'Answer '+i}]});
    }
    Workstreams.init({workstreams:rows,activeId:'power-17',generalId:'power-general'}); App.persist(); App.refreshRail(); return Workstreams.all().length;
  })()`);
  await sleep(1200);
  check('seeded General plus 50 sessions', seeded === 51, String(seeded));

  // the retired window must be GONE, not merely unreachable — no SYSTEM entry, no parked panel
  const gone = await evalJS(cdp, `({menu:!!document.querySelector('.bb[data-term="sessiontools"]'),park:!!document.querySelector('#ws-tools-park')})`);
  check('SESSION TOOLS window entry and parked panel are removed', !gone.menu && !gone.park, JSON.stringify(gone));

  // rail search: visible on the SESSIONS view, finds a transcript body across 50 sessions
  const railSearch = await evalJS(cdp, `(() => {
    const box=document.querySelector('#ws-rail-search'), q=document.querySelector('#ws-search');
    if(!box||!q) return {present:false};
    q.value='NEBULA-NEEDLE'; q.dispatchEvent(new Event('input',{bubbles:true}));
    return {present:true,hidden:box.hidden,hits:[...document.querySelectorAll('#ws-search-results .ws-search-hit')].map(e=>({id:e.dataset.id,text:e.textContent}))};
  })()`);
  check('rail search is present on the sessions rail', railSearch.present && !railSearch.hidden, JSON.stringify(railSearch));
  check('body search finds exact known session', railSearch.hits && railSearch.hits.length === 1 && railSearch.hits[0].id === 'power-23', JSON.stringify(railSearch.hits));

  // clicking a hit switches to that session and clears the query
  const jumped = await evalJS(cdp, `(() => {
    document.querySelector('#ws-search-results .ws-search-hit').click();
    return {active:Workstreams.activeId(),query:document.querySelector('#ws-search').value,results:document.querySelectorAll('#ws-search-results .ws-search-hit').length};
  })()`);
  check('search hit opens its session and resets the box', jumped.active === 'power-23' && jumped.query === '' && jumped.results === 0, JSON.stringify(jumped));

  // PROJECTS view hides the search block with the sessions list; switching back restores it
  const viewFlip = await evalJS(cdp, `(() => {
    App.setRailView ? App.setRailView('projects') : document.querySelector('#ws-tab-projects').click();
    const hiddenInProjects=document.querySelector('#ws-rail-search').hidden;
    document.querySelector('#ws-tab-sessions').click();
    return {hiddenInProjects,backOnSessions:!document.querySelector('#ws-rail-search').hidden};
  })()`);
  check('PROJECTS view hides rail search, SESSIONS restores it', viewFlip.hiddenInProjects && viewFlip.backOnSessions, JSON.stringify(viewFlip));

  // per-row ⋯ menu export: preserve the generated bundle while neutralizing the download navigation
  await evalJS(cdp, `(() => {
    window.__powerExports=[]; const original=Workstreams.exportConversation;
    Workstreams.exportConversation=(id,format,opts)=>{ const b=original(id,format,opts); window.__powerExports.push({id,bundle:b}); return b; };
    URL.createObjectURL=()=> 'blob:starnet-test'; URL.revokeObjectURL=()=>{};
    HTMLAnchorElement.prototype.click=function(){};
  })()`);
  const menuExport = await evalJS(cdp, `(() => {
    const row=document.querySelector('#workstreams .ws-row[data-id="power-17"]');
    row.querySelector('.ws-kebab').click();
    const items=[...document.querySelectorAll('.ws-menu .ws-menu-item')].map(b=>b.dataset.act);
    const md=document.querySelector('.ws-menu .ws-menu-item[data-act="export-md"]'); md && md.click();
    return {items,exports:window.__powerExports.map(x=>({id:x.id,format:x.bundle.format}))};
  })()`);
  check('row menu offers both export formats', menuExport.items.includes('export-md') && menuExport.items.includes('export-json'), JSON.stringify(menuExport.items));
  check('menu export targets the exact ROW session (not the active one)', menuExport.exports.length === 1 && menuExport.exports[0].id === 'power-17' && menuExport.exports[0].format === 'markdown', JSON.stringify(menuExport.exports));
  const jsonExport = await evalJS(cdp, `(() => {
    const row=document.querySelector('#workstreams .ws-row[data-id="power-17"]');
    row.querySelector('.ws-kebab').click();
    document.querySelector('.ws-menu .ws-menu-item[data-act="export-json"]').click();
    return window.__powerExports[window.__powerExports.length-1].bundle;
  })()`);
  check('JSON export carries dialogue roles only and round-trips its title', jsonExport.format === 'json' && /Orchid launch notes/.test(jsonExport.text) && JSON.parse(jsonExport.text).messages.every(m=>m.role==='user'||m.role==='assistant'), jsonExport.format);

  check('no uncaught page exceptions', exceptions.length === 0, exceptions.join(' ; '));
} catch (e) {
  console.log('FAIL harness :: ' + (e && e.stack || e)); failures.push('harness');
} finally {
  try { cdp?.ws.close(); } catch {}
  try { proc.kill(); } catch {}
  try { rmSync(profileDir, { recursive: true, force: true }); } catch {}
}
console.log('\n=== ' + (failures.length ? 'FAILURES: ' + failures.join(', ') : 'ALL CHECKS PASSED') + ' ===');
process.exit(failures.length ? 1 : 0);
