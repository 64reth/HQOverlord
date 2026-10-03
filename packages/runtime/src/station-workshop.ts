import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import type {JobId} from '@hqoverlord/core';
import type {DurableRuntime} from './durable-runtime.ts';
import type {CommandContext} from './command-context.ts';
import {workspaceKey} from './station-tools.ts';
const require=createRequire(import.meta.url);
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
interface CopiedFile {path:string;bytes:number;sha256:string;}
interface CopyReceipt {destination:string;exportPath:string;files:CopiedFile[];savedOnly:boolean;}
/** Source workshop decide/undo semantics, with business-owned destinations and hash-checked undo. */
export function createStationWorkshop(runtime:DurableRuntime,workspaceRoot:string,exportRoot:string){
 const source=require('../vendor/starnet/tools/builtin/fs.js') as {makeFsTools(options:unknown):{_internals:{resolveInside(agent:string,file:string):Promise<{abs:string;base:string}>}}};
 const jail=source.makeFsTools({fsp,pathMod:path,root:path.resolve(workspaceRoot)})._internals.resolveInside;
 const outputJail=source.makeFsTools({fsp,pathMod:path,root:path.resolve(exportRoot)})._internals.resolveInside;
 const leases=new Set<string>();
 function owned(context:CommandContext,jobId:JobId){
  if(context.principal.kind!=='human')throw new Error('Human workshop decision required');
  const job=runtime.inspectJob(context,jobId),draft=runtime.snapshot().artifacts?.find(a=>a.businessId===context.businessId&&a.jobId===jobId&&a.id.startsWith('nightshift:')&&a.producer==='hq.runtime'&&a.actor.kind!=='agent');
  if(job.status!=='completed'||!job.agentId||!draft)throw new Error('Completed owned Night Shift deliverable required');
  const dir=(draft.content as {workshopDir?:string}).workshopDir;
  if(!dir||!/^workshop\/[a-f0-9]{40}$/.test(dir))throw new Error('This draft has no captured workshop directory');
  return {job,dir,key:workspaceKey({businessId:context.businessId,agent:runtime.effectiveAgent(context,job.agentId)})};
 }
 async function bounded(abs:string,max:number){const stat=await fsp.lstat(abs);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max)throw new Error('Workshop member is not a bounded regular file');const bytes=await fsp.readFile(abs);if(bytes.length>max)throw new Error('Workshop member exceeds limit');return bytes;}
 const safe=(value:unknown):value is string=>typeof value==='string'&&value.length<=240&&/^[A-Za-z0-9_. -]+(?:\/[A-Za-z0-9_. -]+)*$/.test(value)&&value.split('/').every(p=>p!=='.'&&p!=='..'&&!p.endsWith('.')&&!p.endsWith(' '))&&value!=='deliverable.json';
 return {
  async keep(context:CommandContext,jobId:JobId):Promise<CopyReceipt>{
   const {job,dir,key}=owned(context,jobId),lease=JSON.stringify([context.businessId,jobId]);if(leases.has(lease))throw new Error('Workshop decision already active');leases.add(lease);
   try{
    const copies=(runtime.snapshot().artifacts??[]).filter(a=>a.businessId===context.businessId&&a.jobId===jobId&&a.id.startsWith('workshop-copy:'+jobId+':')&&a.actor.kind==='human'),latest=copies.at(-1),undone=latest&&(runtime.snapshot().artifacts??[]).some(a=>a.businessId===context.businessId&&a.id.startsWith('workshop-undo:'+jobId+':')&&(a.content as {copyReceiptId?:string}).copyReceiptId===latest.id),generation=copies.length+(latest&&!undone?0:1),receiptId='workshop-copy:'+jobId+':'+generation,old=latest&&!undone?latest:undefined,planId='workshop-copy-plan:'+jobId+':'+generation;
    if(old){const receipt=old.content as CopyReceipt;for(const file of receipt.files){if(!safe(file.path)||digest(await bounded((await outputJail(key,receipt.destination+'/'+file.path)).abs,8*1024*1024))!==file.sha256)throw new Error('The earlier kept copy changed or was undone; no copy was made');}return structuredClone(receipt);}
    if(runtime.snapshot().artifacts?.some(a=>a.businessId===context.businessId&&a.id===planId))throw new Error('Interrupted workshop copy requires inspection; no automatic replay');
    const manifest=JSON.parse((await bounded((await jail(key,dir+'/deliverable.json')).abs,65536)).toString('utf8')) as {v?:number;kind?:string;files?:{path?:unknown}[]};
    if(manifest.v!==1||!Array.isArray(manifest.files)||!manifest.files.length||manifest.files.length>100)throw new Error('A real v:1 deliverable manifest with 1–100 files is required');
    const files:CopiedFile[]=[],contents:Buffer[]=[];let total=0;
    for(const member of manifest.files){if(!safe(member.path)||files.some(f=>f.path===member.path))throw new Error('Invalid or duplicate workshop member');const bytes=await bounded((await jail(key,dir+'/'+member.path)).abs,8*1024*1024);total+=bytes.length;if(total>32*1024*1024)throw new Error('Workshop deliverable exceeds 32MB');files.push({path:member.path,bytes:bytes.length,sha256:digest(bytes)});contents.push(bytes);}
    const destination='deliverables/'+createHash('sha256').update(JSON.stringify([context.businessId,job.id,generation])).digest('hex').slice(0,40);
    const dest=(await outputJail(key,destination)).abs,receipt:CopyReceipt={destination,exportPath:dest,files,savedOnly:manifest.kind==='patch'};
    await runtime.createArtifact(context,{id:planId,jobId,category:'source',contentType:'application/json',content:receipt,sourceIds:[]});
    await fsp.mkdir(path.dirname(dest),{recursive:true});await fsp.mkdir(dest);
    for(let n=0;n<files.length;n++){const target=(await outputJail(key,destination+'/'+files[n]!.path)).abs;await fsp.mkdir(path.dirname(target),{recursive:true});const handle=await fsp.open(target,'wx',0o600);try{await handle.writeFile(contents[n]!);await handle.sync();}finally{await handle.close();}if(digest(await bounded(target,8*1024*1024))!==files[n]!.sha256)throw new Error('Workshop copy readback failed');}
    await runtime.createArtifact(context,{id:receiptId,jobId,category:'source',contentType:'application/json',content:receipt,sourceIds:[]});
    await runtime.reviewNightDraft(context,jobId,'keep','Copied proven files to '+destination+(receipt.savedOnly?'; patch saved only, not applied.':'.'));
    return receipt;
   }finally{leases.delete(lease);}
  },
  async undo(context:CommandContext,jobId:JobId){
   const {key}=owned(context,jobId),lease=JSON.stringify([context.businessId,jobId]);if(leases.has(lease))throw new Error('Workshop decision already active');leases.add(lease);
   try{
    const undoId='workshop-undo:'+jobId+':'+context.commandId,prior=runtime.snapshot().artifacts?.find(a=>a.businessId===context.businessId&&a.id===undoId&&a.actor.kind==='human');if(prior)return structuredClone(prior.content) as {destination:string;removed:string[];missing:{path:string;reason:string}[];copyReceiptId:string};
    const artifact=runtime.snapshot().artifacts?.findLast(a=>a.businessId===context.businessId&&a.jobId===jobId&&a.id.startsWith('workshop-copy:'+jobId+':')&&a.producer==='hq.runtime'&&a.actor.kind==='human');if(!artifact)throw new Error('No proven kept copy to undo');
    const receipt=artifact.content as CopyReceipt,removed:string[]=[],missing:{path:string;reason:string}[]=[];
    if(!/^deliverables\/[a-f0-9]{40}$/.test(receipt.destination))throw new Error('Invalid captured destination');
    for(const file of receipt.files){if(!safe(file.path))throw new Error('Invalid captured member');const abs=(await outputJail(key,receipt.destination+'/'+file.path)).abs;try{if(digest(await bounded(abs,8*1024*1024))!==file.sha256){missing.push({path:file.path,reason:'edited; retained'});continue;}await fsp.unlink(abs);try{await fsp.lstat(abs);missing.push({path:file.path,reason:'still present'});}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;removed.push(file.path);}}catch{missing.push({path:file.path,reason:'already gone or could not remove'});}}
    // Never recursively remove directories or reverse the keep-time learning decision.
    const result={copyReceiptId:artifact.id,destination:receipt.destination,removed,missing};await runtime.createArtifact(context,{id:undoId,jobId,category:'source',contentType:'application/json',content:result,sourceIds:[]});return result;
   }finally{leases.delete(lease);}
  }
 };
}
