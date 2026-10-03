import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ids } from "@hqoverlord/core";
import {createStationWorkshop,registerCommsTools, createStationFileReader,createStationAttachments, ReferenceModelProvider, FileDurableStore, systemClock, systemIds, notebookTools, skillTools, memoryContext, registerStationTools, registerBrowserTools, ToolRegistry, type CommandContext } from "@hqoverlord/runtime";
import { dirname, join } from "node:path";
import { loadBusiness001 } from "../../../businesses/business-001/load.ts";
import { manifest, businessId } from "../../../businesses/business-001/manifest.ts";
import { enableWorkforce, serviceTools, ownerContext, prepareWork, runServiceJob } from "../../../businesses/business-001/operations.ts";
import { createControlCentre } from "./server.ts";
import {createModelAdmission} from './model-admission.ts';
import { loadModelProfiles } from "./model-profiles.ts";
import { startChannelHosts } from "./channel-hosts.ts";
import { startMcpHosts } from './mcp-hosts.ts';
import {loadWebKeys} from './web-keys.ts';

const statePath = process.env.HQ_STATE_PATH ?? fileURLToPath(new URL("../../../businesses/business-001/.local/state.json", import.meta.url));
const loaded = await loadBusiness001(new FileDurableStore(statePath), systemClock, systemIds);
await enableWorkforce(loaded);
await loaded.runtime.ensureStation(ownerContext("station-initialization"));
await loaded.runtime.reconcileFloorWork({...ownerContext("floor-recovery"),principal:{kind:"system",id:"hq.runtime"}});
await loaded.runtime.reconcileStandingLoops({...ownerContext('standing-loop-recovery'),principal:{kind:'system',id:'hq.runtime'}});
const enabled = process.env.HQ_ENABLE_MODEL_EXECUTION === "1";
const modelProfilePath=join(dirname(statePath),"model-profiles.json");
let profiles=await loadModelProfiles(modelProfilePath);
const modelAdmission=createModelAdmission(modelProfilePath,profiles);
memoryContext.setKnownSecretSource(()=>Object.entries(process.env).filter(([name,value])=>value&&/(KEY|TOKEN|SECRET|PASSWORD)/.test(name)).map(([,value])=>value!));
const tools = serviceTools(loaded.runtime);
for (const tool of [...notebookTools(loaded.runtime),...skillTools(loaded.runtime)]) tools.register(tool);
registerStationTools(loaded.runtime, tools, join(dirname(statePath), "workspaces"),{webKeyFor:await loadWebKeys()});
registerCommsTools(loaded.runtime,tools,join(dirname(statePath),"workspaces"),()=>channels);
const attachments=createStationAttachments(loaded.runtime,join(dirname(statePath),"workspaces"));
const browsers=registerBrowserTools(tools,join(dirname(statePath),'browser-profiles'),{workspaceRoot:join(dirname(statePath),'workspaces')});
const connectors=process.env.HQ_ENABLE_CONNECTORS==='1'?await startMcpHosts(loaded.runtime,ownerContext('connector-hosts'),tools):undefined;
const run = async (context:CommandContext, id:string, reasonOnly?:boolean) => {
    const job = loaded.runtime.inspectJob(ownerContext("inspect"), ids.job(id));
    const agent = loaded.runtime.snapshot().authority.agents.find(a => a.id === job.agentId);
    if (!enabled && !agent?.toolIds.includes(ids.tool("artifact.release"))) throw new Error("Model execution disabled; explicitly enable it before starting paid jobs");
    const selected=loaded.runtime.station(ownerContext("model-profile")).profiles.find(p=>p.agentId===agent?.id)?.model;
    const admitted=loaded.runtime.inspectModelAccount(ownerContext("model-policy"),job.id)?.policy;
    const identity=admitted??selected??{provider:manifest.modelRouting.defaultProvider,model:manifest.modelRouting.defaultModel};
    const profile=profiles.find(p=>p.provider.name===identity.provider&&p.options.model===identity.model);
    if(!profile)throw new Error("Selected provider/model has no host configuration with explicit pricing");
    // Local release driver never invokes this provider. Missing model configuration stays disabled.
    try{return await runServiceJob(loaded.runtime, job.id, profile.provider, reasonOnly?new ToolRegistry():tools, {...profile.options,...(admitted?{maxRetries:admitted.maxRetries??0}:{}),...(job.agentId?{inputContent:await attachments.expand(context,job.agentId,(loaded.runtime.snapshot().artifacts??[]).filter(a=>a.businessId===context.businessId&&job.inputArtifactIds?.includes(a.id)).flatMap(a=>(a.content as {attachments?:import("@hqoverlord/runtime").StationAttachment[]})?.attachments??[])) as import("@hqoverlord/runtime").ModelRequest["inputContent"]}:{})}, context);}
    finally{if(loaded.runtime.inspectJob(context,job.id).status!=='running')await browsers.release(job.id);}
  };
// Transports are inert unless explicitly enabled. No credential validation dials a service.
let refreshChannels=()=>{};
const channels=enabled&&process.env.HQ_ENABLE_CHANNELS==='1'
  ?await startChannelHosts(loaded.runtime,ownerContext('channel-hosts'),run,()=>refreshChannels(),attachments,()=>profiles.map(p=>({provider:p.provider.name,model:p.options.model}))):undefined;
const app = createControlCentre({...(connectors?{connectorCatalog:(id)=>id===businessId?connectors.catalog():[],installConnector:connectors.install}:{}),workshop:createStationWorkshop(loaded.runtime,join(dirname(statePath),"workspaces"),join(dirname(statePath),"deliverables")),attachment:attachments.save,file:createStationFileReader(loaded.runtime,join(dirname(statePath),"workspaces")), runtime: loaded.runtime, businessIds: [businessId], context: () => ownerContext(`ui-${randomUUID()}`),
  ...(process.env.HQ_V1_KEY?{externalApi:{key:process.env.HQ_V1_KEY,businessId,agentIds:(process.env.HQ_V1_AGENT_IDS??'').split(',').map(s=>s.trim()).filter(Boolean).map(ids.agent),maxConcurrent:Number(process.env.HQ_V1_MAX_CONCURRENT??0)}}:{}),
  admitModel:async(context,input)=>{if(context.principal.kind!=='human'||context.businessId!==businessId)throw new Error('Operator host authorization required');const result=await modelAdmission.admit(input);profiles=modelAdmission.profiles();return result;},
  modelCatalog:async provider=>{const profile=profiles.find(p=>p.provider.name===provider);if(!profile)throw new Error('Provider is not configured');const models=await(profile.provider instanceof ReferenceModelProvider?profile.provider.listModels():new ReferenceModelProvider({name:'openai-catalog',format:'chat',endpoint:'https://api.openai.com/v1',apiKey:process.env.OPENAI_API_KEY??''}).listModels());modelAdmission.noteCatalog(provider,models);return models;},
  metadata: { [businessId]: manifest }, modelEnabled: enabled, models: ()=>profiles.map(p=>({provider:p.provider.name,model:p.options.model})),
  channelStatus:()=>channels?.status()??[],prepare: (_context, input) => prepareWork(loaded, input),run,
});
refreshChannels=app.refresh;
const port = Number(process.env.HQ_PORT ?? 8788);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("Invalid HQ_PORT");
app.server.listen(port, "127.0.0.1", () => console.log(`HQOverlord Control Centre http://127.0.0.1:${port} · model execution ${enabled ? "explicitly enabled" : "disabled"}`));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { channels?.close();connectors?.close();void browsers.close();void app.close(); });
