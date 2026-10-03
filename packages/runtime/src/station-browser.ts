import * as fsp from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { ids } from '@hqoverlord/core';
import type { ToolRegistry } from './tool-registry.ts';
import type { ToolExecutionContext } from './execution-contracts.ts';
import { workspaceKey } from './station-tools.ts';
const require=createRequire(import.meta.url);
interface Tool {name:string;description:string;schema:Record<string,unknown>;scope:string;requiresConsent?:boolean;run(input:unknown,context:unknown):Promise<unknown>;}
interface Browser {tools:readonly Tool[];session:{close():Promise<void>};}
const browserModule=require('../vendor/starnet/tools/builtin/browser.js') as {makeBrowserTools(options:unknown):Browser};
export const publicBrowserTools=['browser.navigate','browser.snapshot','browser.find','browser.wait','browser.click','browser.type','browser.press','browser.scroll','browser.back','browser.forward','browser.get_text','browser.console','browser.network','browser.dialog','browser.hover','browser.drag','browser.select','browser.viewport','browser.tabs','browser.tab_select','browser.tab_close','browser.inspect','browser.eval','browser.intercept','browser.emulate','browser.screenshot','browser.vision','browser.pdf','browser.upload'];
/** Separate browser/profile/CDP endpoint per real execution, with persistent agent cookies. */
export function registerBrowserTools(registry:ToolRegistry,root:string,options:{workspaceRoot?:string;driverFor?:(context:ToolExecutionContext)=>unknown}={}){
  const sessions=new Map<string,{jobId:string;browser:Browser}>();
  const definitions=browserModule.makeBrowserTools({forceHeadless:true}).tools.filter(t=>publicBrowserTools.includes(t.name));
  for(const def of definitions)registry.register({definition:{id:ids.tool(def.name),name:def.name,description:def.description,effect:['browser.screenshot','browser.vision','browser.pdf'].includes(def.name)?'internal_write':def.requiresConsent||def.scope!=='read'?'consequential':'read_only'},inputSchema:def.schema,
    async execute(input,context){
      context.signal?.throwIfAborted();const key=workspaceKey(context),existing=sessions.get(key);
      // An agent's cookie profile is never shared by two independent executions.
      if(existing&&existing.jobId!==context.job.id)throw new Error('This agent browser belongs to another execution');
      let entry=existing;
      if(!entry){
        const browser=browserModule.makeBrowserTools({forceHeadless:true,allowVisible:false,cdpPort:0,profileDir:join(root,key),cleanupProfile:false,
          ...(options.workspaceRoot?{root:path.resolve(options.workspaceRoot),pathMod:path,fsp:{...fsp,async writeFile(file:string,bytes:Uint8Array){if(bytes.length>8*1024*1024)throw new Error('Browser capture exceeds 8MB');const temporary=file+'.'+randomUUID()+'.tmp';let handle;try{handle=await fsp.open(temporary,'wx');await handle.writeFile(bytes);await handle.sync();await handle.close();handle=undefined;await fsp.rename(temporary,file);if(!(await fsp.readFile(file)).equals(Buffer.from(bytes)))throw new Error('Browser capture readback failed');}finally{await handle?.close();await fsp.rm(temporary,{force:true});}}}}:{}),
          ...(options.driverFor?{driver:options.driverFor(context),lookup:null}:{})});
        entry={jobId:context.job.id,browser};sessions.set(key,entry);
        context.signal?.addEventListener('abort',()=>{void browser.session.close().finally(()=>sessions.delete(key));},{once:true});
      }
      if(def.name==='browser.vision'&&typeof (input as {question?:unknown})?.question==='string'&&(input as {question:string}).question.length>4000)throw new Error('Vision question exceeds 4000 characters');
      const result=await entry.browser.tools.find(t=>t.name===(def.name==='browser.vision'?'browser.screenshot':def.name))!.run(input,{agentId:key,runId:context.job.id,signal:context.signal});
      if(def.name==='browser.vision'){const shot=result as {content:string;summary:string};shot.content='Actual viewport pixels for the next accounted model turn; no visual answer has been produced yet.\nQuestion (reference data): '+JSON.stringify((input as {question?:unknown})?.question??'Describe what is actually visible.')+'\n'+shot.content;shot.summary='vision frame captured';}
      context.signal?.throwIfAborted();return {output:JSON.parse(JSON.stringify(result).split('/api/file?agent='+encodeURIComponent(key)).join('/api/file?business='+encodeURIComponent(context.businessId)+'&agent='+encodeURIComponent(context.agent.id))) as unknown};
    }});
  return {async release(jobId:string){for(const [key,entry]of sessions)if(entry.jobId===jobId){await entry.browser.session.close();sessions.delete(key);}},async close(){for(const entry of sessions.values())await entry.browser.session.close();sessions.clear();}};
}
