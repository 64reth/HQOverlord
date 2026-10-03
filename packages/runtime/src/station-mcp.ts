import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { ids } from '@hqoverlord/core';
import type { CommandContext } from './command-context.ts';
import type { DurableRuntime } from './durable-runtime.ts';
import type { ToolRegistry } from './tool-registry.ts';
const require=createRequire(import.meta.url);
export interface McpTransport {send(message:unknown):Promise<unknown>;onMessage(callback:(message:unknown)=>void):unknown;close():unknown;}
interface Client {initialize():Promise<unknown>;listTools():Promise<readonly unknown[]>;callTool(name:string,args:unknown,options:{signal?:AbortSignal}):Promise<unknown>;supports(what:string):boolean;listResources():Promise<Record<string,unknown>[]>;listResourceTemplates():Promise<Record<string,unknown>[]>;listPrompts():Promise<Record<string,unknown>[]>;request(method:string,params:unknown,options?:{signal?:AbortSignal}):Promise<unknown>;close():void;}
interface Definition {name:string;description:string;schema:Record<string,unknown>;run(input:unknown,context:unknown):Promise<unknown>;}
const clientModule=require('../vendor/starnet/sidecar/mcp/client.js') as {makeMcpClient(options:unknown):Client};
const translator=require('../vendor/starnet/sidecar/mcp/translate.js') as {makeMcpToolDef(options:unknown):Definition;connectorAuxDefs(options:unknown):Definition[]};
const httpModule=require('../vendor/starnet/sidecar/mcp/transport.http.js') as {makeHttpTransport(options:unknown):McpTransport};

/** Explicit host-controlled connection; initialization is never caused by model text. */
export function createMcpHttpTransport(options:{url:string;token?:string;fetchImpl?:typeof fetch}):McpTransport {
  const url=new URL(options.url);
  if(url.username||url.password||url.search||url.hash)throw new Error('MCP endpoint must not contain credentials or query parameters');
  return httpModule.makeHttpTransport({...options,timeoutMs:30_000});
}
export async function installMcpConnector(runtime:DurableRuntime,context:CommandContext,registry:ToolRegistry,id:string,transport:McpTransport,options:{readonly toolRoles?:Readonly<Record<string,"act"|"observe">>}={}){
  if(context.principal.kind!=='human'||!/^[a-zA-Z0-9_-]{1,24}$/.test(id))throw new Error('Connector installation requires a trusted human and a safe identifier');
  runtime.station(context); // authorize the business before contacting the configured host
  const client=clientModule.makeMcpClient({transport,timeoutMs:30_000,clientInfo:{name:'hqoverlord',version:'1'}});
  try{
    await client.initialize();const tools=await client.listTools();
    if(options.toolRoles&&Object.entries(options.toolRoles).some(([name,role])=>!["act","observe"].includes(role)||!tools.some(t=>(t as {name?:string}).name===name)))throw new Error("Verification role must name an actual published connector tool");
    if(tools.length>100)throw new Error('Connector tool catalog exceeds the host limit');
    let resources:Record<string,unknown>[]=[],prompts:Record<string,unknown>[]=[];
    // A broken optional listing is a partial catalog, not a broken tools connection (source manager semantics).
    if(client.supports('resources'))try{resources=[...await client.listResources(),...(await client.listResourceTemplates()).map(t=>({...t,isTemplate:true}))];}catch{resources=[];}
    if(client.supports('prompts'))try{prompts=await client.listPrompts();}catch{prompts=[];}
    if(resources.length>100||prompts.length>100||Buffer.byteLength(JSON.stringify({resources,prompts}))>256000)throw new Error('Connector resource/prompt catalog exceeds the host limit');
    const namespace=createHash('sha256').update(JSON.stringify([context.businessId,id])).digest('hex').slice(0,16);
    const definitions=tools.map(mcpTool=>translator.makeMcpToolDef({connectorId:namespace,label:id,mcpTool,call:(name:string,args:unknown,ctx:{signal?:AbortSignal})=>client.callTool(name,args,ctx)}));
    const originalNames=new Map(definitions.map((def,index)=>[def.name,(tools[index] as {name:string}).name]));
    const makeAux=(signal?:AbortSignal)=>translator.connectorAuxDefs({connectorId:namespace,label:id,listResources:resources.length?async()=>resources:undefined,readResource:resources.length?async(uri:string)=>{if(!resources.some(r=>r.uri===uri||typeof r.uriTemplate==='string'&&uri.startsWith(r.uriTemplate.split('{')[0]!)))throw new Error('Resource is not published by this connector');return client.request('resources/read',{uri},signal?{signal}:{});}:undefined,listPrompts:prompts.length?async()=>prompts:undefined,getPrompt:prompts.length?async(name:string,args:Record<string,string>)=>{if(!prompts.some(p=>p.name===name))throw new Error('Prompt is not published by this connector');return client.request('prompts/get',{name,...(args&&Object.keys(args).length?{arguments:args}:{})},signal?{signal}:{});}:undefined});
    const claimed=new Set(definitions.map(d=>d.name)),aux=makeAux().filter(d=>!claimed.has(d.name));definitions.push(...aux);
    const names=definitions.map(d=>ids.tool(d.name));
    if(new Set(names).size!==names.length||names.some(name=>registry.find(name)))throw new Error('Connector tool identities collide');
    // Catalog durability precedes grants. Placement is a separate human action.
    await runtime.installConnector(context,id,names);
    for(const def of definitions){const original=originalNames.get(def.name),role=original&&options.toolRoles?.[original];registry.register({...(original&&role?{connectorVerification:{connector:id,tool:original,role}}:{}),definition:{id:ids.tool(def.name),name:def.name,description:def.description,effect:'consequential'},inputSchema:def.schema,
      async execute(input,ctx){
        if(ctx.businessId!==context.businessId)throw new Error('Connector belongs to another business');
        ctx.signal?.throwIfAborted();
        const granted=runtime.effectiveAgent(context,ctx.agent.id);
        if(!granted.toolIds.includes(ids.tool(def.name)))throw new Error('Connector capability has been revoked');
        const actual=aux.some(a=>a.name===def.name)?makeAux(ctx.signal).find(a=>a.name===def.name)!:def;
        const result=await actual.run(input,{signal:ctx.signal});ctx.signal?.throwIfAborted();
        return {output:JSON.parse(JSON.stringify(result)) as unknown};
      }});}
    return {toolIds:names,close:()=>client.close()};
  }catch(error){client.close();throw error;}
}
