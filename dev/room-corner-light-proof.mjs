import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {launchChrome,connectCDP,evalJS,sleep,capture} from '../scripts/lib/cdp.mjs';
const out='.worldshots/corner-light';mkdirSync(out,{recursive:true});let proc,cdp;
try {
 ({proc}=launchChrome({cdpPort:9391,profileDir:out+'/profile'}));cdp=await connectCDP(9391);
 await cdp.send('Page.navigate',{url:'http://127.0.0.1:9197/'});
 for(let i=0;i<100;i++){if(await evalJS(cdp,"typeof World!=='undefined'&&!!World.stationDoc()"))break;await sleep(200);}
 const old=execFileSync('git',['show','c0ca851e2:frontend/app/stationbake.js'],{encoding:'utf8',maxBuffer:4*1024*1024});
 const source=readFileSync('frontend/app/stationbake.js','utf8').replace('return { baseCv, lightCv, interiorCv,','return { faceRects:cornerFaceRects.slice(), crownRects:crownRects.slice(), baseCv, lightCv, interiorCv,');
 const results=await evalJS(cdp,`(()=>{
  const previous=new Function(${JSON.stringify(old+';return StationBake;')})();
  const current=new Function(${JSON.stringify(source+';return StationBake;')})();
  const results=[];
  for(const mat of ['ribbed','plating','viewport'])for(const up of [0,14,30,50])for(const n of [1,2]){
   for(const baker of [previous,current]){baker.WALL.up=up;baker.SHAPE.cornerN=n;}
   const doc=WorldModel.defaultDoc(),r=doc.rooms[doc.order[0]];r.wallMat=mat;r.rects=[{x1:0,y1:0,x2:13,y2:11}];
   const geo=WorldModel.create(doc).projectGeometry(),a=previous.bake(geo),b=current.bake(geo);
   const before=a.interiorCv.getContext('2d').getImageData(0,0,a.W,a.H).data,after=b.interiorCv.getContext('2d').getImageData(0,0,b.W,b.H).data;
   const baseA=a.baseCv.getContext('2d').getImageData(0,0,a.W,a.H).data,baseB=b.baseCv.getContext('2d').getImageData(0,0,b.W,b.H).data;
   const faces=new Set();for(const [x,y,w,h] of b.faceRects)for(let py=y;py<y+h;py++)for(let px=x;px<x+w;px++)if(px>=0&&py>=0&&px<b.W&&py<b.H)faces.add(py*b.W+px);
   for(const [x,y,w,h] of b.crownRects)for(let py=y;py<y+h;py++)for(let px=x;px<x+w;px++)faces.delete(py*b.W+px);
   let missingBefore=0,missingAfter=0,unrelated=0,baseChanges=0;
   for(const p of faces){if(before[p*4+3]<255)missingBefore++;if(after[p*4+3]<255)missingAfter++;}
   for(let p=0;p<a.W*a.H;p++){if(before[p*4+3]!==after[p*4+3]&&!faces.has(p))unrelated++;for(let c=0;c<4;c++)if(baseA[p*4+c]!==baseB[p*4+c])baseChanges++;}
   const result={mat,up,n,facePixels:faces.size,missingBefore,missingAfter,unrelated,baseChanges};
   if(mat==='ribbed'&&up===30&&n===1){
    const render=bake=>{const cv=document.createElement('canvas');cv.width=bake.W;cv.height=bake.H;const c=cv.getContext('2d');c.drawImage(bake.baseCv,0,0);c.drawImage(bake.lightCv,0,0);return cv.toDataURL();};
    result.before=render(a);result.after=render(b);
   }
   results.push(result);
  }
  return results;
 })()`);
 for(const r of results){for(const phase of ['before','after'])if(r[phase]){writeFileSync(out+'/'+phase+'.png',Buffer.from(r[phase].split(',')[1],'base64'));delete r[phase];}assert.equal(r.missingAfter,0,JSON.stringify(r));assert.equal(r.unrelated,0,JSON.stringify(r));assert.equal(r.baseChanges,0,JSON.stringify(r));}
 assert.ok(results.some(r=>r.missingBefore>50),'must reproduce missing raised-corner coverage');
 writeFileSync(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
 await sleep(1000);await capture(cdp,out,'live');
}finally{if(cdp){await cdp.send('Browser.close').catch(()=>{});cdp.ws.close();}else proc?.kill();}
