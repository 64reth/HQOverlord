import { readFile } from 'node:fs/promises';
import { installMcpConnector, createMcpHttpTransport, type DurableRuntime, type CommandContext, type ToolRegistry } from '@hqoverlord/runtime';
/** Connections are selected by explicit host configuration, never an agent URL. */
export async function startMcpHosts(runtime:DurableRuntime,context:CommandContext,registry:ToolRegistry,options:{profilesPath?:string;makeTransport?:typeof createMcpHttpTransport}={}){
  const handles=new Map<string,Awaited<ReturnType<typeof installMcpConnector>>>(),pending=new Map<string,Promise<unknown>>();let closed=false;
  const file=options.profilesPath??process.env.HQ_MCP_PROFILES_PATH;
  const configs=file?JSON.parse(await readFile(file,'utf8')):[];
  if(!Array.isArray(configs))throw new Error('MCP profiles must be an array');
  if(configs.length>100||new Set(configs.map(c=>c?.id)).size!==configs.length)throw new Error('Invalid MCP catalog');
  for(const c of configs){
    if(!c||typeof c.id!=='string'||!/^[a-zA-Z0-9_-]{1,24}$/.test(c.id)||typeof c.url!=='string'||c.enabled!==undefined&&typeof c.enabled!=='boolean'||c.tokenEnv!==undefined&&(!/^[A-Z][A-Z0-9_]*$/.test(c.tokenEnv)||!process.env[c.tokenEnv]))throw new Error('Invalid host MCP configuration');
    const url=new URL(c.url);if(url.username||url.password||url.search||url.hash||!['http:','https:'].includes(url.protocol)||url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('MCP requires HTTPS or explicit loopback');
  }
  const catalog=()=>configs.map(c=>({id:c.id,url:c.url,state:handles.has(c.id)?'connected':pending.has(c.id)?'connecting':'not connected',toolCount:handles.get(c.id)?.toolIds.length??0}));
  const install=async(c:CommandContext,id:string)=>{
    if(closed||c.principal.kind!=='human'||c.businessId!==context.businessId)throw new Error('Owned human connector installation required');
    const profile=configs.find(p=>p.id===id);if(!profile)throw new Error('Choose a host-configured connector');
    if(handles.has(id))return catalog().find(p=>p.id===id);
    const prior=pending.get(id);if(prior)return prior;
    const attempt=(async()=>{const handle=await installMcpConnector(runtime,c,registry,id,(options.makeTransport??createMcpHttpTransport)({url:profile.url,...(profile.tokenEnv?{token:process.env[profile.tokenEnv]!}:{})}),{...(profile.toolRoles?{toolRoles:profile.toolRoles}:{})});if(closed){handle.close();throw new Error('Connector host closed during installation');}handles.set(id,handle);return catalog().find(p=>p.id===id);})();pending.set(id,attempt);
    try{return await attempt;}finally{pending.delete(id);}
  };
  try{
    for(const c of configs){
      if(c.enabled!==false||runtime.station(context).connectors?.some(p=>p.id===c.id))await install(context,c.id);
    }
    return {catalog,install,close(){closed=true;for(const handle of handles.values())handle.close();}};
  }catch(error){closed=true;for(const handle of handles.values())handle.close();throw error;}
}
