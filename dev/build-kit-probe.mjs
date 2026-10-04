// Real renderer/UI on a disposable copy of the custom station. No save/model calls.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {launchChrome,findChrome,connectCDP,evalJS,sleep,capture} from '../scripts/lib/cdp.mjs';
const out='.worldshots/build-kit-clarity';mkdirSync(out,{recursive:true});let proc,cdp;
const report={checks:[],exceptions:[]};
async function check(name,src){const result=await evalJS(cdp,src);assert.ok(result,name+': '+JSON.stringify(result));report.checks.push(name);}
async function shot(name){await evalJS(cdp,`document.activeElement?.blur();if(typeof Hint!=='undefined')Hint.hide()`);await sleep(250);await capture(cdp,out,name);}
try{
  if(process.argv.includes('--gpu'))proc=spawn(findChrome(),['--headless=new','--enable-gpu','--no-first-run','--no-default-browser-check','--hide-scrollbars','--mute-audio','--remote-debugging-port=9362','--window-size=1440,1000','--user-data-dir='+out+'/gpu-profile','about:blank'],{stdio:'ignore',windowsHide:true});
  else ({proc}=launchChrome({cdpPort:9362,win:'1440,1000',profileDir:out+'/profile'}));
  cdp=await connectCDP(9362);await cdp.send('Page.enable');await cdp.send('Runtime.enable');
  cdp.on('Runtime.exceptionThrown',e=>report.exceptions.push(e.exceptionDetails.exception?.description||e.exceptionDetails.text));
  await cdp.send('Page.navigate',{url:'http://127.0.0.1:9177/'});
  for(let i=0;i<100;i++){if(await evalJS(cdp,`typeof Build!=='undefined'&&Build.__test__&&Build.__test__.station()`))break;await sleep(300);}
  await evalJS(cdp,`window.__buildFixture=WorldModel.create(Build.__test__.station().serialize());Build.init({getStation:()=>window.__buildFixture,persist:()=>{},world:World,agents:()=>App.agents()});Build.open();document.querySelector('#refit-guide-go')?.click();document.querySelector('.fl-x')?.click()`);await sleep(500);
  await check('Starts safely with a short guide and two clear starting points',`Build.__test__.tool()==='select'&&document.querySelectorAll('.refit-start').length===2&&document.querySelectorAll('.refit-quicksteps li').length===3`);await shot('01-start');
  await evalJS(cdp,`document.querySelector('[data-start-tool="prop"]').click()`);
  await check('All prop categories are in the picker and ten tools stay visible',`document.querySelectorAll('.refit-propcat').length===Object.keys(PropSprites.CATS).length+1&&document.querySelectorAll('.refit-tool').length===10`);await shot('02-catalog');
  await check('Workflow checklist does not cover prop browsing',`!document.querySelector('.refit-finline')||getComputedStyle(document.querySelector('.refit-finline')).display==='none'`);
  await check('Tools have visible Build, Edit and Workflow groups',`document.querySelectorAll('.refit-toolset').length===3&&Array.from(document.querySelectorAll('.refit-tool')).every(b=>b.getBoundingClientRect().height>20)`);
  await check('Place, Cancel and supported orientation controls are visible without opening About',`['[data-preview-place]','[data-preview-cancel]','[data-preview-flip]'].every(s=>document.querySelector(s).getBoundingClientRect().height>20)`);
  await evalJS(cdp,`document.querySelector('#refit-category-trigger').click()`);
  await check('Category picker opens a readable list inside the left panel',`document.querySelector('.refit-category-menu').open&&Array.from(document.querySelectorAll('.refit-propcat')).every(b=>b.getBoundingClientRect().height>=25)`);await shot('02-category-picker');
  await evalJS(cdp,`document.querySelector('#refit-category-trigger').focus();window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await check('Escape closes only the category picker',`!document.querySelector('.refit-category-menu').open&&Build.__test__.tool()==='prop'`);
  await evalJS(cdp,`document.querySelector('#refit-category-trigger').click();document.querySelector('[data-cat="capability"]').click()`);
  await check('Choosing a category closes the picker and labels the shelf',`!document.querySelector('.refit-category-menu').open&&document.querySelector('.refit-category-current').textContent===PropSprites.CAT_LABEL.capability&&Array.from(document.querySelectorAll('.refit-proptile')).every(b=>PropSprites.spec(b.dataset.prop).cat==='capability')`);
  await evalJS(cdp,`(()=>{const input=document.querySelector('#refit-propsearch-input');input.focus();input.value='web';input.dispatchEvent(new Event('input'))})()`);
  await check('Global ability search keeps input focus and labels its scope',`document.activeElement.id==='refit-propsearch-input'&&document.querySelectorAll('.refit-proptile').length>0&&document.querySelector('.refit-searchnote').textContent.includes('ALL CATEGORIES')&&!document.querySelector('.refit-propcat.active')`);
  await evalJS(cdp,`document.querySelector('.refit-proptile').click()`);await shot('03-search');
  await check('Selected tile has a truthful preview and placement instruction',`document.querySelector('#refit-selected-prop b').textContent===PropSprites.spec(document.querySelector('.refit-proptile.active').dataset.prop).label&&!!document.querySelector('[data-preview-place]')`);
  await evalJS(cdp,`(()=>{const input=document.querySelector('#refit-propsearch-input');input.value='not-a-real-prop';input.dispatchEvent(new Event('input'))})()`);
  await check('Unmatched search has a recovery action',`!document.querySelector('.refit-proptile')&&document.querySelector('#refit-propgrid-host button').textContent==='CLEAR SEARCH'`);
  await evalJS(cdp,`document.querySelector('#refit-propgrid-host button').click();document.querySelector('[data-cat="all"]').click()`);
  await check('All-props shelf contains the complete real catalog',`document.querySelectorAll('.refit-proptile').length===PropSprites.CATALOG.length`);
  // Count actual sprite draw calls: the full inventory must not animate every item.
  await evalJS(cdp,`window.__oldPropDraw=PropSprites.draw;window.__thumbCalls=0;PropSprites.draw=function(p,w){if(p.x===0&&p.y===0)window.__thumbCalls++;return window.__oldPropDraw(p,w)}`);await sleep(800);
  report.thumbCalls=await evalJS(cdp,`window.__thumbCalls`);await evalJS(cdp,`PropSprites.draw=window.__oldPropDraw`);
  assert.ok(report.thumbCalls<60,'Catalog animation is bounded to the selected/hovered props');
  await evalJS(cdp,`(()=>{const grid=document.querySelector('#refit-propgrid-host');grid.scrollTop=200;window.__shelfScroll=grid.scrollTop;window.__firstTile=document.querySelector('.refit-proptile');document.querySelectorAll('.refit-proptile')[12].click()})()`);
  await check('Picking an item preserves shelf scroll and existing thumbnail canvases',`document.querySelector('#refit-propgrid-host').scrollTop===window.__shelfScroll&&document.querySelector('.refit-proptile')===window.__firstTile`);
  if(process.argv.includes('--gpu')){
    await sleep(1200);
    await evalJS(cdp,`Build.__test__.perf(true)`);
    report.performance=await evalJS(cdp,`new Promise(resolve=>{const t=[];function frame(now){t.push(now);if(now-t[0]<7000)return requestAnimationFrame(frame);const gaps=t.slice(1).map((v,i)=>v-t[i]).sort((a,b)=>a-b);resolve({renderer:'GPU-enabled Chromium',catalogItems:document.querySelectorAll('.refit-proptile').length,frames:t.length,fps:+(1000*(t.length-1)/(t.at(-1)-t[0])).toFixed(1),p95FrameMs:+gaps[Math.floor(gaps.length*.95)].toFixed(1)})}requestAnimationFrame(frame)})`);
    report.performance.layers=await evalJS(cdp,`Object.fromEntries(Object.entries(Build.__test__.perf(false)).map(([k,v])=>[k,+(v.ms/v.n).toFixed(3)]))`);
    report.performance.gpuRenderer=await evalJS(cdp,`(()=>{const g=document.createElement('canvas').getContext('webgl');const e=g&&g.getExtension('WEBGL_debug_renderer_info');return e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):'unavailable'})()`);
  }
  for(const [width,height]of [[1440,1000],[1049,912],[750,912],[475,850],[390,740],[640,568]]){
    await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await sleep(300);
    await check('Tools and catalog fit at '+width+'×'+height,`(()=>{const dock=document.querySelector('.refit-dock').getBoundingClientRect(),grid=document.querySelector('#refit-propgrid-host');return dock.left>=0&&dock.left<30&&dock.width<=342&&dock.right<=innerWidth+1&&dock.bottom<=innerHeight+1&&grid.clientHeight>60&&Array.from(document.querySelectorAll('.refit-tool')).every(b=>{const r=b.getBoundingClientRect();return r.width>20&&r.height>20&&r.left>=0&&r.right<=innerWidth+1})})()`);
    if(width===750||width===390){await shot('responsive-'+width);if(width===390){await evalJS(cdp,`document.querySelector('.refit-details-toggle').click()`);await check('Item details can be reached on '+width+'px',`document.querySelector('.refit-propinspector').getBoundingClientRect().height>40&&document.querySelector('[data-preview-place]').getBoundingClientRect().height>20`);await shot('details-'+width);await evalJS(cdp,`document.querySelector('.refit-details-back').click()`);}}
  }
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await sleep(300);
  await evalJS(cdp,`document.querySelector('[data-cat="all"]').click();document.querySelector('[data-prop="crate"]').click();window.__propBefore=Build.__test__.station().serialize().props.length;document.querySelector('#refit-fit').click();document.querySelector('[data-preview-place]').click()`);await sleep(300);
  await check('Place focuses the deck without hiding the sidebar or stamping anything',`!document.querySelector('.refit-dock').classList.contains('is-collapsed')&&document.activeElement.classList.contains('refit-canvas')&&Build.__test__.tool()==='prop'&&Build.__test__.station().serialize().props.length===window.__propBefore`);
  const point=await evalJS(cdp,`(()=>{const st=Build.__test__.station(),b=st.bounds(),s=PropSprites.spec('crate');for(let y=b.minTy;y<=b.maxTy;y++)for(let x=b.minTx;x<=b.maxTx;x++){if(!st.canPlaceProp('crate',x,y,s.w,s.h).ok)continue;const e=Build.__test__._tileEvent([x,y]);if(document.elementFromPoint(e.clientX,e.clientY)?.classList.contains('refit-canvas'))return {x:e.clientX,y:e.clientY}}return null})()`);
  assert.ok(point,'A clear deck tile is reachable beside the left panel');
  await evalJS(cdp,`document.querySelector('#refit-category-trigger').click()`);
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
  await check('Clicking outside the category picker dismisses it without placing a prop',`!document.querySelector('.refit-category-menu').open&&Build.__test__.station().serialize().props.length===window.__propBefore`);
  await evalJS(cdp,`window.__oldCanPlace=window.__buildFixture.canPlaceProp;window.__hoverChecks=0;window.__buildFixture.canPlaceProp=function(...args){window.__hoverChecks++;return window.__oldCanPlace.apply(this,args)}`);
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
  await sleep(350);
  await check('Hover previews the prop footprint before committing and avoids repeated validation',`(()=>{const g=Build.__test__.ghostRects(),s=PropSprites.spec('crate');return g?.length===1&&g[0].x2-g[0].x1+1===s.w&&g[0].y2-g[0].y1+1===s.h&&window.__hoverChecks<=1&&Build.__test__.station().serialize().props.length===window.__propBefore})()`);
  await shot('03-placement-preview');
  await evalJS(cdp,`window.__buildFixture.canPlaceProp=window.__oldCanPlace`);
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});await sleep(400);
  await check('A real deck click places the selected crate on the isolated station',`Build.__test__.station().serialize().props.length===window.__propBefore+1&&Build.__test__.station().serialize().props.at(-1).t==='crate'`);
  await evalJS(cdp,`document.querySelector('#refit-undo').click()`);await sleep(200);
  await check('Undo removes the placement',`Build.__test__.station().serialize().props.length===window.__propBefore`);
  await evalJS(cdp,`document.querySelector('#refit-redo').click()`);await sleep(200);
  await check('Redo restores the placement',`Build.__test__.station().serialize().props.length===window.__propBefore+1`);
  await evalJS(cdp,`document.querySelector('#refit-undo').click()`);
  await evalJS(cdp,`document.querySelector('[data-preview-cancel]').click()`);
  await check('Cancel returns to Select without closing build mode or editing the station',`Build.isOpen()&&Build.__test__.tool()==='select'&&Build.__test__.station().serialize().props.length===window.__propBefore`);
  await evalJS(cdp,`document.querySelector('[data-tool="paint"]').click()`);await shot('04-surfaces');
  await check('Surface materials stay reachable',`document.querySelectorAll('.refit-mattile').length>5&&document.querySelector('#refit-palette').clientHeight>60`);
  await evalJS(cdp,`document.activeElement?.blur();window.dispatchEvent(new KeyboardEvent('keydown',{key:'/',bubbles:true}))`);
  await check('Slash opens the prop search and focuses it',`Build.__test__.tool()==='prop'&&document.activeElement.id==='refit-propsearch-input'`);
  await evalJS(cdp,`document.activeElement.value='desk';document.activeElement.dispatchEvent(new Event('input'));document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await check('Escape clears search without closing build mode',`Build.isOpen()&&document.activeElement.id==='refit-propsearch-input'&&document.activeElement.value===''`);
  await evalJS(cdp,`document.body.style.zoom='1.45';document.body.style.setProperty('--sn-unzoom',String(1/1.45))`);await sleep(400);
  await check('Catalog stays inside the screen at 145 percent text zoom',`(()=>{const r=document.querySelector('.refit-dock').getBoundingClientRect();return getComputedStyle(document.body).zoom==='1.45'&&r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&document.querySelector('#refit-propgrid-host').clientHeight>60})()`);await shot('text-zoom');
  await evalJS(cdp,`document.body.style.zoom='';document.body.style.removeProperty('--sn-unzoom');window.dispatchEvent(new Event('resize'));document.querySelector('[data-tool="line"]').click()`);await sleep(350);
  await check('Workflow guidance stays clear of the construction tray',`(()=>{const f=document.querySelector('.refit-finline');return !f||getComputedStyle(f).display==='none'||f.getBoundingClientRect().left>=document.querySelector('.refit-dock').getBoundingClientRect().right})()`);
  await evalJS(cdp,`document.querySelector('#refit-done').click()`);await check('Done exits build mode',`!Build.isOpen()`);
  assert.equal(report.exceptions.length,0,JSON.stringify(report.exceptions));writeFileSync(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(e){if(cdp)await capture(cdp,out,'failure').catch(()=>{});throw e;}finally{try{cdp?.ws.close()}catch{}try{proc?.kill()}catch{}}
process.exit(0);
