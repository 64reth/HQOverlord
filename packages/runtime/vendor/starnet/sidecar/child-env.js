'use strict';
// HQ adaptation of StarNet's child-env boundary. Helpers receive runtime paths,
// never the station's arbitrary environment or provider/channel credentials.
const names=['PATH','PATHEXT','SYSTEMROOT','WINDIR','COMSPEC','TEMP','TMP','TMPDIR','LANG','LC_ALL'];
function stationChildEnv(){const out={};for(const name of names)if(process.env[name])out[name]=process.env[name];return out;}
function guardChildProcess(cp){
  const out=Object.create(cp);
  for(const method of ['spawn','execFile','fork'])out[method]=function(...args){
    const at=args.findIndex((value,index)=>index>0&&value&&typeof value==='object'&&!Array.isArray(value));
    if(at>=0)args[at]=Object.assign({},args[at],{env:stationChildEnv(),windowsHide:true});
    else args.push({env:stationChildEnv(),windowsHide:true});
    return cp[method](...args);
  };
  out.spawnSync=function(file,args,options){return cp.spawnSync(file,args,Object.assign({},options,{env:stationChildEnv(),windowsHide:true}));};
  return out;
}
module.exports={stationChildEnv,guardChildProcess};
