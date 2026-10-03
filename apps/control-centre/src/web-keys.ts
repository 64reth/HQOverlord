import {readFile} from 'node:fs/promises';
import {publicWebUrl,type WebRequestDependencies} from '@hqoverlord/runtime';
/** Host-only key names, explicit business and API origins. Values never enter canonical station state. */
export async function loadWebKeys():Promise<NonNullable<WebRequestDependencies['keyFor']>>{
  const entries:unknown=process.env.HQ_WEB_KEYS_PATH?JSON.parse(await readFile(process.env.HQ_WEB_KEYS_PATH,'utf8')):[];
  if(!Array.isArray(entries)||entries.length>1000)throw new Error('Web key profiles must be an array');
  const profiles=entries.map(entry=>{
    if(!entry||typeof entry!=='object'||typeof entry.businessId!=='string'||!entry.businessId||typeof entry.name!=='string'||!/^[A-Z][A-Z0-9_]*$/.test(entry.name)||typeof entry.keyEnv!=='string'||!/^[A-Z][A-Z0-9_]*$/.test(entry.keyEnv)||!Array.isArray(entry.origins)||!entry.origins.length)throw new Error('Invalid host web key profile');
    const origins=entry.origins.map((origin:unknown)=>{if(typeof origin!=='string')throw new Error('Invalid service origin');const url=publicWebUrl(origin);if(url.protocol!=='https:'||url.origin!==origin)throw new Error('A service key origin must be an exact public HTTPS origin');return origin;});
    const value=process.env[entry.keyEnv];if(!value)throw new Error('Web key environment reference is missing');return {businessId:entry.businessId as string,name:entry.name as string,origins,value};
  });
  if(new Set(profiles.map(p=>JSON.stringify([p.businessId,p.name]))).size!==profiles.length)throw new Error('Duplicate business web key name');
  return (context,origin,name)=>profiles.find(p=>p.businessId===context.businessId&&p.name===name&&p.origins.includes(origin))?.value;
}
