import {agentEquipment} from './station-state.ts';
import {createRequire} from 'node:module';
import {ids,type AgentId} from '@hqoverlord/core';
import type {CommandContext} from './command-context.ts';
import {commandId} from './command-context.ts';
import {correlationId} from '@hqoverlord/events';
import type {DurableRuntime} from './durable-runtime.ts';
import type {ExecutableTool} from './execution-contracts.ts';
import {memoryContext} from './station-memory.ts';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
interface BundledSkill {slug:string;name:string;description:string;body:string;requires:string[];}
const bundled=require('../vendor/starnet/sidecar/skills/catalog.js') as {loadDir(dir:string,fs:unknown,path:unknown):BundledSkill[];live(skills:BundledSkill[],options:unknown):BundledSkill[];composeIndex(skills:BundledSkill[],options:unknown):string;compose(skills:BundledSkill[],options:unknown):string;find(skills:BundledSkill[],name:string):BundledSkill|null;viewText(skill:BundledSkill):string};
export const bundledSkillCatalog=bundled.loadDir(fileURLToPath(new URL('../vendor/starnet/sidecar/skills/library',import.meta.url)),fs,path);
const runtimeSkills=require('../vendor/starnet/sidecar/skills/runtime.js') as {composeIndex(skills:Record<string,unknown>[],options:unknown):{text:string}};
export function offeredSkills(runtime:DurableRuntime,context:CommandContext,agentId:AgentId){const station=runtime.station(context),profile=station.profiles.find(p=>p.agentId===agentId);return bundled.live(bundledSkillCatalog,{placedTypes:agentEquipment(station,agentId).map(e=>e.kind),agentSkills:profile?.skills??[]});}
export function skillPrompt(runtime:DurableRuntime,context:CommandContext,agentId:AgentId,query:string){const station=runtime.station(context),agent=runtime.effectiveAgent(context,agentId),offered=offeredSkills(runtime,context,agentId),library=skillLibrary(station.skills??[],Date.parse(runtime.currentTime()));
 const own=agent.toolIds.includes(ids.tool('skill.view'))?runtimeSkills.composeIndex(library.list(agentId),{query,gate:(s:Record<string,unknown>)=>({visible:!memoryContext.flagInjection(String(s.body??''))})}).text:'';
 const offeredOptions={placedTypes:agentEquipment(station,agentId).map(e=>e.kind),agentSkills:offered.map(s=>s.slug)};return own+(agent.toolIds.includes(ids.tool('skill.view'))?bundled.composeIndex(offered,offeredOptions):bundled.compose(offered,offeredOptions));
}
export interface SkillLibrary {all():Record<string,unknown>[];list(agentId:string,options?:unknown):Record<string,unknown>[];view(agentId:string,id:string,options?:unknown):Record<string,unknown>|null;write(input:unknown):unknown;manage(input:unknown):unknown;markUsed(agentId:string,names:string[]):unknown;}
export function skillLibrary(records:readonly Record<string,unknown>[],now:number):SkillLibrary{
 const source=require('../vendor/starnet/sidecar/skillstore.js') as {makeSkillStore(options:unknown):SkillLibrary};
 return source.makeSkillStore({io:{readAll:()=>structuredClone(records),append:()=>{}},clock:{now:()=>now},redact:memoryContext.redact});
}
interface SourceTool {name:string;description:string;scope:string;schema:Record<string,unknown>;run(input:unknown,context:unknown):unknown;}
const toolSource=require('../vendor/starnet/tools/builtin/skills.js') as {makeSkillTools(options:unknown):{register(registry:{register(tool:SourceTool):void}):void}};
export function skillTools(runtime:DurableRuntime):readonly ExecutableTool[]{
 const definitions:SourceTool[]=[];toolSource.makeSkillTools({}).register({register:t=>definitions.push(t)});
 return definitions.map(source=>({definition:{id:ids.tool(source.name),name:source.name,description:source.description,effect:source.scope==='read'?'read_only':'internal_write'},inputSchema:source.schema,
  async execute(input,execution){const context:CommandContext={businessId:execution.businessId,commandId:commandId('skill:'+execution.job.id),correlationId:correlationId('job:'+execution.job.id),principal:{kind:'agent',id:execution.agent.id}};
   return {output:await runtime.useSkillLibrary(context,execution.agent.id,library=>{let tool:SourceTool|undefined;toolSource.makeSkillTools({store:{...library,view:(agentId:string,id:string,options?:Record<string,unknown>)=>library.view(agentId,id,{...options,bump:false})},onView:(s:Record<string,unknown>)=>library.markUsed(execution.agent.id,[String(s.id)]),bundled:(name:string)=>{const skill=bundled.find(offeredSkills(runtime,context,execution.agent.id),name);return skill?{name:skill.name,content:bundled.viewText(skill)}:null;},gate:{decide:()=>({visible:true}),verify:(s:Record<string,unknown>)=>({visible:!memoryContext.flagInjection(String(s.body??'')),reason:'reference boundary'})}}).register({register:t=>{if(t.name===source.name)tool=t;}});return tool!.run(input,{agentId:execution.agent.id,runId:execution.job.id});})};
  }}));
}
export async function manageSkill(runtime:DurableRuntime,context:CommandContext,agentId:AgentId,input:Record<string,unknown>){
 if(context.principal.kind!=='human')throw new Error('Operator required');return runtime.useSkillLibrary(context,agentId,store=>store.manage({...input,agentId,createdBy:'user'}));
}
