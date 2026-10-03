import { readFile } from "node:fs/promises";
import { ChannelHost, type CommandContext, type DurableRuntime, type ExecutionResult, type createStationAttachments } from "@hqoverlord/runtime";
import type { JobId } from "@hqoverlord/core";

/** Host-only credentials. The browser/canonical station stores bindings, never tokens. */
export async function startChannelHosts(runtime:DurableRuntime, context:CommandContext,
  execute:(context:CommandContext,id:JobId)=>Promise<ExecutionResult>,notify:()=>void=()=>{},attachments?:ReturnType<typeof createStationAttachments>,models:readonly {provider:string;model:string}[]|(()=>readonly {provider:string;model:string}[])=[]) {
  const hosts=new Map<string,{binding:string;host:ChannelHost}>(),states=new Map<string,string>();
  const configs:Record<string,Record<string,string>>=process.env.HQ_CHANNEL_PROFILES_PATH
    ?JSON.parse(await readFile(process.env.HQ_CHANNEL_PROFILES_PATH,"utf8")):{};
  if(!configs||Array.isArray(configs)||typeof configs!=='object')throw new Error('Channel profiles must be an object keyed by binding id');
  const fields=new Set(['tokenEnv','botTokenEnv','appTokenEnv','accountEnv','homeserver','endpoint','apiBase']);
  const transports=new Map<string,Record<string,string>>();
  for(const [id,config] of Object.entries(configs)){
    if(!config||typeof config!=='object'||Array.isArray(config))throw new Error('Invalid host channel profile');
    const transport:Record<string,string>={};
    for(const [field,value] of Object.entries(config)){
      if(!fields.has(field)||typeof value!=='string'||!value.trim())throw new Error('Invalid host channel profile field');
      if(field.endsWith('Env')){
        if(!/^[A-Z][A-Z0-9_]*$/.test(value)||!process.env[value])throw new Error('Channel credential environment variable is missing');
        transport[field.slice(0,-3)]=process.env[value]!;
      }else{
        const url=new URL(value);
        if(url.username||url.password||url.search||url.hash||!(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new Error('Channel endpoint must use HTTPS or loopback HTTP');
        transport[field]=value;
      }
    }
    transports.set(id,transport);
  }
  let closed=false,reconciling=false;
  function reconcile(){
    if(closed||reconciling)return;reconciling=true;
    try{
      const channels=runtime.station(context).channels??[];
      for(const [id,entry] of hosts){
        const config=channels.find(c=>c.id===id);
        if(!config?.enabled||JSON.stringify(config)!==entry.binding){entry.host.disconnect();hosts.delete(id);}
      }
      for(const config of channels){
        if(!config.enabled||hosts.has(config.id))continue;
        const transportOptions=transports.get(config.id);
        if(!transportOptions){states.set(config.id,'Host credentials not configured');continue;}
        try{
          states.set(config.id,'connecting');notify();
          const host=new ChannelHost({runtime,context,id:config.id,execute,models,transportOptions,...(attachments?{saveAttachment:attachments.save}:{}),onStatus:state=>{states.set(config.id,state);notify();}});
          hosts.set(config.id,{binding:JSON.stringify(config),host});host.connect();
        }catch{states.set(config.id,'Configuration error');}
      }
    }finally{reconciling=false;}
  }
  const unsubscribe=runtime.subscribe(reconcile);reconcile();
  const targets=(command:CommandContext)=>{if(command.businessId!==context.businessId)return [];const station=runtime.station(command),known=new Map<string,Record<string,unknown>>();for(const message of station.channelMessages??[]){const config=station.channels?.find(c=>c.id===message.channelId&&c.enabled&&c.ownerUserId===message.userId&&c.allowedChats.includes(message.chatId));if(!config)continue;const target=JSON.stringify([config.id,message.chatId,message.threadId??null]);known.set(target,{target,channel:config.kind,channelId:config.id,chatId:message.chatId,threadId:message.threadId,agentId:message.agentId,connected:states.get(config.id)==='up'||states.get(config.id)==='connected'});}return [...known.values()];};
  const resolve=(command:CommandContext,target:string)=>{const owned=targets(command).find(t=>t.target===target);if(!owned)throw new Error('Unknown business channel target');const live=hosts.get(owned.channelId as string)?.host;if(!live)throw new Error('Channel is not connected');return {owned,live};};
  return {targets,async send(command:CommandContext,target:string,text:string,signal?:AbortSignal){const {owned,live}=resolve(command,target);return live.sendExternal(command,owned.chatId as string,owned.threadId as string|undefined,text,signal);},async media(command:CommandContext,target:string,item:unknown,signal?:AbortSignal){const {owned,live}=resolve(command,target);return live.sendExternalMedia(command,owned.chatId as string,owned.threadId as string|undefined,item,signal);},status:()=>[...states].map(([id,state])=>({id,state})),close(){closed=true;unsubscribe();for(const {host} of hosts.values())host.disconnect();hosts.clear();}};
}
