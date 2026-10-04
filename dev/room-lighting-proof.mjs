import { launchChrome, connectCDP, evalJS, sleep, capture } from '../scripts/lib/cdp.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const phase = process.argv[2] || 'after';
const out = '.worldshots/room-lighting';
mkdirSync(out, { recursive: true });
let proc, cdp;
try {
  ({proc} = launchChrome({cdpPort:9367, profileDir:out+'/profile'}));
  cdp = await connectCDP(9367);
  await cdp.send('Page.enable');
  if(phase==='before') {
    const baseline=execFileSync('git',['show','07a643772:frontend/app/stationbake.js']);
    cdp.on('Fetch.requestPaused', p => cdp.send('Fetch.fulfillRequest',{requestId:p.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/javascript'}],body:baseline.toString('base64')}));
    await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*/app/stationbake.js*',requestStage:'Request'}]});
  }
  await cdp.send('Page.navigate',{url:'http://127.0.0.1:9197/'});
  for(let i=0;i<60;i++) { if(await evalJS(cdp,"typeof World !== 'undefined' && !!World.stationDoc()")) break; await sleep(250); }
  const results = await evalJS(cdp, `(() => {
    const results=[];
    for(const [w,h] of [[9,7],[14,9],[15,14],[18,18],[24,16],[12,24],[40,30]]) {
      const doc=WorldModel.defaultDoc(), room=doc.rooms[doc.order[0]];
      room.rects=[{x1:0,y1:0,x2:w-1,y2:h-1}];
      const geo=WorldModel.create(doc).projectGeometry(), bake=StationBake.bake(geo);
      const r=geo.allRects[0], ctx=bake.lightCv.getContext('2d');
      const sample=(fx,fy)=>{ const x=Math.floor((r.x1+w*fx)*12), y=Math.floor((r.y1+h*fy)*12); return 1-ctx.getImageData(x,y,1,1).data[3]/255; };
      const cv=document.createElement('canvas'); cv.width=bake.baseCv.width; cv.height=bake.baseCv.height;
      const c=cv.getContext('2d'); c.drawImage(bake.baseCv,0,0); c.drawImage(bake.lightCv,0,0);
      results.push({w,h,lamps:bake.lamps.length,source:sample(.5,1.6/14),sourceLeft:sample(.08,1.6/14),sourceRight:sample(.92,1.6/14),wall:sample(.5,-1/h),center:sample(.5,.5),top:sample(.5,.18),bottom:sample(.5,1-1.2/14),left:sample(.08,.5),right:sample(.92,.5),corner:sample(.08,.92),png:cv.toDataURL()});
    }
    return results;
  })()`);
  for(const r of results) { writeFileSync(`${out}/${phase}-${r.w}x${r.h}.png`,Buffer.from(r.png.split(',')[1],'base64')); delete r.png; }
  writeFileSync(`${out}/${phase}.json`,JSON.stringify(results,null,2));
  console.log(JSON.stringify(results));
  if(phase!=='before' && results.some(r=>r.source < Math.max(r.sourceLeft,r.sourceRight)+.2)) throw new Error('North source must remain brighter than side edges');
  if (phase !== 'before' && results.some(r => r.wall < .3)) throw new Error('North wall must retain illumination');
  if (phase !== 'before' && results.some(r => r.lamps !== 2 || r.bottom < .65)) throw new Error('Every room needs the reference top and bottom lights');
  await capture(cdp,out,phase+'-live');
  for(const scene of ['telescope','wood']) {
    await evalJS(cdp,`(() => {
      const doc=WorldModel.defaultDoc(), r=doc.rooms[doc.order[0]], wood=${scene === 'wood'};
      const w=wood?12:18,h=wood?18:14;
      r.rects=[{x1:0,y1:0,x2:w-1,y2:h-1}]; r.wallMat='viewport';
      if(wood) { r.floorMat='plank'; r.floorStyle='walnut'; }
      doc.props=[
        {id:'scope',t:wood?'arcade':'telescope',x:2,y:1,w:1,h:2},
        {id:'desk',t:'desk',x:Math.floor(w/2)-1,y:Math.floor(h/2)-1,w:2,h:2},
        {id:'plant',t:'plant',x:w-2,y:3,w:1,h:1},
        {id:'game',t:'arcade',x:2,y:h-3,w:1,h:2},
        {id:'lamp',t:'desklamp',x:w-3,y:h-3,w:1,h:1},
        {id:'screen',t:'screens',x:w-4,y:2,w:2,h:1}
      ];
      World.loadStation(WorldModel.create(doc)); World.rebake();
      return World.stationDoc();
    })()`);
    await sleep(1800);
    await capture(cdp,out,phase+'-'+scene);
  }
} finally { cdp?.ws.close(); proc?.kill(); }
