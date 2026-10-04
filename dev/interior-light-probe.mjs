import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
let proc, cdp;
try {
  ({proc} = launchChrome({cdpPort:9348, profileDir:'.worldshots/interior-light-profile'}));
  cdp = await connectCDP(9348);
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate',{url:'http://127.0.0.1:9177/'});
  for(let i=0;i<30;i++) {
    if(await evalJS(cdp,"typeof StationBake !== 'undefined' && typeof WorldModel !== 'undefined'")) break;
    await sleep(200);
  }
  const result = await evalJS(cdp,`(() => {
    const geo = WorldModel.create(WorldModel.starterDoc()).projectGeometry();
    const saved = {...StationBake.LIGHT};
    try {
      const lit = StationBake.bake(geo);
      for (const key of ['room','corridor','pool','door','warm','spill','crown']) StationBake.LIGHT[key] = 0;
      const dark = StationBake.bake(geo);
      const read = cv => cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
      const a=read(lit.lightCv), b=read(dark.lightCv), mask=read(lit.interiorCv);
      let exteriorChanges=0, interiorChanges=0, outsidePixels=0;
      for(let i=0;i<a.length;i+=4) {
        const diff=a[i]!==b[i] || a[i+1]!==b[i+1] || a[i+2]!==b[i+2] || a[i+3]!==b[i+3];
        if(!mask[i+3]) {outsidePixels++;if(diff)exteriorChanges++;}
        else if(diff)interiorChanges++;
      }
      const room=geo.allRects.find(r=>!geo.isCorridor(r.z)), tile=12;
      const x=Math.floor((room.x1+room.x2+1)*tile/2), y=room.y1*tile;
      const alpha=(px,py)=>mask[(py*lit.interiorCv.width+px)*4+3];
      const crownAlpha=alpha(x,y-Math.round(StationBake.WALL.up)-2);
      const shellAlpha=alpha(x,(room.y2+1)*tile+3);
      const faceAlpha=alpha(x,y-Math.round(StationBake.WALL.up)+2);
      const windowDoc=WorldModel.starterDoc();
      for(const room of Object.values(windowDoc.rooms)) room.wallMat='viewport';
      const windowGeo=WorldModel.create(windowDoc).projectGeometry();
      Object.assign(StationBake.LIGHT,saved);
      const windowBake=StationBake.bake(windowGeo), windowPixels=read(windowBake.lightCv);
      const paneX=room.x1*tile+tile*3+5, paneY=y-Math.round(StationBake.WALL.up)+8;
      const windowAlpha=windowPixels[(paneY*windowBake.lightCv.width+paneX)*4+3];
      return {exteriorChanges,interiorChanges,outsidePixels,crownAlpha,shellAlpha,faceAlpha,windowAlpha};
    } finally {Object.assign(StationBake.LIGHT,saved);}
  })()`);
  console.log(JSON.stringify(result));
  if(result.exteriorChanges!==0 || result.interiorChanges<100 || result.outsidePixels<100 || result.crownAlpha!==0 || result.shellAlpha!==0 || result.faceAlpha!==255 || result.windowAlpha!==0) throw new Error('Interior lighting isolation failed');
  console.log('interior-light-probe: OK');
} finally {try{cdp?.ws.close();}catch{} try{proc?.kill();}catch{}}
