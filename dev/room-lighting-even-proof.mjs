import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {launchChrome,connectCDP,evalJS,sleep,capture} from '../scripts/lib/cdp.mjs';
const phase=process.argv[2] || 'after', out='.worldshots/even-lighting';
mkdirSync(out,{recursive:true});let proc,cdp;
try {
 ({proc}=launchChrome({cdpPort:9384,profileDir:out+'/profile'}));cdp=await connectCDP(9384);await cdp.send('Page.enable');await cdp.send('Page.navigate',{url:'http://127.0.0.1:9197/'});
 for(let i=0;i<100;i++){if(await evalJS(cdp,"typeof World!=='undefined'&&!!World.stationDoc()"))break;await sleep(150);}
 await capture(cdp,out,phase+'-live');
 const results=await evalJS(cdp,`(()=>{
   StationBake.LIGHT.ambient=.82;
   const results=[];
   for(const [w,h] of [[5,5],[9,7],[15,14],[24,8],[8,24],[24,16],[40,30],[60,12],[12,60]]){
     const doc=WorldModel.defaultDoc(),room=doc.rooms[doc.order[0]];
     room.rects=[{x1:0,y1:0,x2:w-1,y2:h-1}];room.wallMat='ribbed';
     const geo=WorldModel.create(doc).projectGeometry(),r=geo.allRects[0],b=StationBake.bake(geo),c=b.lightCv.getContext('2d');
     const sample=(fx,fy)=>1-c.getImageData(Math.floor((r.x1+w*fx)*12),Math.floor((r.y1+h*fy)*12),1,1).data[3]/255;
     const receiver=b.interiorCv.getContext('2d'), samples=[];
     for(let iy=0;iy<9;iy++)for(let ix=0;ix<9;ix++){
       const fx=.08+ix*.105,fy=.08+iy*.105;
       // Chamfered exterior corners are hull, not usable room floor.
       if(receiver.getImageData(Math.floor((r.x1+w*fx)*12),Math.floor((r.y1+h*fy)*12),1,1).data[3]<250)continue;
       samples.push(sample(fx,fy));
     }
     const min=Math.min(...samples),max=Math.max(...samples),mean=samples.reduce((a,b)=>a+b)/samples.length;
     const cv=document.createElement('canvas');cv.width=b.baseCv.width;cv.height=b.baseCv.height;const dc=cv.getContext('2d');dc.drawImage(b.baseCv,0,0);dc.drawImage(b.lightCv,0,0);
     results.push({w,h,min,max,mean,ratio:max/min,left:sample(.08,.5),right:sample(.92,.5),center:sample(.5,.5),wall:sample(.5,-1/h),lamps:b.lamps.length,png:cv.toDataURL()});
   }
   const shapes={
     L:[{x1:0,y1:0,x2:23,y2:7},{x1:0,y1:8,x2:7,y2:23}],
     U:[{x1:0,y1:0,x2:23,y2:7},{x1:0,y1:8,x2:7,y2:23},{x1:16,y1:8,x2:23,y2:23}],
     overlap:[{x1:0,y1:0,x2:15,y2:11},{x1:8,y1:0,x2:23,y2:11}]
   };
   for(const [shape,rects] of Object.entries(shapes)){
     const doc=WorldModel.defaultDoc(),room=doc.rooms[doc.order[0]];room.rects=rects;room.wallMat='ribbed';
     const geo=WorldModel.create(doc).projectGeometry(),b=StationBake.bake(geo),c=b.lightCv.getContext('2d'),receiver=b.interiorCv.getContext('2d');
     const points=[];for(let y=0;y<geo.ROWS;y++)for(let x=0;x<geo.COLS;x++){
       if(!geo.zoneGrid[geo.idx(x,y)])continue;
       const px=x*12+6,py=y*12+6;if(receiver.getImageData(px,py,1,1).data[3]<250)continue;
       points.push([px,py]);
     }
     const samples=points.map(([x,y])=>1-c.getImageData(x,y,1,1).data[3]/255);
     const min=Math.min(...samples),max=Math.max(...samples);
     const saved={...StationBake.LIGHT};Object.assign(StationBake.LIGHT,{pool:0,floor:0,warm:0,spill:0,crown:0});
     const diffuse=StationBake.bake(geo).lightCv.getContext('2d');Object.assign(StationBake.LIGHT,saved);
     const fill=points.map(([x,y])=>1-diffuse.getImageData(x,y,1,1).data[3]/255);
     results.push({shape,min,max,ratio:max/min,wall:1,lamps:b.lamps.length,diffuseRange:Math.max(...fill)-Math.min(...fill)});
   }
   return results;
 })()`);
 for(const r of results){if(r.png)writeFileSync(out+'/'+phase+'-'+r.w+'x'+r.h+'.png',Buffer.from(r.png.split(',')[1],'base64'));delete r.png;}
 writeFileSync(out+'/'+phase+'.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
 if(phase!=='before')for(const r of results){assert.ok(r.min>=.42,JSON.stringify(r)+' has a dark floor patch');assert.ok(r.ratio<=1.5,JSON.stringify(r)+' has uneven coverage');assert.ok(r.wall>=.35,JSON.stringify(r)+' loses wall illumination');if(r.shape)assert.ok(r.diffuseRange<=.035,JSON.stringify(r)+' stacks diffuse fill across rectangle seams');}
}finally{cdp?.ws.close();proc?.kill();}
