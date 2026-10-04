// Real custom-station A/B. Source instrumentation and scene changes stay in this
// disposable browser; the original save is never written by this probe.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {launchChrome, connectCDP, evalJS, sleep, capture} from '../scripts/lib/cdp.mjs';
const out='.worldshots/command-room'; mkdirSync(out,{recursive:true});
const original=JSON.parse(readFileSync(out+'/original-station.json','utf8'));
const report={checks:[],exceptions:[]}; let proc,cdp;
const hook=`_commandReview: {
  geometry:()=>geo,
  apply:(doc)=>{station.setMaterial('r1','alloy');station.setHull('r1',{mat:'monocoque',style:'bone'});
    station.paintTiles('r1',Object.keys(doc.rooms.r1.floorPaint).map(k=>k.split(',').map(Number)),'cobalt');
    for(const p of doc.props){const old=station.serialize().props.find(o=>o.id===p.id);if(old&&(old.x!==p.x||old.y!==p.y))station.moveProp(p.id,p.x-old.x,p.y-old.y);}},
  frame:(zoom)=>{ const r=geo.allRects.find(r=>r.z==='r1');camAnim=null;camLock=null;camUserAt=performance.now();
    scale=zoom||Math.min(cv.width/cache.W,cv.height/cache.H);
    panX=zoom?cv.width/2-(r.x1+r.x2+1)*T/2*scale:(cv.width-cache.W*scale)/2;
    panY=zoom?cv.height/2-((r.y1+r.y2+1)*T/2+2)*scale:(cv.height-cache.H*scale)/2;
    return {scale,panX,panY};},
},
    cameraDbg: () =>`;
try {
  let reachable=false;
  for(let i=0;i<60;i++){reachable=await fetch('http://127.0.0.1:9177/').then(r=>r.ok).catch(()=>false);if(reachable)break;await sleep(500);}
  assert.ok(reachable,'Custom demo is listening before browser navigation');
  ({proc}=launchChrome({cdpPort:9360,win:'1600,1050',profileDir:out+'/profile'}));
  cdp=await connectCDP(9360); await cdp.send('Page.enable');await cdp.send('Runtime.enable');
  cdp.on('Runtime.exceptionThrown',e=>report.exceptions.push(e.exceptionDetails.exception?.description||e.exceptionDetails.text));
  cdp.on('Fetch.requestPaused',async e=>{
    const src=readFileSync('frontend/app/world.js','utf8').replace('cameraDbg: () =>',hook).replace('function tick(dt, now) {','function tick(dt, now) { if(window.__commandFrozen)return;');
    await cdp.send('Fetch.fulfillRequest',{requestId:e.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/javascript'}],body:Buffer.from(src).toString('base64')});
  });
  await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*/app/world.js*',requestStage:'Request'}]});
  await cdp.send('Page.navigate',{url:'http://127.0.0.1:9177/'});
  for(let i=0;i<100;i++){if(await evalJS(cdp,`typeof World!=='undefined' && World.cameraDbg().gates.cache && typeof SPRITES!=='undefined'&&SPRITES.ready`))break;await sleep(300);}
  assert.ok(await evalJS(cdp,`typeof World!=='undefined'&&World.cameraDbg().gates.cache`),'World loaded: '+JSON.stringify(report.exceptions));
  await evalJS(cdp,`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('GOT IT')&&b.offsetParent)?.click(); World.setCinecamIdle(3600000)`);
  const result=await evalJS(cdp,`(()=>{
    const before=${JSON.stringify(original)},st=WorldModel.create(before);
    const must=r=>{if(!r.ok)throw Error(JSON.stringify(r))};
    must(st.setMaterial('r1','alloy'));must(st.setHull('r1',{mat:'monocoque',style:'bone'}));
    const tiles=[];for(let y=2;y<=7;y++)for(let x=6;x<=11;x++)tiles.push([x,y]);
    must(st.paintTiles('r1',tiles,'cobalt'));
    // Open up the command cluster's silhouette while retaining its exact equipment and grants.
    must(st.moveProp('p38',0,-1));must(st.moveProp('p39',0,-1));
    must(st.moveProp('p5',1,-2));must(st.moveProp('p41',-2,0));
    return st.serialize();
  })()`);
  const proposed=typeof result==='string'?JSON.parse(result):result;
  writeFileSync(out+'/proposed-station.json',JSON.stringify(proposed,null,2));
  assert.deepEqual(proposed.order,original.order);
  for(const [id,r] of Object.entries(original.rooms))if(id!=='r1')assert.deepEqual(proposed.rooms[id],r);
  assert.deepEqual(proposed.props.map(p=>[p.id,p.t,p.agentId,p.w,p.h]),original.props.map(p=>[p.id,p.t,p.agentId,p.w,p.h]));
  assert.equal(Object.keys(proposed.rooms.r1.floorPaint).length,36,'Command inset contains all 36 intended tiles');
  report.checks.push('Only the command room finish and four equipment positions change','All equipment, assignments and footprints remain intact');
  await evalJS(cdp,`World.loadStation(WorldModel.create(${JSON.stringify(original)}))`);await sleep(4500);
  await evalJS(cdp,`window.__commandFrozen=true`);
  for(const label of (process.argv.includes('--pixels-only')?[]:['before','after'])){
    if(label==='after'){await evalJS(cdp,`World._commandReview.apply(${JSON.stringify(proposed)})`);await sleep(900);}
    for(const [view,zoom] of [['overview',0],['close',3.15]]){
      await evalJS(cdp,`World._commandReview.frame(${zoom});document.activeElement?.blur();if(typeof Hint!=='undefined')Hint.hide()`);await sleep(500);
      await capture(cdp,out,label+'-'+view);
      const clip=await evalJS(cdp,`(()=>{const r=document.querySelector('#stage').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()`);
      const shot=await cdp.send('Page.captureScreenshot',{format:'png',clip});writeFileSync(out+'/'+label+'-'+view+'-world.png',Buffer.from(shot.data,'base64'));
    }
  }
  const proof=await evalJS(cdp,`(()=>{
    const before=WorldModel.create(${JSON.stringify(original)}).projectGeometry(),after=WorldModel.create(${JSON.stringify(proposed)}).projectGeometry();
    const a=StationBake.bake(before),b=StationBake.bake(after);
    const read=c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    const pa=read(a.baseCv),pb=read(b.baseCv);const r=after.allRects.find(r=>r.z==='r1');
    let changed=0,outside=0;for(let y=0;y<after.H;y++)for(let x=0;x<after.W;x++){const i=(y*after.W+x)*4;if(pa[i]===pb[i]&&pa[i+1]===pb[i+1]&&pa[i+2]===pb[i+2]&&pa[i+3]===pb[i+3])continue;changed++;if(x<r.x1*12-8||x>(r.x2+1)*12+8||y<r.y1*12-40||y>(r.y2+1)*12+40)outside++;}
    const la=read(a.lightCv),lb=read(b.lightCv);let lightingChanges=0;for(let i=0;i<la.length;i++)if(la[i]!==lb[i])lightingChanges++;
    const chunks=StationBake.bakeIncremental(after,null,null),cv=document.createElement('canvas');cv.width=after.W;cv.height=after.H;
    StationBake.drawBase(cv.getContext('2d'),chunks,0,0);const pc=read(cv);let chunkChanges=0;
    const differences=[];
    for(let i=0;i<pb.length;i++)if(pb[i]!==pc[i]){chunkChanges++;if(differences.length<12)differences.push({x:Math.floor(i/4)%after.W,y:Math.floor(i/4/after.W),channel:i%4,full:pb[i],chunk:pc[i]});}
    const oldChunks=StationBake.bakeIncremental(before,null,null);cv.getContext('2d').clearRect(0,0,cv.width,cv.height);StationBake.drawBase(cv.getContext('2d'),oldChunks,0,0);const po=read(cv);let baselineChunkChanges=0;for(let i=0;i<pa.length;i++)if(pa[i]!==po[i])baselineChunkChanges++;
    let commandChunkChanges=0,newChunkChanges=0,commandMaxDifference=0;const introduced=[];
    for(let i=0;i<pb.length;i++){if(pb[i]===pc[i])continue;const x=Math.floor(i/4)%after.W,y=Math.floor(i/4/after.W);
      if(x>=r.x1*12-8&&x<=(r.x2+1)*12+8&&y>=r.y1*12-40&&y<=(r.y2+1)*12+40){commandChunkChanges++;commandMaxDifference=Math.max(commandMaxDifference,Math.abs(pb[i]-pc[i]));}
      if(pa[i]-po[i]!==pb[i]-pc[i]){newChunkChanges++;introduced.push({x,y,channel:i%4,before:pa[i],beforeChunk:po[i],full:pb[i],chunk:pc[i]});}
    }
    return {changed,outside,lightingChanges,chunkChanges,baselineChunkChanges,commandChunkChanges,commandMaxDifference,newChunkChanges,introduced,differences};
  })()`);
  writeFileSync(out+'/pixel-proof.json',JSON.stringify(proof,null,2));
  assert.ok(proof.changed>1000);assert.equal(proof.outside,0);assert.equal(proof.lightingChanges,0);
  // Chromium's existing alpha rounding differs by 1/255 at two unchanged coordinates.
  // Require the same signed baseline error, not a new discrepancy hidden by a blanket tolerance.
  assert.ok(proof.commandMaxDifference<=1);assert.equal(proof.newChunkChanges,0);
  report.checks.push('Baked art changes stay inside the command room and shell','Interior exposure, exterior exclusion and glass mask stay pixel-identical','Chunk comparison introduces no error beyond existing 1/255 alpha rounding');report.pixels=proof;
  assert.equal(report.exceptions.length,0,JSON.stringify(report.exceptions));
  writeFileSync(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{try{cdp?.ws.close()}catch{}try{proc?.kill()}catch{}}
process.exit(0);
