import {launchChrome,connectCDP,evalJS,capture,sleep} from '../scripts/lib/cdp.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const out='.worldshots/room-lighting';let proc,cdp;
try {
 ({proc}=launchChrome({cdpPort:9378,profileDir:out+'/reference-profile'}));cdp=await connectCDP(9378);await cdp.send('Page.enable');await cdp.send('Page.navigate',{url:'http://127.0.0.1:9197/'});
 for(let i=0;i<60;i++){if(await evalJS(cdp,"typeof World!=='undefined'&&!!World.stationDoc()"))break;await sleep(250);}
 const st=JSON.parse(readFileSync(out+'/reference-station.json','utf8'));
 await evalJS(cdp,`World.loadStation(WorldModel.create(${JSON.stringify(st)}));World.rebake();true`);
 const bake=(name='StationBake')=>evalJS(cdp,`(()=>{const b=${name}.bake(WorldModel.create(${JSON.stringify(st)}).projectGeometry());return {light:b.lightCv.toDataURL(),base:b.baseCv.toDataURL(),lamps:b.lamps};})()`);
 // Compare fresh renderer instances on the same immutable geometry. The live
 // renderer has a pre-existing quantized shade cache populated by earlier rooms.
 // Its floor colors can differ slightly with bake history; lightmaps must not.
 const production=await bake();
 await evalJS(cdp,readFileSync('frontend/app/stationbake.js','utf8').replace('const StationBake =','window.CandidateBake =')+'\ntrue');
 const current=await bake('CandidateBake');
 await evalJS(cdp,execFileSync('git',['show','07a643772:frontend/app/stationbake.js'],{encoding:'utf8'}).replace('const StationBake =', 'window.ReferenceBake =').replace('ambient: 0.84', 'ambient: 0.82')+'\ntrue');
 const original=await bake('ReferenceBake');
 const result={baseline:'fresh renderer caches, same frozen reference geometry, original ambient adjusted 0.84 to 0.82',productionLightmapIdentical:production.light===current.light,lightmapIdentical:current.light===original.light,baseIdentical:current.base===original.base,lamps:current.lamps};
 writeFileSync(out+'/reference-parity.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 await evalJS(cdp,'World.rebake();true');
 await capture(cdp,out,'reference-restored');
 if(!result.productionLightmapIdentical||!result.lightmapIdentical||!result.baseIdentical)throw Error('Reference lighting differs from original renderer');
}finally{cdp?.ws.close();proc?.kill();}
