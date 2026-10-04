// Live build UI on an isolated in-memory copy of the custom demo; no saved-station edits or model calls.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {launchChrome,findChrome,connectCDP,evalJS,sleep,capture} from '../scripts/lib/cdp.mjs';
const out='.worldshots/prop-abilities';mkdirSync(out,{recursive:true});let proc,cdp;
const report={checks:[],exceptions:[]};
async function check(name,src){const value=await evalJS(cdp,src);assert.ok(value,name+': '+JSON.stringify(value));report.checks.push(name);}
async function until(src){for(let i=0;i<80;i++){if(await evalJS(cdp,src))return;await sleep(100);}throw Error('Timed out: '+src);}
async function run(src){return evalJS(cdp,src);}
async function shot(name){await run(`document.activeElement?.blur();if(typeof Hint!=='undefined')Hint.hide()`);await sleep(200);await capture(cdp,out,name);}
try{
  if(process.argv.includes('--gpu'))proc=spawn(findChrome(),['--headless=new','--enable-gpu','--no-first-run','--no-default-browser-check','--hide-scrollbars','--mute-audio','--remote-debugging-port=9362','--window-size=1440,1000','--user-data-dir='+out+'/gpu-profile','about:blank'],{stdio:'ignore',windowsHide:true});
  else ({proc}=launchChrome({cdpPort:9362,win:'1440,1000',profileDir:out+'/profile'}));
  cdp=await connectCDP(9362);await cdp.send('Page.enable');await cdp.send('Runtime.enable');
  cdp.on('Runtime.exceptionThrown',e=>report.exceptions.push(e.exceptionDetails.exception?.description||e.exceptionDetails.text));
  await cdp.send('Page.navigate',{url:'http://127.0.0.1:9177/'});
  await until(`typeof Build!=='undefined'&&Build.__test__&&Build.__test__.station()`);
  await run(`window.__fixture=WorldModel.create(Build.__test__.station().serialize());Build.init({getStation:()=>window.__fixture,persist:()=>{},world:World,agents:()=>App.agents()});Build.open();document.querySelector('#refit-guide-go')?.click();document.querySelector('.fl-x')?.click();document.querySelector('[data-tool="prop"]').click()`);
  await until(`document.querySelector('[data-access-cap]')?.dataset.state==='available'`);
  await check('Props opens on Abilities with the five real core cards',`document.querySelector('[data-prop-section="abilities"]').classList.contains('active')&&document.querySelectorAll('.refit-core-card').length===PropSprites.STARTER.length&&PropSprites.STARTER.every(id=>document.querySelector('.refit-core-card[data-prop="'+id+'"]'))`);
  await check('The three purpose sections and ten tools remain accessible',`document.querySelectorAll('[data-prop-section]').length===3&&document.querySelectorAll('.refit-tool').length===10`);
  await check('Compact selection shows its purpose and direct placement hint without redundant action buttons',`!document.querySelector('.refit-propworkspace').classList.contains('show-details')&&['.refit-preview-grant','.refit-purpose','.refit-placement-note'].every(s=>document.querySelector(s).getBoundingClientRect().height>0)&&!document.querySelector('[data-preview-place],[data-preview-cancel]')&&['.equipment-status','.refit-equipment-scope'].every(s=>document.querySelector(s).getBoundingClientRect().height===0)`);
  await check('All five core choices and the compact selection fit in the initial desktop view',`(()=>{const g=document.querySelector('#refit-propgrid-host').getBoundingClientRect(),d=document.querySelector('.refit-dock').getBoundingClientRect(),p=document.querySelector('.refit-propinspector').getBoundingClientRect();return [...document.querySelectorAll('.refit-core-card')].every(b=>{const r=b.getBoundingClientRect();return r.top>=g.top&&r.bottom<=g.bottom+1})&&p.bottom<=d.bottom&&p.height<190&&g.height>200})()`);
  await run(`document.querySelector('.refit-details-toggle').click()`);
  await check('About retains full access and sharing details in the same sidebar',`document.querySelector('.refit-propworkspace').classList.contains('show-details')&&['.equipment-status','.refit-equipment-scope','.refit-equipment-detail'].every(s=>document.querySelector(s).getBoundingClientRect().height>0)`);
  await run(`document.querySelector('.refit-details-back').click();document.activeElement?.blur();window.__selectedBeforeHover=document.querySelector('#refit-selected-prop b').textContent`);
  const hoverPoint=await run(`(()=>{const r=document.querySelector('[data-core-ability="dish"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...hoverPoint});await sleep(450);
  await check('Hover briefly identifies the prop and ability without changing the selection or opening details',`(()=>{const b=document.querySelector('[data-core-ability="dish"]'),t=document.querySelector('#station-tip');return !t.hidden&&t.textContent.includes(PropSprites.spec(b.dataset.prop).label)&&t.textContent.includes('WEB & BROWSER')&&t.textContent.length<240&&!b.hasAttribute('title')&&document.querySelector('#refit-selected-prop b').textContent===window.__selectedBeforeHover&&!document.querySelector('.refit-propworkspace').classList.contains('show-details')})()`);
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:900,y:80});await sleep(100);
  await check('Hover hint disappears when the pointer leaves the prop',`document.querySelector('#station-tip').hidden`);
  await run(`document.querySelector('[data-core-ability="dish"]').focus()`);
  await check('Keyboard focus gets the same accessible hint without selecting the prop',`!document.querySelector('#station-tip').hidden&&document.activeElement.getAttribute('aria-describedby')==='station-tip'&&document.querySelector('#refit-selected-prop b').textContent===window.__selectedBeforeHover`);
  await run(`document.activeElement.blur()`);
  await check('Overview agrees with the actual per-agent toolsets endpoint',`(async()=>{const aid=document.querySelector('.refit-ability-overview select').value,f=EquipmentHelp.inspect(window.__fixture,aid,'war_intelcab'),v=await Harness.api.get('/api/toolsets?agent='+encodeURIComponent(aid)+'&placed='+encodeURIComponent(f.placed.join(',')));return [...document.querySelectorAll('[data-access-cap]')].every(b=>b.dataset.state===EquipmentHelp.access(b.dataset.accessCap,v).state)})()`);
  await shot('01-core-abilities');
  await run(`window.__agentSelect=document.querySelector('.refit-ability-overview select');window.__originalAgent=window.__agentSelect.value;window.__agentSelect.selectedIndex=1;window.__otherName=window.__agentSelect.selectedOptions[0].textContent;window.__agentSelect.dispatchEvent(new Event('change'))`);
  await until(`document.querySelector('.equipment-status').textContent.includes(window.__otherName)`);
  await check('Changing agent refreshes its detailed access explanation',`document.querySelector('.equipment-status').textContent.includes(window.__otherName)&&document.querySelector('.refit-ability-overview select').value!==window.__originalAgent`);
  await run(`document.querySelector('.refit-ability-overview select').value=window.__originalAgent;document.querySelector('.refit-ability-overview select').dispatchEvent(new Event('change'));document.querySelector('[data-preview-flip]').click()`);
  await check('Orientation controls keep the purpose and access panel present',`!!document.querySelector('.refit-purpose')&&!!document.querySelector('.equipment-status')`);
  await run(`document.querySelector('.refit-designs').click()`);
  await check('Files alternatives contain every and only actual Files-granting design',`[...document.querySelectorAll('.refit-proptile')].length===PropSprites.CATALOG.filter(p=>WorldModel.capForProp(p.id)==='cabinet').length&&[...document.querySelectorAll('.refit-proptile')].every(b=>WorldModel.capForProp(b.dataset.prop)==='cabinet')&&document.querySelector('.refit-ability-intro').textContent.includes('Same ability, different appearance')`);
  await run(`document.querySelector('[data-prop="vault"]').click()`);
  await check('Alternate design keeps its actual identity and placement footprint',`document.querySelector('#refit-selected-prop b').textContent==='VAULT'&&document.querySelector('.refit-preview-info').textContent.includes('3 × 2')`);await shot('02-alternate-designs');
  await run(`document.querySelector('.refit-ability-back').click()`);
  await check('Returning from alternatives highlights the ability while retaining the chosen design',`document.querySelector('.refit-core-card.active').dataset.coreAbility==='cabinet'&&document.querySelector('#refit-selected-prop b').textContent==='VAULT'`);
  await run(`document.querySelector('[data-prop-section="decoration"]').click()`);
  await check('Decoration contains no capability-granting or functional equipment',`[...document.querySelectorAll('.refit-proptile')].every(b=>!WorldModel.capForProp(b.dataset.prop)&&PropSprites.spec(b.dataset.prop).tier!=='functional')&&document.querySelector('.refit-preview-grant').textContent.includes('APPEARANCE ONLY')`);
  await check('Core access stays visible in Decoration after all five abilities are available',`document.querySelectorAll('[data-access-cap]').length===5&&document.querySelector('.refit-ability-overview').getBoundingClientRect().height>0`);
  report.decorationCount=await run(`document.querySelectorAll('.refit-proptile').length`);await shot('03-decoration');
  if(process.argv.includes('--gpu')){
    await sleep(1000);await run(`Build.__test__.perf(true)`);
    report.performance=await run(`new Promise(resolve=>{const t=[];function frame(now){t.push(now);if(now-t[0]<7000)return requestAnimationFrame(frame);const gaps=t.slice(1).map((v,i)=>v-t[i]).sort((a,b)=>a-b);resolve({items:document.querySelectorAll('.refit-proptile').length,fps:+(1000*(t.length-1)/(t.at(-1)-t[0])).toFixed(1),p95FrameMs:+gaps[Math.floor(gaps.length*.95)].toFixed(1)})}requestAnimationFrame(frame)})`);
    report.performance.meanRenderMs=await run(`(()=>{const p=Build.__test__.perf(false)['=FRAME'];return +(p.ms/p.n).toFixed(2)})()`);
  }
  await run(`document.querySelector('#refit-category-trigger').click()`);
  await check('Category picker only contains decoration categories with matching counts',`[...document.querySelectorAll('.refit-propcat')].every(b=>b.dataset.cat==='all'||PropSprites.CATALOG.some(p=>p.cat===b.dataset.cat&&EquipmentHelp.kind(p,WorldModel.capForProp(p.id))==='decoration'))`);
  await run(`document.querySelector('[data-cat="lounge"]').click()`);
  await check('Decoration category selection filters correctly',`[...document.querySelectorAll('.refit-proptile')].every(b=>PropSprites.spec(b.dataset.prop).cat==='lounge')&&!document.querySelector('.refit-category-menu').open`);
  await run(`document.querySelector('[data-prop-section="equipment"]').click()`);
  await check('Workstations and operational equipment are separate from abilities and decoration',`document.querySelector('[data-prop="desk"]')&&[...document.querySelectorAll('.refit-proptile')].every(b=>EquipmentHelp.kind(PropSprites.spec(b.dataset.prop),WorldModel.capForProp(b.dataset.prop))==='equipment')&&document.querySelector('.refit-preview-grant').textContent==='WORKSTATION'`);await shot('04-workstations');
  await run(`window.__baseGet=Harness.api.get;window.__accessReads=0;Harness.api.get=function(url,...args){if(url.startsWith('/api/toolsets'))window.__accessReads++;return window.__baseGet.call(this,url,...args)};document.querySelector('[data-access-cap="dish"]').click();document.querySelector('.refit-designs').click();document.querySelector('[data-prop="comms_uplink"]').click();document.querySelector('[data-prop="comms_dish"]').click()`);await sleep(250);
  await check('Selecting equivalent designs does not repeat access requests',`window.__accessReads===0`);
  await run(`(()=>{const input=document.querySelector('#refit-propsearch-input');input.focus();input.value='files';input.dispatchEvent(new Event('input'))})()`);
  await check('Global search retains focus and labels each result by actual purpose',`document.activeElement.id==='refit-propsearch-input'&&document.querySelectorAll('.refit-proptile').length>0&&!document.querySelector('[data-prop-section].active')&&document.querySelector('.refit-searchnote').textContent.includes('ALL CATEGORIES')&&[...document.querySelectorAll('.refit-proptile')].every(b=>b.querySelector('.refit-proptile-grant').textContent===EquipmentHelp.label(PropSprites.spec(b.dataset.prop),WorldModel.capForProp(b.dataset.prop)))`);
  await run(`document.querySelector('#refit-propsearch-input').value='nonsense-no-prop';document.querySelector('#refit-propsearch-input').dispatchEvent(new Event('input'))`);
  await check('Unmatched search offers a clear recovery',`!document.querySelector('.refit-proptile')&&document.querySelector('#refit-propgrid-host button').textContent==='CLEAR SEARCH'`);
  await run(`document.querySelector('#refit-propgrid-host button').click();document.querySelector('[data-access-cap="cabinet"]').click()`);
  // All deletions and the following placement happen only in the isolated copy; real endpoint resolves its projection.
  await run(`for(const p of window.__fixture.props())if(WorldModel.capForProp(p.t)==='cabinet')window.__fixture.removeProp(p.id)`);
  await until(`document.querySelector('[data-access-cap="cabinet"]').dataset.state!=='pending'`);
  await check('Removing the last Files prop updates to the actual remaining authority',`(async()=>{const aid=document.querySelector('.refit-ability-overview select').value,f=EquipmentHelp.inspect(window.__fixture,aid,'war_intelcab'),v=await window.__baseGet.call(Harness.api,'/api/toolsets?agent='+encodeURIComponent(aid)+'&placed='+encodeURIComponent(f.placed.join(',')));return !f.placed.includes('cabinet')&&document.querySelector('[data-access-cap="cabinet"]').dataset.state===EquipmentHelp.access('cabinet',v).state})()`);
  await run(`document.querySelector('#refit-fit').click();document.activeElement?.blur();window.__before=window.__fixture.props().length`);
  const point=await run(`(()=>{const st=window.__fixture,b=st.bounds(),s=PropSprites.spec('war_intelcab');for(let y=b.minTy;y<=b.maxTy;y++)for(let x=b.minTx;x<=b.maxTx;x++){if(!st.canPlaceProp(s.id,x,y,s.w,s.h).ok)continue;const e=Build.__test__._tileEvent([x,y]);if(document.elementFromPoint(e.clientX,e.clientY)?.classList.contains('refit-canvas'))return {x:e.clientX,y:e.clientY}}return null})()`);assert.ok(point);
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
  await check('Ability equipment previews its footprint before placement',`Build.__test__.ghostRects()?.length===1&&window.__fixture.props().length===window.__before`);
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});await sleep(200);
  await check('A real pointer click places the selected ability prop',`window.__fixture.props().length===window.__before+1&&window.__fixture.props().at(-1).t==='war_intelcab'`);
  await run(`document.querySelector('#refit-undo').click()`);await check('Undo removes the ability prop',`window.__fixture.props().length===window.__before`);
  await run(`document.querySelector('#refit-redo').click()`);await check('Redo restores the ability prop',`window.__fixture.props().length===window.__before+1`);
  await until(`document.querySelector('[data-access-cap="cabinet"]').dataset.state!=='pending'`);
  await run(`Harness.api.get=function(url,...args){return url.startsWith('/api/toolsets')?Promise.reject(Error('probe simulated outage')):window.__baseGet.call(this,url,...args)};document.querySelector('[data-refresh-access]').click()`);
  await until(`document.querySelector('[data-access-cap="cabinet"]').dataset.state==='unknown'`);
  await check('Simulated access failure reports unknown rather than recommending more props',`document.querySelector('.equipment-status').textContent.includes('could not be checked')&&[...document.querySelectorAll('[data-access-cap]')].every(b=>b.dataset.state==='unknown')`);
  await run(`Harness.api.get=window.__baseGet;document.querySelector('[data-refresh-access]').click()`);await until(`document.querySelector('[data-access-cap="cabinet"]').dataset.state==='available'`);
  for(const [width,height]of [[1440,1000],[1049,912],[750,912],[390,740],[640,568]]){
    await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await sleep(200);
    await check('Purpose sections, overview and catalog remain reachable at '+width+'×'+height,`(()=>{const d=document.querySelector('.refit-dock').getBoundingClientRect();return d.left>=0&&d.left<30&&d.width<=342&&d.right<=innerWidth+1&&d.bottom<=innerHeight+1&&document.querySelector('#refit-propgrid-host').clientHeight>60&&[...document.querySelectorAll('[data-prop-section], [data-core-ability]')].every(b=>b.getBoundingClientRect().width>20)})()`);
    if(width===390)await shot('05-narrow');
  }
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await run(`document.body.style.zoom='1.45';document.body.style.setProperty('--sn-unzoom',String(1/1.45))`);await sleep(200);
  await check('Overview stays inside the sidebar at enlarged text size',`(()=>{const r=document.querySelector('.refit-ability-overview').getBoundingClientRect(),d=document.querySelector('.refit-dock').getBoundingClientRect();return r.right<=d.right&&document.querySelector('#refit-propgrid-host').clientHeight>60})()`);
  await run(`document.body.style.zoom='';document.body.style.removeProperty('--sn-unzoom');document.activeElement?.blur()`);
  await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await check('Escape safely cancels placement and returns to Select',`Build.isOpen()&&Build.__test__.tool()==='select'`);
  await run(`document.querySelector('#refit-done').click()`);await check('Done exits build mode',`!Build.isOpen()`);
  assert.equal(report.exceptions.length,0,JSON.stringify(report.exceptions));writeFileSync(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(e){if(cdp)await capture(cdp,out,'failure').catch(()=>{});throw e;}finally{try{cdp?.ws.close()}catch{}try{proc?.kill()}catch{}}
process.exit(0);
