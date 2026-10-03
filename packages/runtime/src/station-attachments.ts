import {createRequire} from 'node:module';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import * as crypto from 'node:crypto';
import type {AgentId} from '@hqoverlord/core';
import type {DurableRuntime} from './durable-runtime.ts';
import type {CommandContext} from './command-context.ts';
import {workspaceKey} from './station-tools.ts';
const require=createRequire(import.meta.url);
export interface StationAttachment {readonly id:string;readonly name:string;readonly path:string;readonly mediaType:string;readonly kind:'image'|'file';readonly size:number;}
interface AttachmentSource {saveAttachment(agent:string,name:string,dataUrl:string):Promise<StationAttachment&{ok:boolean;error?:string}>;expandUserAttachments(messages:readonly unknown[],agent:string):Promise<{role:string;content:unknown}[]>;}
/** The source atomic attachment store uses the same realpath jail and business/agent key as actual file tools. */
export function createStationAttachments(runtime:DurableRuntime,root:string){
  const fs=require('../vendor/starnet/tools/builtin/fs.js') as {makeFsTools(options:unknown):{_internals:{resolveInside(agent:string,path:string):Promise<{abs:string;base:string}>}}};
  const jail=fs.makeFsTools({fsp,pathMod:path,root:path.resolve(root)})._internals.resolveInside;
  const make=require('../vendor/starnet/sidecar/attachments.js') as (deps:unknown)=>AttachmentSource;
  const source=make({fsp,path,crypto,resolveInside:jail});
  const key=(context:CommandContext,agentId:AgentId)=>workspaceKey({businessId:context.businessId,agent:runtime.effectiveAgent(context,agentId)});
  return {
    async save(context:CommandContext,agentId:AgentId,name:string,mime:string,buffer:Uint8Array):Promise<StationAttachment>{
      if(!buffer.byteLength||buffer.byteLength>8*1024*1024)throw new Error('Attachment must contain 1 byte to 8MB');
      const result=await source.saveAttachment(key(context,agentId),name,'data:'+mime+';base64,'+Buffer.from(buffer).toString('base64'));
      if(!result.ok)throw new Error(result.error??'Attachment could not be stored');
      return {id:result.id,name:result.name,path:result.path,mediaType:result.mediaType,kind:result.kind,size:result.size};
    },
    async expand(context:CommandContext,agentId:AgentId,attachments:readonly StationAttachment[]){
      const owner=key(context,agentId);
      const safe=attachments.filter(a=>a&&/^\.attachments\/[a-zA-Z0-9-]+\.[a-z0-9]{1,8}$/.test(a.path));
      if(!safe.length)return [];
      return (await source.expandUserAttachments([{role:'user',content:'',attachments:safe}],owner))[0]!.content;
    },
  };
}
