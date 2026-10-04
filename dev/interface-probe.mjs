// Live UI proof against our seeded demo. No model calls, placement, setting writes, or submitted tasks.
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { launchChrome, connectCDP, evalJS, sleep, capture } from '../scripts/lib/cdp.mjs';
let proc, cdp;
const report = { checks: [], exceptions: [] };
const out = '.worldshots/interface';
mkdirSync(out, { recursive: true });
async function check(name, expression) {
  const result = await evalJS(cdp, expression);
  assert.ok(result, name + ': ' + JSON.stringify(result)); report.checks.push(name);
}
async function shot(name) {
  await evalJS(cdp, `document.activeElement?.blur(); if(typeof Hint!=='undefined') Hint.hide()`);
  await sleep(500); await capture(cdp, out, name);
}
async function closeWindows() {
  await evalJS(cdp, `['tasks','outbox','deliverables','agents','connectors'].forEach(k=>StationUI.closeTerm(k))`); await sleep(450);
}
try {
  ({ proc } = launchChrome({ cdpPort: 9354, profileDir: '.worldshots/interface-profile', win: '1440,1000' }));
  cdp = await connectCDP(9354); await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  cdp.on('Runtime.exceptionThrown', e => report.exceptions.push(e.exceptionDetails.exception?.description || e.exceptionDetails.text));
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:9177/' });
  for (let i = 0; i < 120; i++) { if (await evalJS(cdp, `document.querySelectorAll('#crew .crew-row').length>0 && !document.querySelector('#comms-agent-portrait').hidden`)) break; await sleep(500); }
  await evalJS(cdp, `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('GOT IT') && b.offsetParent)?.click()`);
  await check('All 26 crew portraits are loaded and cropped', `Array.from(document.querySelectorAll('.crew-portrait img')).length===26 && Array.from(document.querySelectorAll('.crew-portrait img')).every(i=>i.complete && i.naturalHeight>0 && i.naturalHeight<92)`);
  const identity = await evalJS(cdp, `(() => {const a=App.currentAgent();return {id:a.id,skin:a.skin,next:Object.keys(DATA.SKINS).find(k=>k!==a.skin),transcript:document.querySelector('#chat-log').innerHTML}})()`);
  await evalJS(cdp, `App.currentAgent().skin=${JSON.stringify(identity.next)}; StationUI.setRoster(App.agents())`);
  await sleep(300);
  await check('Changing appearance refreshes COMMS without replaying the conversation', `document.querySelector('#comms-agent-portrait').dataset.portraitSet===DATA.SKINS[${JSON.stringify(identity.next)}].set && document.querySelector('#chat-log').innerHTML===${JSON.stringify(identity.transcript)}`);
  await evalJS(cdp, `App.currentAgent().skin=${JSON.stringify(identity.skin)}; StationUI.setRoster(App.agents())`);
  await check('Composer has useful writing depth', `document.querySelector('#chat-input').getBoundingClientRect().height>=60`);
  await shot('01-comms-crew');
  await evalJS(cdp, `document.querySelector('#crew-search-toggle').click();document.querySelector('#crew-search').value='nothing-matches';document.querySelector('#crew-search').dispatchEvent(new Event('input'))`);
  await check('Crew search explains a missing match', `!Array.from(document.querySelectorAll('#crew .crew-row')).some(r=>!r.hidden) && !document.querySelector('#crew-search-empty').hidden`);
  await evalJS(cdp, `document.querySelector('#crew-search-close').click()`);
  await check('Closing search restores the roster without an activity filter', `Array.from(document.querySelectorAll('#crew .crew-row')).every(r=>!r.hidden) && document.querySelector('#crew-search-wrap').hidden`);
  await evalJS(cdp, `StationUI.openTerm('connectors','toolsets')`);
  for(let i=0;i<40;i++) { if(await evalJS(cdp,`!!document.querySelector('.ts-availability')`)) break; await sleep(250); }
  await check('Toolset badges and totals match the selected agent’s effective authority', `(async () => {const aid=document.querySelector('#ts-agent').value, placed=World.heroCaps(aid).map(c=>c.objectType);const view=await Harness.api.get('/api/toolsets?agent='+encodeURIComponent(aid)+'&placed='+encodeURIComponent(placed.join(',')));const labels=view.toolsets.map(t=>t.available?'AVAILABLE':t.switchEffective&&!t.enabled?'DISABLED':t.switchEffective&&!t.placed&&!t.profileGranted?'NEEDS PROP':'UNAVAILABLE');const rows=Array.from(document.querySelectorAll('.ts-row'));const counts=Array.from(document.querySelectorAll('.ability-readout b'),e=>Number(e.textContent));return rows.length===view.toolsets.length && rows.every((r,i)=>r.querySelector('.ts-availability').textContent===labels[i]) && counts[0]===labels.filter(x=>x==='AVAILABLE').length && counts[1]===labels.filter(x=>x==='NEEDS PROP').length && counts[2]===labels.filter(x=>x==='DISABLED'||x==='UNAVAILABLE').length})()`);
  await check('Setup routes are collapsed until requested', `!document.querySelector('#ab-router').open`);
  await shot('02-abilities');
  await evalJS(cdp, `document.querySelector('#ab-router').open=true`); await shot('03-connect-a-service');
  await closeWindows();
  await evalJS(cdp, `StationUI.openTerm('agents','config')`); await sleep(600);
  await check('Configuration begins with three concise summaries', `document.querySelectorAll('.cf-group[open]').length===0 && document.querySelectorAll('.cf-group').length===3`);
  await shot('04-configuration');
  await evalJS(cdp, `document.querySelector('[data-cfjump="cf-grp-behaves"]').click()`);
  await check('Jump controls expand their target', `document.querySelector('#cf-grp-behaves').open`);
  await evalJS(cdp, `StationUI.rerender('agents')`); await sleep(300);
  await check('Expanded config groups survive rerender', `document.querySelector('#cf-grp-behaves').open`);
  await evalJS(cdp, `document.querySelector('[data-cfjump="cf-grp-knows"]').click(); document.querySelector('[data-edit="identity"]').click()`); await sleep(300);
  await check('Prompt editing remains reachable inside the disclosure', `!!document.querySelector('#cf-ta-identity') && document.querySelector('#cf-ta-identity').getBoundingClientRect().height>0`);
  await evalJS(cdp, `document.querySelector('[data-cancel="identity"]').click()`);
  await closeWindows();
  await evalJS(cdp, `StationUI.openTerm('tasks'); document.querySelector('#kb-in').value='Unsubmitted draft — keep this'; document.querySelector('[data-work-to="outbox"]').click()`); await sleep(600);
  await check('Following work leaves one visible window', `document.querySelectorAll('.term:not(.term-min-hidden):not(.term-closing)').length===1 && !!document.querySelector('.term:not(.term-min-hidden) .ob-topnote')`);
  await shot('05-outbox-navigation');
  await evalJS(cdp, `document.querySelector('.term:not(.term-min-hidden) .work-back').click()`); await sleep(550);
  await check('Back restores the unsubmitted task draft', `document.querySelector('#kb-in').value==='Unsubmitted draft — keep this' && !document.querySelector('#kb-in').closest('.term').classList.contains('term-min-hidden')`);
  await evalJS(cdp, `StationUI.h.workConversation('tasks')`); await sleep(300);
  await check('Conversation handoff reveals COMMS with a return route', `!document.querySelector('#comms-workpath').hidden && document.querySelectorAll('.term:not(.term-min-hidden):not(.term-closing)').length===0`);
  await evalJS(cdp, `document.querySelector('#comms-workpath .work-back').click()`); await sleep(500);
  await check('Conversation return keeps task draft', `document.querySelector('#kb-in').value==='Unsubmitted draft — keep this'`);
  await evalJS(cdp, `document.querySelector('#kb-in').value=''`); await shot('06-task-board');
  await closeWindows();
  await evalJS(cdp, `document.querySelector('#bb-build').click()`); await sleep(500);
  await evalJS(cdp, `document.querySelector('#refit-guide-go')?.click()`);
  await evalJS(cdp, `document.querySelector('.refit-tool[data-tool="prop"]').click()`); await sleep(300);
  await evalJS(cdp, `document.querySelector('.fl-x')?.click()`);
  await check('All build tools remain visible with the prop catalog open', `Array.from(document.querySelectorAll('.refit-tool')).every(b=>b.getBoundingClientRect().height>0) && !!document.querySelector('#refit-selected-prop canvas')`);
  await shot('07-refit-catalog');
  const prop = await evalJS(cdp, `(() => {const input=document.querySelector('#refit-propsearch-input');input.value='table';input.dispatchEvent(new Event('input'));const btn=document.querySelector('.refit-proptile[data-prop]');btn.click();return btn.dataset.prop})()`);
  await check('Searching keeps input focus and selected preview matches selection', `document.querySelector('#refit-propsearch-input').value==='table' && document.querySelector('#refit-selected-prop b').textContent===PropSprites.spec(${JSON.stringify(prop)}).label`);
  await evalJS(cdp, `document.querySelector('[data-preview-turn]')?.click()`);
  await check('Preview footprint matches the real turned prop', `(() => {const c=PropSprites.spec(${JSON.stringify(prop)}),box=PropSprites.footprintAt(c.id,PropSprites.nextFacing(c.id,0,1));return document.querySelector('.refit-preview-info').textContent.includes(box.w+' × '+box.h+' tiles')})()`);
  await shot('08-refit-selected');
  await evalJS(cdp, `document.querySelector('#refit-done').click()`); await sleep(500);
  for (const width of [1049, 700, 475]) {
    await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:912,deviceScaleFactor:1,mobile:false}); await sleep(600);
    await check('Composer controls fit at '+width+'px', `(() => {const row=document.querySelector('.chat-tools'),p=document.querySelector('#chat-panel');return row.scrollWidth<=row.clientWidth+1 && p.getBoundingClientRect().right<=innerWidth+1 && document.querySelector('#chat-log').clientHeight>=40})()`);
    await shot('responsive-'+width);
  }
  report.layout = await evalJS(cdp, `({width:innerWidth,height:innerHeight,bodyScroll:document.documentElement.scrollWidth})`);
  assert.equal(report.exceptions.length, 0, JSON.stringify(report.exceptions));
  writeFileSync(out + '/report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) { if (cdp) await capture(cdp,out,'failure').catch(()=>{}); throw error; }
finally { if (cdp) cdp.ws.close(); if (proc) proc.kill(); }
