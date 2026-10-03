import {validateStandingLoops,type StandingLoop} from './station-loops.ts';
import type { Agent, AgentId, BusinessId, ToolId, Money } from "@hqoverlord/core";
import type { DurableState } from "./durable-state.ts";
import { ids } from "@hqoverlord/core";
import { RuntimeError } from "./runtime-error.ts";
import { validateFloorGeometry, type FloorWorkflow,type FloorWorkItem } from "./floor-workflow.ts";
import { validateRoutineState, type RoutineState } from "./station-routines.ts";
import { validateChannels, type ChannelConfig, type ChannelMessage } from "./station-channels.ts";
import { publicBrowserTools } from './station-browser.ts';
import type {FloorJoin} from './floor-joins.ts';

/** Backend floor facts, not a second browser-owned roster. Assigned rooms are business-owned; legacy desks use the shared office. */
export interface StationState {
  readonly workstreams?:readonly {readonly id:string;readonly title:string;readonly agentId:AgentId;readonly archived:boolean;readonly lane:'todo'|'active'|'shipped';readonly jobIds:readonly import('@hqoverlord/core').JobId[]}[];
  readonly loops?:readonly StandingLoop[];
  readonly rooms?:readonly {readonly id:string;readonly name:string}[];
  readonly joins?:readonly FloorJoin[];
  readonly workItems?:readonly FloorWorkItem[];
  readonly specialties?:readonly Record<string,unknown>[];
  readonly skills?:readonly Record<string,unknown>[];
  readonly connectors?: readonly {readonly id:string;readonly toolIds:readonly ToolId[]}[];
  readonly workflows?: readonly FloorWorkflow[];
  readonly routineState?: RoutineState;
  readonly channels?: readonly ChannelConfig[];
  readonly channelMessages?: readonly ChannelMessage[];
  readonly channelCursors?:readonly {readonly channelId:string;readonly value:string}[];
  readonly channelChats?:readonly {readonly channelId:string;readonly chatId:string;readonly threadId?:string;readonly agentId?:AgentId;readonly approvals:boolean;readonly requireMention?:boolean;readonly observeUnmentioned?:boolean}[];
  readonly businessId: BusinessId;
  readonly profiles: readonly AgentProfile[];
  readonly desks: readonly { readonly agentId: AgentId; readonly x: number; readonly y: number;readonly roomId?:string }[];
  readonly equipment: readonly { readonly id: string; readonly kind: EquipmentKind; readonly enabled: boolean; readonly x: number; readonly y: number;readonly roomId?:string }[];
  readonly notebooks: readonly { readonly agentId: AgentId; readonly key: string; readonly text: string; readonly updatedAt: string; readonly revision: number; readonly record?:Readonly<Record<string,unknown>> }[];
}
export interface AgentProfile {
  readonly skills?:readonly string[];
  readonly reasoningEffort?:string;
  readonly budget?:Money;
  readonly agentId: AgentId;
  readonly instructions: string;
  readonly personality: string;
  readonly model?: { readonly provider: string; readonly model: string;readonly reasoningEffort?:string };
}
export type EquipmentKind = "dish" | "cabinet" | "workbench" | "notebook" | "connector" | "computer";
/** Only implemented tools belong here. Adding scenery never implicitly installs a tool. */
export const equipmentTools: Readonly<Record<EquipmentKind, readonly ToolId[]>> = {
  dish: [ids.tool("channel.targets"),ids.tool("channel.send"),ids.tool("web.read"),ids.tool('web.search'),ids.tool('web.request'),...publicBrowserTools.map(ids.tool)], cabinet: ["fs.read","fs.write","fs.list","fs.append","fs.edit","fs.patch","fs.search"].map(ids.tool), workbench: [ids.tool("code.run")],
  notebook: ["notebook.read","notebook.write","notebook.feedback","skill.list","skill.view","skill.write","skill.manage"].map(ids.tool),
  connector: [],
  computer: [ids.tool('tool.search'),ids.tool('code.run')],
};
export function agentEquipment(station:StationState,agentId:AgentId){const room=station.desks.find(d=>d.agentId===agentId)?.roomId;return station.equipment.filter(e=>e.enabled&&e.roomId===room);}
export function agentStationTools(station:StationState,agentId:AgentId){return agentEquipment(station,agentId).flatMap(e=>e.kind==='connector'?station.connectors?.find(c=>c.id===e.id)?.toolIds??[]:equipmentTools[e.kind]);}
export function initialStation(businessId: BusinessId, agents: readonly Agent[]): StationState {
  const crew = agents.filter(a => a.businessId === businessId);
  return { businessId, profiles: crew.map(a => ({ agentId: a.id, instructions: "", personality: "" })),
    desks: crew.filter(a => a.status !== "retired").map((a, i) => ({ agentId: a.id, x: 190 + i % 3 * 285, y: 205 + Math.floor(i / 3) * 220 })), equipment: [], notebooks: [] };
}
export function stationIn(state: DurableState, businessId: BusinessId): StationState {
  return state.stations?.find(s => s.businessId === businessId) ?? initialStation(businessId, state.authority.agents);
}
export function validateStations(state: DurableState): void {
  const seen = new Set<string>();
  const refuse = () => { throw new RuntimeError("INVALID_STATE", "Invalid durable station state"); };
  for (const station of state.stations ?? []) {
    if (seen.has(station.businessId) || !state.authority.businesses.some(b => b.id === station.businessId)) refuse();
    seen.add(station.businessId);
    if(station.loops)validateStandingLoops(station.loops,state,station.businessId);
    if(station.rooms&&(!Array.isArray(station.rooms)||station.rooms.length>100||new Set(station.rooms.map(r=>r.id)).size!==station.rooms.length||station.rooms.some(r=>!r||typeof r.id!=='string'||!r.id.trim()||r.id.length>100||typeof r.name!=='string'||!r.name.trim()||r.name.length>200)))refuse();
    const room=(id:string|undefined)=>id===undefined||!!station.rooms?.some(r=>r.id===id);
    if(station.connectors){
      if(!Array.isArray(station.connectors)||new Set(station.connectors.map(c=>c.id)).size!==station.connectors.length)refuse();
      for(const c of station.connectors)if(!c||typeof c.id!=='string'||!c.id.trim()||!Array.isArray(c.toolIds)||c.toolIds.some((id:unknown)=>typeof id!=='string'||!id.startsWith('mcp__')))refuse();
    }
    if(station.routineState)validateRoutineState(station.routineState,state,station.businessId);
    validateChannels(station.channels??[],station.channelMessages??[],state,station.businessId);
    if(station.channelCursors&&(!Array.isArray(station.channelCursors)||new Set(station.channelCursors.map(c=>c.channelId)).size!==station.channelCursors.length||station.channelCursors.some(c=>!station.channels?.some(config=>config.id===c.channelId)||typeof c.value!=='string'||c.value.length>4000)))refuse();
    if(station.channelChats&&(!Array.isArray(station.channelChats)||new Set(station.channelChats.map(c=>JSON.stringify([c.channelId,c.chatId,c.threadId]))).size!==station.channelChats.length||station.channelChats.some(c=>!station.channels?.some(config=>config.id===c.channelId&&config.allowedChats.includes(c.chatId))||typeof c.approvals!=='boolean'||c.requireMention!==undefined&&typeof c.requireMention!=='boolean'||c.observeUnmentioned!==undefined&&typeof c.observeUnmentioned!=='boolean'||c.requireMention===false&&c.observeUnmentioned===true||c.agentId&&!state.authority.agents.some(a=>a.id===c.agentId&&a.businessId===station.businessId)||c.threadId!==undefined&&(typeof c.threadId!=='string'||c.threadId.length>200))))refuse();
    const agent = (id: string) => state.authority.agents.some(a => a.id === id && a.businessId === station.businessId);
    if(station.workstreams&&(!Array.isArray(station.workstreams)||station.workstreams.length>1000||new Set(station.workstreams.map(w=>w.id)).size!==station.workstreams.length||station.workstreams.some(w=>!w||typeof w.id!=='string'||!w.id.trim()||w.id.length>200||typeof w.title!=='string'||!w.title.trim()||w.title.length>80||!agent(w.agentId)||typeof w.archived!=='boolean'||!['todo','active','shipped'].includes(w.lane)||!Array.isArray(w.jobIds)||new Set(w.jobIds).size!==w.jobIds.length||w.jobIds.some((id:import('@hqoverlord/core').JobId)=>!state.authority.jobs.some(j=>j.id===id&&j.businessId===station.businessId&&j.agentId===w.agentId)))))refuse();
    if(station.skills){if(!Array.isArray(station.skills)||station.skills.length>10000||Buffer.byteLength(JSON.stringify(station.skills))>16_000_000)refuse();for(const skill of station.skills)if(typeof skill.agentId!=='string'||!agent(skill.agentId)||typeof skill.name!=='string'||typeof skill.body!=='string'||skill.body.length>256000)refuse();}
    const workflows=station.workflows??[];
    if(station.joins){if(!Array.isArray(station.joins)||new Set(station.joins.map(j=>j.id)).size!==station.joins.length)refuse();for(const j of station.joins)if(!workflows.some(w=>w.id===j.workflowId)||!Number.isSafeInteger(j.expected)||j.expected<1||j.expected>100||!Number.isFinite(Date.parse(j.expiresAt))||!['waiting','released','timed_out','cancelled','interrupted'].includes(j.status)||!Array.isArray(j.parts)||j.parts.some((p:FloorJoin["parts"][number])=>!state.authority.jobs.some(job=>job.id===p.jobId&&job.agentId===p.agentId&&job.businessId===station.businessId)||typeof p.text!=='string'||p.text.length>1000000))refuse();}
    if(station.workItems){if(!Array.isArray(station.workItems)||new Set(station.workItems.map(w=>w.id)).size!==station.workItems.length)refuse();for(const w of station.workItems)if(!workflows.some(f=>f.id===w.workflowId)||!state.authority.jobs.some(j=>j.id===w.jobId&&j.agentId===w.agentId&&j.businessId===station.businessId)||!['placed','working','delivered','stopped','interrupted'].includes(w.state)||!Number.isFinite(Date.parse(w.updatedAt))||w.beltPath&&(!Array.isArray(w.beltPath)||w.beltPath.length>4096||w.beltPath.some((p:{x:number;y:number})=>!Number.isSafeInteger(p.x)||!Number.isSafeInteger(p.y)||p.x<0||p.y<0||p.x>1000||p.y>1000)))refuse();}
    if(!Array.isArray(workflows)||new Set(workflows.map(w=>w.id)).size!==workflows.length)refuse();
    for(const w of workflows){
      if(typeof w.id!=="string"||!w.id.trim()||typeof w.name!=="string"||!w.name.trim()||!w.roundRobin||Object.values(w.roundRobin).some(n=>typeof n!=="number"||!Number.isSafeInteger(n)||n<0))refuse();
      try {validateFloorGeometry(w.geometry);}catch {refuse();}
      for(const p of w.geometry.props)if(p.agentId&&!agent(p.agentId))refuse();
    }
    const unique = (items: readonly unknown[], keys: readonly string[]) => { if (!Array.isArray(items) || new Set(keys).size !== keys.length) refuse(); };
    if(![station.profiles,station.desks,station.equipment,station.notebooks].every(Array.isArray))refuse();
    unique(station.profiles, station.profiles.map(p => p.agentId)); unique(station.desks, station.desks.map(d => d.agentId));
    unique(station.equipment, station.equipment.map(e => e.id)); unique(station.notebooks, station.notebooks.map(n => JSON.stringify([n.agentId,n.key])));
    if(station.specialties&&(!Array.isArray(station.specialties)||station.specialties.length>100||station.specialties.some(s=>typeof s.id!=='string'||!s.id.startsWith('custom-')||typeof s.name!=='string'||typeof s.purpose!=='string'||typeof s.manual!=='string')))refuse();
    for(const p of station.profiles)if(p.skills&&(!Array.isArray(p.skills)||p.skills.length>100||p.skills.some(s=>typeof s!=='string'||!/^[a-z0-9_-]{1,80}$/.test(s))))refuse();
    for(const p of station.profiles)if(p.reasoningEffort&&!['none','minimal','low','medium','high','xhigh','max'].includes(p.reasoningEffort))refuse();
    for (const p of station.profiles) if (!p||!agent(p.agentId) || typeof p.instructions !== "string" || p.instructions.length > 20000 || typeof p.personality !== "string" || p.personality.length > 4000 || p.model?.reasoningEffort&&!['none','minimal','low','medium','high','xhigh','max'].includes(p.model.reasoningEffort) || p.model && (typeof p.model.provider!=='string'||typeof p.model.model!=='string'||!p.model.provider.trim() || !p.model.model.trim())) refuse();
    for (const d of station.desks) if (!room(d.roomId)||!agent(d.agentId) || !Number.isFinite(d.x) || !Number.isFinite(d.y)) refuse();
    for(const p of station.profiles)if(p.budget&&(p.budget.currency!=='USD'||typeof p.budget.minorUnits!=='bigint'||p.budget.minorUnits<0n))refuse();
    for (const e of station.equipment) if (!e||!room(e.roomId)||typeof e.id!=='string'||!e.id.trim() || !Object.hasOwn(equipmentTools,e.kind) || typeof e.enabled !== "boolean" || !Number.isFinite(e.x) || !Number.isFinite(e.y)||(e.kind==='connector'&&!station.connectors?.some(c=>c.id===e.id))) refuse();
    for (const n of station.notebooks) {
      if (!agent(n.agentId) || typeof n.key!=='string'||!n.key.trim() || typeof n.text !== "string" || n.text.length > 64000 || !Number.isSafeInteger(n.revision) || n.revision < 1 || !Number.isFinite(Date.parse(n.updatedAt))) refuse();
      if(n.record){
        if(n.record.id!==n.key||n.record.body!==n.text)refuse();
        const visit=(value:unknown,depth=0):void=>{if(depth>40)refuse();if(value===null||typeof value==='string'||typeof value==='boolean')return;if(typeof value==='number'&&Number.isFinite(value))return;
          if(!value||typeof value!=='object'||(!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype))refuse();
          for(const [key,child]of Object.entries(value as object)){if(['__proto__','constructor','prototype','$hq.bigint'].includes(key))refuse();visit(child,depth+1);}
        };visit(n.record);
      }
    }
  }
}
