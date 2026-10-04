import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {launchChrome,connectCDP,evalJS,sleep} from '../scripts/lib/cdp.mjs';
let proc,cdp;
try{
  ({proc}=launchChrome({cdpPort:9352,profileDir:'.worldshots/junction-profile'}));cdp=await connectCDP(9352);
  await cdp.send('Page.enable');await cdp.send('Page.navigate',{url:'http://127.0.0.1:9177/'});
  for(let i=0;i<60;i++){if(await evalJS(cdp,"typeof StationBake!=='undefined'&&typeof WorldModel!=='undefined'"))break;await sleep(200);}
  const doc=JSON.parse(readFileSync('dev/.scratch-workspace/agent.save.json','utf8')).doc.station;
  const old=execFileSync('git',['show','14f7ac19a:frontend/app/stationbake.js'],{encoding:'utf8'});
  const result=await evalJS(cdp,`(()=>{
    const geo=WorldModel.create(${JSON.stringify(doc)}).projectGeometry();
    const prior=new Function(${JSON.stringify(old)}+';return StationBake;')();
    const a=prior.bake(geo),b=StationBake.bake(geo);
    const pixels=c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    const expected=[];
    for(const [ax,ay,bx,by] of geo.doorDefs){
      if(ax!==bx||by!==ay+1||!geo.isCorridor(geo.zoneGrid[geo.idx(ax,ay)])||geo.isCorridor(geo.zoneGrid[geo.idx(bx,by)]))continue;
      expected.push([ax*12-9,by*12-36,(ax+1)*12+9,by*12+11]);
    }
    let outsideChanges=0,totalChanges=0;
    for(const key of ['baseCv','lightCv']){
      const ap=pixels(a[key]),bp=pixels(b[key]);
      for(let i=0;i<ap.length;i+=4){
        if(ap[i]===bp[i]&&ap[i+1]===bp[i+1]&&ap[i+2]===bp[i+2]&&ap[i+3]===bp[i+3])continue;
        totalChanges++;const x=(i/4)%a[key].width,y=Math.floor(i/4/a[key].width);
        if(!expected.some(r=>x>=r[0]&&y>=r[1]&&x<r[2]&&y<r[3]))outsideChanges++;
      }
    }
    const matrix=[];
    for(const width of [1,2,3,4])for(const mat of ['bulkhead','viewport']){
      const d=WorldModel.starterDoc();d.rooms[d.meta.spawnRoomId].wallMat=mat;
      const s=WorldModel.create(d),placed=s.placeHallway({rect:{x1:5,y1:-8,x2:4+width,y2:-1}});
      if(!placed.ok)throw Error('Hallway fixture failed');
      const g=s.projectGeometry(),r=g.allRects.find(r=>g.isCorridor(r.z)),x=r.x1*12,Y=(r.y2+1)*12;
      const walkBefore=g.canStep(r.x1,r.y2,r.x1,r.y2+1);
      const before=prior.bake(g),after=StationBake.bake(g),bp=pixels(before.interiorCv),ap=pixels(after.interiorCv);
      const alpha=(p,px,py)=>p[(py*after.interiorCv.width+px)*4+3];
      const recovered=alpha(ap,x-3,Y-20),oldReceiver=alpha(bp,x-3,Y-20);
      const centre=Math.floor(x+width*6),centreAlpha=alpha(pixels(after.baseCv),centre,Y);
      const capAlpha=alpha(ap,x,Y-33),faceAlpha=alpha(ap,x,Y-20);
      matrix.push({width,mat,walkBefore,walkAfter:g.canStep(r.x1,r.y2,r.x1,r.y2+1),oldReceiver,recovered,capAlpha,faceAlpha,centreAlpha});
    }
    const render=bake=>{const b=bake.bake(geo),c=document.createElement('canvas');c.width=600;c.height=650;
      const g=c.getContext('2d');g.fillStyle='#0a111a';g.fillRect(0,0,c.width,c.height);g.imageSmoothingEnabled=false;g.scale(5,5);g.translate(-600,-550);g.drawImage(b.baseCv,0,0);g.drawImage(b.lightCv,0,0);return c.toDataURL().split(',')[1];};
    return {before:render(prior),after:render(StationBake),report:{outsideChanges,totalChanges,matrix}};
  })()`);
  for(const name of ['before','after'])writeFileSync('.worldshots/junction-'+name+'.png',Buffer.from(result[name],'base64'));
  console.log(JSON.stringify(result.report));
  if(result.report.outsideChanges||result.report.totalChanges<100||result.report.matrix.some(r=>!r.walkBefore||!r.walkAfter||r.oldReceiver!==0||r.recovered!==255||r.capAlpha!==0||r.faceAlpha!==255||r.centreAlpha!==255))throw Error('Junction geometry / lighting / traversal regression');
  console.log('junction-probe: OK; wrote before/after renders');
}finally{try{cdp?.ws.close();}catch{}try{proc?.kill();}catch{}}
process.exit(0);
