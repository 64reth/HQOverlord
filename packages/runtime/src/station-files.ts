import {createRequire} from 'node:module';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import type {AgentId} from '@hqoverlord/core';
import type {DurableRuntime} from './durable-runtime.ts';
import type {CommandContext} from './command-context.ts';
import {workspaceKey} from './station-tools.ts';
const require=createRequire(import.meta.url);
/** Authenticated operator read through the exact same per-business/agent jail as the Cabinet. */
export function createStationFileReader(runtime:DurableRuntime,root:string){const jail=(require('../vendor/starnet/tools/builtin/fs.js') as {makeFsTools(options:unknown):{_internals:{resolveInside(agentId:string,relative:string):Promise<{abs:string}>}}}).makeFsTools({fsp,pathMod:path,root:path.resolve(root)})._internals;
 return async(context:CommandContext,agentId:AgentId,relative:string)=>{if(context.principal.kind!=='human')throw new Error('Operator required for file delivery');const agent=runtime.effectiveAgent(context,agentId),key=workspaceKey({businessId:context.businessId,agent});const {abs}=await jail.resolveInside(key,relative),handle=await fsp.open(abs,'r');try{const stat=await handle.stat();if(!stat.isFile()||stat.size>8*1024*1024)throw new Error('File exceeds the delivery limit');const bytes=await handle.readFile();if(bytes.length>8*1024*1024)throw new Error('File exceeds the delivery limit');const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));return {bytes,contentType:png?'image/png':bytes.subarray(0,5).toString()==='%PDF-'?'application/pdf':'application/octet-stream'};}finally{await handle.close();}};
}
