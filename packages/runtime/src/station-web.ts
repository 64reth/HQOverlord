import {createRequire} from 'node:module';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import {ids} from '@hqoverlord/core';
import {publicWebUrl,isPublicAddress,pinnedRequest,WebReadError,type WebReadDependencies} from './web-read.ts';
import type {ExecutableTool,ToolExecutionContext} from './execution-contracts.ts';
import {workspaceKey} from './station-tools.ts';
import {memoryContext} from './station-memory.ts';
const require=createRequire(import.meta.url);
interface SourceWeb {requestTool:{description:string;schema:Record<string,unknown>;run(input:unknown,context:unknown):Promise<unknown>};webSearch(query:string,options:unknown):Promise<{source:string;results:unknown[]}>;}
export function pinnedWebFetch(deps:WebReadDependencies={}):typeof fetch{return async(raw,init)=>{
  const signal=init?.signal?AbortSignal.any([init.signal,AbortSignal.timeout(deps.timeoutMs??15000)]):AbortSignal.timeout(deps.timeoutMs??15000);
  const work=async()=>{const url=publicWebUrl(String(raw)),host=url.hostname.replace(/^\[|\]$/g,'');
    const addresses=isIP(host)?[{address:host,family:isIP(host)}]:await(deps.resolve??(h=>lookup(h,{all:true})))(host);
    if(!addresses.length||addresses.some(a=>!isPublicAddress(a.address)||isIP(a.address)!==a.family))throw new WebReadError('PRIVATE_TARGET');signal.throwIfAborted();
    const headers=Object.fromEntries(new Headers(init?.headers));if(Object.keys(headers).some(k=>['host','connection','content-length','transfer-encoding','accept-encoding'].includes(k)))throw new WebReadError('INVALID_HEADER');
    const body=init?.body;if(body!==undefined&&typeof body!=='string'&&!(body instanceof Uint8Array))throw new WebReadError('INVALID_BODY');
    const response=await(deps.request??pinnedRequest)(url,addresses[0]!,signal,deps.maxBytes??256000,{method:init?.method??'GET',headers,...(body?{body}:{})});
    if(response.body.byteLength>(deps.maxBytes??256000))throw new WebReadError('RESPONSE_TOO_LARGE');return new Response([204,205,304].includes(response.status)?null:Buffer.from(response.body),{status:response.status,headers:{'content-type':response.contentType,...(response.location?{location:response.location}:{})}});
  };
  try{return await Promise.race([work(),new Promise<never>((_r,reject)=>{if(signal.aborted)reject(new WebReadError('CANCELLED'));else signal.addEventListener('abort',()=>reject(new WebReadError('CANCELLED')),{once:true});})]);}catch(error){if(error instanceof WebReadError)throw error;throw new WebReadError(signal.aborted?'CANCELLED':'NETWORK_ERROR');}
};}
function sourceWeb(options:Record<string,unknown>):SourceWeb{return (require('../vendor/starnet/tools/builtin/web.js') as {makeWebTools(options:unknown):SourceWeb}).makeWebTools({lookup:null,agentFactory:()=>({close(){}}),...options});}
/** Source keyless Mojeek -> DDG HTML -> DDG Lite fallback. No hidden paid search generation. */
export function sourceSearch(deps:WebReadDependencies={}):SourceWeb{return sourceWeb({fetchImpl:pinnedWebFetch(deps)});}
export interface WebRequestDependencies extends WebReadDependencies {readonly root:string;readonly keyFor?:(context:ToolExecutionContext,origin:string,name:string)=>string|undefined;}
export function createWebRequestTool(deps:WebRequestDependencies):ExecutableTool{
  const fs=require('../vendor/starnet/tools/builtin/fs.js') as {makeFsTools(options:unknown):{_internals:{resolveInside(agent:string,path:string):Promise<{abs:string}>}}};
  const jail=fs.makeFsTools({fsp,pathMod:path,root:path.resolve(deps.root)})._internals.resolveInside;
  const prototype=sourceWeb({fetchImpl:pinnedWebFetch(deps)}).requestTool;
  return {definition:{id:ids.tool('web.request'),name:'web.request',description:prototype.description,effect:'consequential'},inputSchema:prototype.schema,
    async execute(input,context){context.signal?.throwIfAborted();const origin=publicWebUrl((input as {url:string}).url).origin,secretValues:string[]=[];
      const fetch=pinnedWebFetch(deps);
      const source=sourceWeb({fetchImpl:(url:string,init:RequestInit)=>{if(publicWebUrl(url).origin!==origin)throw new WebReadError('REQUEST_ORIGIN_CHANGED');return fetch(url,init);},surface:'interactive',resolveServiceKey:(name:string)=>{const value=deps.keyFor?.(context,origin,name);if(!value)return {ok:false,reason:'unknown'};secretValues.push(value);return {ok:true,value};},redact:(text:string)=>secretValues.reduce((t,key)=>t.split(key).join('[REDACTED]'),memoryContext.redact(text)),readWorkspaceFile:async(_agent:string,relative:string)=>{
        const {abs}=await jail(workspaceKey(context),relative),handle=await fsp.open(abs,'r');try{const stat=await handle.stat();if(!stat.isFile()||stat.size>20*1024*1024)throw new Error('Workspace upload exceeds 20MB');const data=await handle.readFile();if(data.length>20*1024*1024)throw new Error('Workspace upload exceeds 20MB');return data;}finally{await handle.close();}
      }});
      const output=await source.requestTool.run(input,{agentId:workspaceKey(context),signal:context.signal});context.signal?.throwIfAborted();return {output:JSON.parse(JSON.stringify(output))};
    }};
}
