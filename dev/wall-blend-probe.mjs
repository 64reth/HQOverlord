// Inspect the actual custom demo in an isolated browser. Never writes its save.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {launchChrome,connectCDP,evalJS,sleep,capture} from '../scripts/lib/cdp.mjs';
const before=process.argv.includes('--before'),label=before?'before':'after';
const out='.worldshots/wall-blend';mkdirSync(out,{recursive:true});
let proc,cdp;const report={exceptions:[]};
let bakeSource=before?execFileSync('git',['show','fe88f76b3:frontend/app/stationbake.js'],{encoding:'utf8',maxBuffer:2e6}):readFileSync('frontend/app/stationbake.js','utf8');
// Record the painter's clipped face pixels independently of the lighting mask.
bakeSource=bakeSource.replace(/(?<!function )cornerFaceSlice\((put|putFace),/g,(_,paint)=>'cornerFaceSlice((...a)=>{window.__faceCapture=true;'+paint+'(...a);window.__faceCapture=false;},');
bakeSource=bakeSource.replace('b.fillStyle = c; b.fillRect(cx0, y0, cx1 - cx0, yEnd - y0);',
  'b.fillStyle = c; b.fillRect(cx0, y0, cx1 - cx0, yEnd - y0); if(window.__faceCapture)window.__paintedFaces.push([cx0,y0,cx1-cx0,yEnd-y0]);');
bakeSource=bakeSource.replace('function setBakeState(geo, viewport) {','function setBakeState(geo, viewport) { window.__paintedFaces=[];');
bakeSource=bakeSource.replace('function interiorReceiver() {','function interiorReceiver() { window.__wallCrowns=crownRects.slice();window.__wallGlass=viewportRects.slice();');
const hook=`_wallReview:{geometry:()=>geo,frame:(id,zoom)=>{const r=geo.allRects.find(r=>r.z===id);camAnim=null;camLock=null;camUserAt=performance.now();scale=zoom;panX=cv.width/2-(r.x1+r.x2+1)*T/2*scale;panY=cv.height/2-((r.y1+r.y2+1)*T/2-8)*scale;return r;}}, cameraDbg: () =>`;
try{
  ({proc}=launchChrome({cdpPort:9361,win:'1600,1050',profileDir:out+'/profile'}));cdp=await connectCDP(9361);
  await cdp.send('Page.enable');await cdp.send('Runtime.enable');
  cdp.on('Runtime.exceptionThrown',e=>report.exceptions.push(e.exceptionDetails.exception?.description||e.exceptionDetails.text));
  cdp.on('Fetch.requestPaused',async e=>{
    const src=e.request.url.includes('stationbake.js')?bakeSource:readFileSync('frontend/app/world.js','utf8').replace('cameraDbg: () =>',hook).replace('function tick(dt, now) {','function tick(dt, now) { if(window.__wallFrozen)return;');
    await cdp.send('Fetch.fulfillRequest',{requestId:e.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/javascript'}],body:Buffer.from(src).toString('base64')});
  });
  await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*/app/world.js*',requestStage:'Request'},{urlPattern:'*/app/stationbake.js*',requestStage:'Request'}]});
  await cdp.send('Page.navigate',{url:'http://127.0.0.1:9177/'});
  for(let i=0;i<100;i++){if(await evalJS(cdp,`typeof World!=='undefined'&&World.cameraDbg().gates.cache&&typeof SPRITES!=='undefined'&&SPRITES.ready`))break;await sleep(300);}
  assert.ok(await evalJS(cdp,`typeof World!=='undefined'&&World.cameraDbg().gates.cache`),'World loaded: '+JSON.stringify(report.exceptions));
  await evalJS(cdp,`World.setCinecamIdle(3600000);window.__wallFrozen=true;Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('GOT IT')&&b.offsetParent)?.click()`);
  report.rooms=await evalJS(cdp,`World._wallReview.geometry().allRects.filter(r=>!World._wallReview.geometry().isCorridor(r.z))`);
  report.pixels=await evalJS(cdp,`(()=>{
    const geo=World._wallReview.geometry(),bake=StationBake.bake(geo),faces=window.__paintedFaces,crowns=window.__wallCrowns;
    const read=cv=>cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
    const mask=read(bake.interiorCv),base=read(bake.baseCv),light=read(bake.lightCv);
    const faceSet=new Set(),crownSet=new Set();
    const collect=(rs,s)=>{for(const[x,y,w,h]of rs)for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)if(xx>=0&&yy>=0&&xx<geo.W&&yy<geo.H)s.add(yy*geo.W+xx)};
    collect(faces,faceSet);collect(crowns,crownSet);
    let missing=0,crownLeak=0;const samples=[];
    for(const p of faceSet)if(!crownSet.has(p)&&mask[p*4+3]!==255){missing++;if(samples.length<8)samples.push({x:p%geo.W,y:Math.floor(p/geo.W),mask:mask[p*4+3],light:light[p*4+3]})}
    for(const p of crownSet)if(mask[p*4+3])crownLeak++;
    window.__wallBake={bake,faces,crowns,glass:window.__wallGlass};
    return{W:geo.W,H:geo.H,facePixels:faceSet.size,missing,crownLeak,samples};
  })()`);
  if(!before){
    const images=Object.fromEntries(['baseCv','lightCv','interiorCv'].map(k=>[k,'data:image/png;base64,'+readFileSync(out+'/before-'+k+'.png').toString('base64')]));
    report.containment=await evalJS(cdp,`(async()=>{
      const previous=${JSON.stringify(images)},old={};
      for(const[k,src]of Object.entries(previous)){const img=new Image();img.src=src;await img.decode();const cv=document.createElement('canvas');cv.width=img.width;cv.height=img.height;cv.getContext('2d').drawImage(img,0,0);old[k]=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;}
      const {bake,faces,crowns,glass}=window.__wallBake,w=bake.W,h=bake.H;
      const read=cv=>cv.getContext('2d').getImageData(0,0,w,h).data;
      const mask=read(bake.interiorCv),base=read(bake.baseCv),light=read(bake.lightCv),fs=new Set();
      const each=(rs,fn)=>{for(const[x,y,rw,rh]of rs)for(let yy=y;yy<y+rh;yy++)for(let xx=x;xx<x+rw;xx++)if(xx>=0&&yy>=0&&xx<w&&yy<h)fn(yy*w+xx)};
      each(faces,p=>fs.add(p));
      let unrelatedCoverage=0,exteriorLightChanges=0,crownChanges=0,glassChanges=0;
      for(let p=0;p<w*h;p++){
        if(mask[p*4+3]!==old.interiorCv[p*4+3]&&!fs.has(p))unrelatedCoverage++;
        if(!mask[p*4+3])for(let c=0;c<4;c++)if(light[p*4+c]!==old.lightCv[p*4+c])exteriorLightChanges++;
      }
      const changed=p=>{for(let c=0;c<4;c++)if(base[p*4+c]!==old.baseCv[p*4+c]||light[p*4+c]!==old.lightCv[p*4+c])return true;return false};
      each(crowns,p=>{if(changed(p))crownChanges++});
      each(glass.map(v=>[v.x,v.y,v.w,v.h]),p=>{if(changed(p))glassChanges++});
      return{unrelatedCoverage,exteriorLightChanges,crownChanges,glassChanges};
    })()`);
  }
  for(const [name,id,zoom]of [['command','r1',3.7],['quarters','r32',4.3]]){
    await evalJS(cdp,`World._wallReview.frame('${id}',${zoom});document.activeElement?.blur();if(typeof Hint!=='undefined')Hint.hide()`);await sleep(450);await capture(cdp,out,label+'-'+name);
  }
  for(const name of ['baseCv','lightCv','interiorCv']){
    const data=await evalJS(cdp,`window.__wallBake.bake.${name}.toDataURL('image/png').split(',')[1]`);writeFileSync(out+'/'+label+'-'+name+'.png',Buffer.from(data,'base64'));
  }
  assert.equal(report.exceptions.length,0,JSON.stringify(report.exceptions));
  writeFileSync(out+'/'+label+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  if(!before){
    assert.equal(report.pixels.missing,0,'Every painted interior corner face receives interior lighting');assert.equal(report.pixels.crownLeak,0,'No crown pixels receive interior lighting');
    assert.deepEqual(report.containment,{unrelatedCoverage:0,exteriorLightChanges:0,crownChanges:0,glassChanges:0},'Only wall-face illumination changes; crowns, exterior light and real glass remain exact');
  }
}finally{try{cdp?.ws.close()}catch{}try{proc?.kill()}catch{}}
process.exit(0);
