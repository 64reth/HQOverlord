import {createRequire} from 'node:module';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import {ids} from '@hqoverlord/core';
import {commandId,type CommandContext} from './command-context.ts';
import {correlationId} from '@hqoverlord/events';
import type {DurableRuntime} from './durable-runtime.ts';
import type {ToolRegistry} from './tool-registry.ts';
import type {ToolExecutionContext} from './execution-contracts.ts';
import {workspaceKey} from './station-tools.ts';
import {memoryContext} from './station-memory.ts';
const require=createRequire(import.meta.url);
export interface CommsBroker{targets(context:CommandContext):readonly Record<string,unknown>[];send(context:CommandContext,target:string,text:string,signal?:AbortSignal):Promise<unknown>;media(context:CommandContext,target:string,item:unknown,signal?:AbortSignal):Promise<unknown>;}
interface SourceTool{name:string;description:string;schema:Readonly<Record<string,unknown>>;run(input:unknown,context:unknown):Promise<unknown>;}
export function registerCommsTools(runtime:DurableRuntime,registry:ToolRegistry,root:string,broker:()=>CommsBroker|undefined){
 const source=require('../vendor/starnet/tools/builtin/comms.js') as {makeCommsTools(deps:unknown):{targetsTool:SourceTool;sendTool:SourceTool}},jail=(require('../vendor/starnet/tools/builtin/fs.js') as {makeFsTools(deps:unknown):{_internals:{resolveInside(agent:string,relative:string):Promise<{abs:string}>}}}).makeFsTools({fsp,pathMod:path,root:path.resolve(root)})._internals;
 const context=(c:ToolExecutionContext):CommandContext=>({businessId:c.businessId,commandId:commandId('comms-tool:'+c.job.id),correlationId:correlationId(c.job.id),principal:{kind:'agent',id:c.agent.id}});
 const toolsFor=(c:ToolExecutionContext)=>{const command=context(c),live=broker(),key=workspaceKey(c);return source.makeCommsTools({listTargets:()=>live?.targets(command)??[],redact:memoryContext.redact,maxLenFor:(kind:string)=>kind==='telegram'?4096:kind==='discord'?2000:kind==='slack'?3900:4000,sendTo:(target:string,text:string)=>{c.signal?.throwIfAborted();if(!live)throw new Error('Channels are not connected');return live.send(command,target,text,c.signal);},sendMediaTo:(target:string,item:unknown)=>{c.signal?.throwIfAborted();if(!live)throw new Error('Channels are not connected');return live.media(command,target,item,c.signal);},readFile:async(_agent:string,relative:string)=>{const {abs}=await jail.resolveInside(key,relative),handle=await fsp.open(abs,'r');try{const stat=await handle.stat();if(!stat.isFile()||stat.size>50*1024*1024)throw new Error('File exceeds 50MB');const buffer=await handle.readFile();if(!buffer.length||buffer.length>50*1024*1024)throw new Error('File is empty or exceeds 50MB');c.signal?.throwIfAborted();const extension=path.extname(abs).toLowerCase(),mime=({'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.pdf':'application/pdf','.mp4':'video/mp4','.mp3':'audio/mpeg','.ogg':'audio/ogg'} as Record<string,string>)[extension]??'application/octet-stream';return {ok:true,buffer,name:path.basename(abs),mime};}finally{await handle.close();}}});};
 for(const name of ['targetsTool','sendTool'] as const){const sample=source.makeCommsTools({})[name];registry.register({definition:{id:ids.tool(sample.name),name:sample.name,description:sample.description,effect:name==='targetsTool'?'read_only':'consequential'},inputSchema:sample.schema,async execute(input,c){runtime.effectiveAgent(context(c),c.agent.id);c.signal?.throwIfAborted();const output=await toolsFor(c)[name].run(input,{agentId:workspaceKey(c),signal:c.signal});return {output:JSON.parse(JSON.stringify(output))};}});}
}
