import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {launchChrome,connectCDP,evalJS,sleep,capture} from '../scripts/lib/cdp.mjs';
const out='.worldshots/warm-glow';mkdirSync(out,{recursive:true});let proc,cdp;
try {
  ({proc}=launchChrome({cdpPort:9386,profileDir:out+'/profile'}));cdp=await connectCDP(9386);
  await cdp.send('Page.enable');await cdp.send('Page.navigate',{url:'http://127.0.0.1:9197/'});
  for(let i=0;i<120;i++){if(await evalJS(cdp,"typeof World!=='undefined'&&!!World.stationDoc()"))break;await sleep(200);}
  const original=execFileSync('git',['show','e777e73a4:frontend/app/stationbake.js'],{encoding:'utf8',maxBuffer:4*1024*1024});
  const reference=JSON.parse(readFileSync('.worldshots/room-lighting/reference-station.json','utf8'));
  const result=await evalJS(cdp,`(()=>{
    const oldBake=new Function(${JSON.stringify(original+';return StationBake;')})();
    const geo=WorldModel.create(${JSON.stringify(reference)}).projectGeometry(),r=geo.allRects.find(r=>!geo.isCorridor(r.z));
    function render(baker) {
      const b=baker.bake(geo),cv=document.createElement('canvas');cv.width=b.W;cv.height=b.H;
      const ctx=cv.getContext('2d');ctx.drawImage(b.baseCv,0,0);ctx.drawImage(b.lightCv,0,0);
      const x=(r.x1+1)*12,y=(r.y1+1)*12,w=(r.x2-r.x1-1)*12,h=(r.y2-r.y1-1)*12;
      const data=ctx.getImageData(x,y,w,h).data;let luma=0,chroma=0,clipped=0;
      for(let i=0;i<data.length;i+=4){const R=data[i],G=data[i+1],B=data[i+2];luma+=.2126*R+.7152*G+.0722*B;chroma+=Math.max(R,G,B)-Math.min(R,G,B);if(Math.max(R,G,B)>245)clipped++;}
      const n=data.length/4;return {luma:luma/n,chroma:chroma/n,clipped:clipped/n,png:cv.toDataURL()};
    }
    return {before:render(oldBake),after:render(StationBake)};
  })()`);
  for(const [phase,r] of Object.entries(result)){writeFileSync(out+'/'+phase+'-materials.png',Buffer.from(r.png.split(',')[1],'base64'));delete r.png;}
  assert.ok(result.after.chroma>result.before.chroma*1.3,'material colour should measurably recover');
  assert.ok(result.after.luma<result.before.luma*1.4,'colour recovery must not become an exposure surge');
  assert.ok(result.after.chroma/result.after.luma > result.before.chroma/result.before.luma*1.15, 'colour must increase relative to brightness, not just lift exposure');
  assert.ok(result.after.clipped<=result.before.clipped+.001,'no clipped bright highlights');
  await sleep(1200);await capture(cdp,out,'after-furnished');
  await evalJS(cdp,`World.loadStation(WorldModel.create(${JSON.stringify(reference)}));World.rebake();true`);
  await sleep(1000);await capture(cdp,out,'after-wood-room');
  writeFileSync(out+'/colour.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally {if(cdp){await cdp.send('Browser.close').catch(()=>{});cdp.ws.close();}else proc?.kill();}
