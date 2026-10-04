import { createServer, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { BusinessId } from "@hqoverlord/core";
import { ids, money, currencyCode } from "@hqoverlord/core";
import { runStandingLoopTick,customSpecialists, bundledSkillCatalog, manageSkill, recipePostconditions, scanHarness, detectHarnesses, executeFloorWorkflow, runRoutineTick, runNightShiftTick, commandId, fillRecipe, specialists, type EquipmentKind, type FloorGeometry, type ExecutionResult, type Recipe, type ChannelKind } from "@hqoverlord/runtime";
import type { CommandContext, DurableRuntime } from "@hqoverlord/runtime";
import { projectBusiness, wireJson } from "./projection.ts";
import { createAcpController } from './acp-controller.ts';
import {createOpenAiCompat,type OpenAiCompatOptions} from './openai-compat.ts';
import {recipeEvidence,recipeTemplates,importRecipe,exportRecipe} from '@hqoverlord/runtime';

export interface ControlCentreOptions {
  readonly connectorCatalog?:(businessId:BusinessId)=>readonly {id:string;url:string;state:string;toolCount:number}[];
  readonly installConnector?:(context:CommandContext,id:string)=>Promise<unknown>;
  readonly workshop?:{keep(context:CommandContext,jobId:import("@hqoverlord/core").JobId):Promise<unknown>;undo(context:CommandContext,jobId:import("@hqoverlord/core").JobId):Promise<unknown>};
  readonly externalApi?:OpenAiCompatOptions;
  readonly runtime: DurableRuntime;
  /** Explicit host authorization, not inferred from request query parameters. */
  readonly businessIds: readonly BusinessId[];
  readonly context: (businessId: BusinessId) => CommandContext;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly attachment?:(context:CommandContext,agentId:import("@hqoverlord/core").AgentId,name:string,mime:string,bytes:Uint8Array)=>Promise<import("@hqoverlord/runtime").StationAttachment>;
  readonly file?:(context:CommandContext,agentId:import("@hqoverlord/core").AgentId,path:string)=>Promise<{bytes:Buffer;contentType:string}>;
  readonly modelEnabled?: boolean;
  readonly modelCatalog?:(provider:string)=>Promise<readonly Record<string,unknown>[]>;
  readonly admitModel?:(context:CommandContext,input:Record<string,unknown>)=>Promise<unknown>;
  readonly models?: readonly {readonly provider:string;readonly model:string}[]|(()=>readonly {readonly provider:string;readonly model:string}[]);
  readonly channelStatus?:(businessId:BusinessId)=>readonly {readonly id:string;readonly state:string}[];
  readonly prepare?: (context: CommandContext, input: { id: string; url: string; material: string }) => Promise<unknown>;
  readonly run?: (context: CommandContext, jobId: string, reasonOnly?:boolean) => Promise<unknown>;
  readonly assetRoot?: URL;
}

export function createControlCentre(options: ControlCentreOptions) {
  if(options.externalApi&&!options.businessIds.includes(options.externalApi.businessId))throw new Error('External API business is not authorized by this host');
  const external=options.externalApi&&options.run&&options.modelEnabled?createOpenAiCompat(options.runtime,options.context,options.run,options.externalApi):undefined;
  const acp=options.run&&options.modelEnabled?createAcpController(options.runtime,options.context,options.run):undefined;
  const token = randomBytes(32).toString("hex");
  const clients = new Map<ServerResponse, BusinessId>();
  const partials=new Map<string,import('@hqoverlord/runtime').ModelTextUpdate>();
  const epoch = randomBytes(8).toString("hex"); let sequence = 0;
  const assets = new Set(["index.html", "app.js", "floor-editor.js", "client-state.js", "station-model.js", "world.js", "navdock.js", "style.css", "assets/agent.svg", "assets/fonts/vt323.woff2", "notices/STARNET-MIT.txt", "notices/VT323-OFL.txt"]);
  const models=()=>typeof options.models==='function'?options.models():options.models??[];
  function project(businessId: BusinessId) {
    const snapshot = options.runtime.snapshot(), context = options.context(businessId);
    const active = new Set(snapshot.authority.jobs.filter(j => j.businessId === businessId && options.runtime.isJobActive(context, j.id)).map(j => j.id));
    return { ...projectBusiness(snapshot, businessId, active), businesses: snapshot.authority.businesses.filter(b => options.businessIds.includes(b.id)),
      connectorCatalog:options.connectorCatalog?.(businessId)??[],recipeTemplates:recipeTemplates.map(r=>({id:r.id,name:r.name})),recipeEvidence:recipeEvidence(snapshot,businessId,(options.channelStatus?.(businessId)??[]).filter(c=>c.state==='connected').map(c=>c.id)),metadata: options.metadata?.[businessId] ?? null, modelEnabled: !!options.modelEnabled, models:models(), specialists:[...specialists,...customSpecialists(options.runtime.station(context).specialties??[]).presets],skillCatalog:bundledSkillCatalog.map(({body:_body,...metadata})=>metadata), channelStatus:(options.channelStatus?.(businessId)??[]).filter(c=>options.runtime.station(context).channels?.some(owned=>owned.id===c.id)), preparationEnabled: !!options.prepare };
  }
  function send(res: ServerResponse, businessId: BusinessId) {
    try {
      // A full hydration can exceed 1 MB. Judge backlog before adding it, not its own size.
      if (res.writableLength > 1024 * 1024) { clients.delete(res); res.destroy(); return; }
      res.write(`id: ${epoch}:${sequence}\nevent: snapshot\ndata: ${wireJson(project(businessId))}\n\n`);
    } catch { clients.delete(res); res.destroy(); }
  }
  const unsubscribe = options.runtime.subscribe(() => { sequence++; for (const [res, id] of clients) send(res, id); });
  const unsubscribeText=options.runtime.subscribeModelText(update=>{partials.set(update.jobId,update);for(const [res,businessId]of clients){if(businessId!==update.businessId)continue;try{const ok=res.write(`event: model_text\ndata: ${wireJson(update)}\n\n`);if(!ok&&res.writableLength>1024*1024){clients.delete(res);res.destroy();}}catch{clients.delete(res);res.destroy();}}});
  const clearPartials=options.runtime.subscribe(()=>{const state=options.runtime.snapshot();for(const [jobId]of partials)if(!state.authority.jobs.some(j=>j.id===jobId&&j.status==='running'))partials.delete(jobId);});
  const ticking=new Set<BusinessId>();
  const routines=setInterval(()=>{
    if(!options.modelEnabled||!options.run)return;
    for(const businessId of options.businessIds){

      const context:CommandContext={...options.context(businessId),principal:{kind:"system",id:"hq.routines"}};
      const execute=async(c:CommandContext,id:string,reasonOnly?:boolean)=>await options.run!(c,id,reasonOnly) as ExecutionResult;
      const failed=()=>{sequence++;for(const [client,id]of clients)send(client,id);};
      void runRoutineTick(options.runtime,context,execute).catch(failed);
      void runStandingLoopTick(options.runtime,context,execute).catch(failed);
      if(!ticking.has(businessId)){ticking.add(businessId);void runNightShiftTick(options.runtime,context,execute).catch(failed).finally(()=>ticking.delete(businessId));}
    }
  },30000);routines.unref();
  const heartbeat = setInterval(() => { for (const [res] of clients) {
    try { const ok = res.write("event: heartbeat\ndata: {}\n\n"); if (!ok && res.writableLength > 1024 * 1024) { clients.delete(res); res.destroy(); } }
    catch { clients.delete(res); res.destroy(); }
  } }, 10_000); heartbeat.unref();
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const host = req.headers.host ?? "";
    if (!/^127\.0\.0\.1:\d+$/.test(host)) { res.writeHead(403).end("Invalid host"); return; }
    if (req.headers.origin && req.headers.origin !== `http://${host}` || req.headers["sec-fetch-site"] === "cross-site") { res.writeHead(403).end("Invalid origin"); return; }
    const url = new URL(req.url ?? "/", `http://${host}`);
    try {
      if(external&&await external(req,res,url))return;
      if (!url.pathname.startsWith("/api/")) {
        if (req.method !== "GET") { res.writeHead(405).end(); return; }
        const asset = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
        if (!assets.has(asset)) { res.writeHead(404).end(); return; }
        const root = options.assetRoot ?? new URL("../dist/", import.meta.url);
        const content = await readFile(new URL(asset, root));
        // HttpOnly local session; master token is never placed in URLs, logs or JS.
        if (asset === "index.html") res.setHeader("Set-Cookie", `hq_session=${token}; HttpOnly; SameSite=Strict; Path=/`);
        res.setHeader("Content-Type", asset.endsWith(".js") ? "text/javascript" : asset.endsWith(".css") ? "text/css" : asset.endsWith(".svg") ? "image/svg+xml" : asset.endsWith(".woff2") ? "font/woff2" : asset.endsWith(".txt") ? "text/plain; charset=utf-8" : "text/html; charset=utf-8");
        res.end(content); return;
      }
      const supplied = /(?:^|;\s*)hq_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie ?? "")?.[1] ?? "";
      if (supplied.length !== token.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) { res.writeHead(401).end("Unauthorized"); return; }
      const businessId = options.businessIds.find(id => id === url.searchParams.get("business")) ?? (!url.searchParams.has("business") ? options.businessIds[0] : undefined);
      if (!businessId) { res.writeHead(403).end("Business unavailable"); return; }
      if(req.method==='GET'&&url.pathname==='/api/file'&&options.file){const file=await options.file(options.context(businessId),ids.agent(url.searchParams.get('agent')??''),url.searchParams.get('path')??'');res.setHeader('Content-Type',file.contentType);res.setHeader('Content-Disposition',file.contentType==='image/png'?'inline':'attachment');res.end(file.bytes);return;}
      if (req.method === "GET" && url.pathname === "/api/snapshot") { res.setHeader("Content-Type", "application/json"); res.end(wireJson(project(businessId))); return; }
      if(req.method==='GET'&&url.pathname==='/api/acp-events'&&acp){res.setHeader('Content-Type','application/json');res.end(wireJson(acp.poll(businessId,url.searchParams.get('clientId')??'')));return;}
      if (req.method === "GET" && url.pathname === "/api/events") {
        res.writeHead(200, { "Content-Type": "text/event-stream", Connection: "keep-alive", "X-Accel-Buffering": "no" });
        clients.set(res, businessId); send(res, businessId); // Full hydration on every reconnect/restart: no delta gaps.
        for(const update of partials.values())if(update.businessId===businessId&&options.runtime.isJobActive(options.context(businessId),update.jobId))res.write(`event: model_text\ndata: ${wireJson(update)}\n\n`);
        req.on("close", () => clients.delete(res)); return;
      }
      if (req.method !== "POST" || req.headers["content-type"] !== "application/json" || req.headers.origin !== `http://${host}`) { res.writeHead(403).end("Invalid mutation"); return; }
      let size = 0; const chunks: Buffer[] = [];
      for await (const chunk of req) { size += chunk.length; if (size > (url.pathname==='/api/attachment'?12*1024*1024:64_000)) { res.writeHead(413).end(); return; } chunks.push(chunk); }
      const input = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      const context = options.context(businessId); let result: unknown;
      if(url.pathname==='/api/attachment'&&options.attachment&&typeof input.agentId==='string'&&typeof input.name==='string'&&typeof input.mime==='string'&&typeof input.base64==='string'){
        if(context.principal.kind!=='human'||input.name.length>255||!/^[-\w.+]+\/[-\w.+]+$/.test(input.mime)||!input.base64.length||input.base64.length>Math.ceil(8*1024*1024/3)*4||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64))throw new Error('Invalid attachment');
        const agentId=ids.agent(input.agentId);options.runtime.effectiveAgent(context,agentId);const attachment=await options.attachment(context,agentId,input.name,input.mime,Buffer.from(input.base64,'base64'));const artifact=await options.runtime.createArtifact(context,{id:'station-attachment:'+attachment.id,category:'source',contentType:'application/json',content:{agentId,attachment},sourceIds:[]});result={artifactId:artifact.id,attachment};
      }else if(url.pathname==='/api/acp'&&acp&&typeof input.clientId==='string'&&typeof input.agentId==='string')result=await acp.handle(businessId,{clientId:input.clientId,agentId:input.agentId,message:input.message});
      else if(url.pathname==='/api/acp-close'&&acp&&typeof input.clientId==='string'){acp.disconnect(businessId,input.clientId);result={closed:true};}
      else if(url.pathname==="/api/activity") {await options.runtime.noteUserActivity(context);result={saved:true};}
      else if(url.pathname==="/api/halt"&&typeof input.halted==="boolean"){await options.runtime.setHalt(context,input.halted);result={saved:true};}
      else if(url.pathname==='/api/connector-install'&&typeof input.id==='string'&&options.installConnector){result=await options.installConnector(context,input.id);sequence++;for(const [client,id]of clients)send(client,id);}
      else if(url.pathname==='/api/workshop-keep'&&typeof input.jobId==='string'&&options.workshop)result=await options.workshop.keep(context,ids.job(input.jobId));
      else if(url.pathname==='/api/workshop-undo'&&typeof input.jobId==='string'&&options.workshop)result=await options.workshop.undo(context,ids.job(input.jobId));
      else if(url.pathname==='/api/night-review'&&typeof input.jobId==='string'&&['keep','discard','later'].includes(String(input.verdict))&&typeof input.note==='string'){await options.runtime.reviewNightDraft(context,ids.job(input.jobId),input.verdict as 'keep'|'discard'|'later',input.note);result={saved:true};}
      else if(url.pathname==="/api/channel"&&typeof input.id==="string"&&typeof input.kind==="string"&&typeof input.agentId==="string"&&typeof input.ownerUserId==="string"&&Array.isArray(input.allowedChats)&&input.allowedChats.every(c=>typeof c==='string')&&typeof input.enabled==='boolean'){
        await options.runtime.saveChannel(context,{id:input.id,kind:input.kind as ChannelKind,agentId:ids.agent(input.agentId),ownerUserId:input.ownerUserId,allowedChats:input.allowedChats as string[],enabled:input.enabled});result={saved:true};
      }else if(url.pathname==='/api/skill'&&typeof input.agentId==='string'){result=await manageSkill(options.runtime,context,ids.agent(input.agentId),input);}
      else if(url.pathname==='/api/loop'&&typeof input.id==='string'&&typeof input.name==='string'&&typeof input.objective==='string'&&typeof input.agentId==='string'){
        const cents=(value:unknown)=>{if(typeof value!=='string'||!/^[0-9]{1,9}$/.test(value))throw new Error('Loop budget must be exact USD cents');return BigInt(value);};
        await options.runtime.saveStandingLoop(context,{id:input.id,name:input.name,objective:input.objective,agentId:ids.agent(input.agentId),gate:input.gate==='auto'?'auto':'review',queueCap:Number(input.queueCap??3),maxIterations:Number(input.maxIterations??10),dryStopAfter:Number(input.dryStopAfter??3),perDayCents:cents(input.perDayCents??'100'),perIterationCents:cents(input.perIterationCents??'5')});result={saved:true};
      }else if(url.pathname==='/api/loop-control'&&typeof input.id==='string'&&['pause','resume','stop'].includes(String(input.action))){await options.runtime.controlStandingLoop(context,input.id,input.action as 'pause'|'resume'|'stop');result={saved:true};}
      else if(url.pathname==='/api/loop-review'&&typeof input.id==='string'&&typeof input.n==='number'&&['approved','rejected'].includes(String(input.verdict))&&typeof input.note==='string'){await options.runtime.reviewStandingLoop(context,input.id,input.n,input.verdict as 'approved'|'rejected',input.note);result={saved:true};}
      else if(url.pathname==='/api/recipe-import'&&typeof input.id==='string'){const template=typeof input.templateId==='string'?recipeTemplates.find(r=>r.id===input.templateId):input.recipe;if(!template)throw new Error('Recipe template unavailable');await options.runtime.saveRecipe(context,importRecipe(input.id,template));result={saved:true};}
      else if(url.pathname==='/api/recipe-export'&&typeof input.id==='string'){const recipe=options.runtime.station(context).routineState?.recipes.find(r=>r.id===input.id);if(!recipe)throw new Error('Recipe unavailable');result=exportRecipe(recipe);}
      else if(url.pathname==="/api/recipe") {await options.runtime.saveRecipe(context,input as unknown as Recipe);result={saved:true};}
      else if(url.pathname==="/api/recipe-run"&&typeof input.id==="string"&&typeof input.agentId==="string"&&options.run&&options.modelEnabled){
        const recipe=options.runtime.station(context).routineState?.recipes.find(r=>r.id===input.id);if(!recipe)throw new Error("Recipe unavailable");
        const values=input.inputs as Record<string,string>;if(!values||Object.values(values).some(v=>typeof v!=="string"))throw new Error("Invalid recipe inputs");
        const job=(await options.runtime.createRecipeJob(context,ids.agent(input.agentId),fillRecipe(recipe,values),recipePostconditions(recipe,values),recipe.id)).record;
        void options.run({...context,commandId:commandId(`${context.commandId}:run`)},job.id).catch(()=>{});result={accepted:true,jobId:job.id};
      }else if(url.pathname==="/api/routine"&&typeof input.id==="string"&&typeof input.agentId==="string"&&typeof input.recipeId==="string"&&typeof input.schedule==="string"&&typeof input.timezone==="string"&&typeof input.enabled==="boolean"){
        await options.runtime.saveRoutine(context,{id:input.id,agentId:ids.agent(input.agentId),recipeId:input.recipeId,inputs:input.inputs as Record<string,string>,schedule:input.schedule,timezone:input.timezone,enabled:input.enabled,...(typeof input.workflowId==='string'&&input.workflowId?{workflowId:input.workflowId}:{})});result={saved:true};
      }else if(url.pathname==="/api/autonomy"&&typeof input.dailyLimit==="number"&&typeof input.enabled==="boolean"&&typeof input.agentId==="string"&&typeof input.leashPerDay==="number"){
        await options.runtime.configureAutonomy(context,{dailyLimit:input.dailyLimit,enabled:input.enabled,allowPrivateWrites:input.allowPrivateWrites===true,agentId:ids.agent(input.agentId),leashPerDay:input.leashPerDay,beliefs:input.beliefs as Record<string,string[]>});result={saved:true};
      }else if (url.pathname === "/api/recruit" && typeof input.name === "string") {
        if (context.principal.kind !== "human") throw new Error("Human recruitment required");
        const preset=typeof input.specialist==='string'&&input.specialist?[...specialists,...customSpecialists(options.runtime.station(context).specialties??[]).presets].find(s=>s.id===input.specialist):undefined;
        if(input.specialist&&!preset)throw new Error('Unknown specialist preset');
        result = await options.runtime.createAgent(context, { name: input.name });
        if(preset){const agent=(result as {record:{id:string}}).record;
          await options.runtime.configureAgent(context,{agentId:ids.agent(agent.id),instructions:preset.instructions,personality:preset.personality,...(preset.skills?{skills:preset.skills}:{}),...(preset.reasoningEffort?{reasoningEffort:preset.reasoningEffort}:{})});}
      }else if(url.pathname==='/api/specialist'){await options.runtime.saveSpecialist(context,{...(typeof input.remove==='string'?{remove:input.remove}:{save:input})});result={saved:true};}
      else if(url.pathname==='/api/model-admit'&&options.admitModel){if(context.principal.kind!=='human')throw new Error('Operator required');result=await options.admitModel(context,input);sequence++;for(const [client,id]of clients)send(client,id);}
      else if(url.pathname==='/api/model-catalog'&&typeof input.provider==='string'&&options.modelCatalog){result={provider:input.provider,models:await options.modelCatalog(input.provider)};}
      else if(url.pathname==='/api/harness-detect'){if(context.principal.kind!=='human')throw new Error('Operator required');result={found:await detectHarnesses(process.platform,process.env)};
      }else if(['/api/harness-scan','/api/harness-import'].includes(url.pathname)&&['openclaw','hermes'].includes(String(input.harness))&&typeof input.root==='string'){
        if(context.principal.kind!=='human')throw new Error('Operator required');const preview=await scanHarness(input.harness as 'openclaw'|'hermes',input.root);result=preview;
        if(url.pathname==='/api/harness-import'){if(!preview.ok)throw new Error('No importable agent found');const agent=(await options.runtime.createAgent(context,{name:typeof input.name==='string'&&input.name.trim()?input.name:preview.name??'Imported crew'})).record;
          await options.runtime.configureAgent(context,{agentId:agent.id,instructions:(preview.instructions??'').slice(0,20000),personality:(preview.persona??'').slice(0,4000)});
          if(preview.userContext)await options.runtime.writeNotebook(context,agent.id,'Imported user context',preview.userContext);
          if(preview.memory?.curated)await options.runtime.writeNotebook(context,agent.id,'Imported curated memory',preview.memory.curated);
          result={agentId:agent.id,preview,modelSelected:false}; // Imported config never widens the host model/tool allowlist.
        }
      } else if (url.pathname === "/api/profile" && typeof input.agentId === "string" && typeof input.instructions === "string" && typeof input.personality === "string") {
        const model = input.model as { provider?: unknown; model?: unknown;reasoningEffort?:unknown } | undefined;
        if (model && (typeof model.provider !== "string" || typeof model.model !== "string")) throw new Error("Invalid model selection");
        if(model&&!models().some(p=>p.provider===model.provider&&p.model===model.model))throw new Error("Provider/model is not configured on this host");
        if(input.budgetCents!==undefined&&(typeof input.budgetCents!=='string'||!/^[0-9]{1,10}$/.test(input.budgetCents)))throw new Error('Budget must be exact nonnegative USD cents');
        await options.runtime.configureAgent(context, { agentId: ids.agent(input.agentId), instructions: input.instructions, personality: input.personality,
          ...(Array.isArray(input.skills)&&input.skills.every(s=>typeof s==='string')?{skills:input.skills as string[]}:{skills:options.runtime.station(context).profiles.find(p=>p.agentId===input.agentId)?.skills??[]}),
          ...(options.runtime.station(context).profiles.find(p=>p.agentId===input.agentId)?.reasoningEffort?{reasoningEffort:options.runtime.station(context).profiles.find(p=>p.agentId===input.agentId)!.reasoningEffort}:{}),
          ...(typeof input.budgetCents==='string'?{budget:money(BigInt(input.budgetCents),currencyCode('USD'))}:{}),
          ...(model ? { model: { provider: model.provider as string, model: model.model as string,...(typeof model.reasoningEffort==="string"?{reasoningEffort:model.reasoningEffort}:{}) } } : {}) }); result = { saved: true };
      } else if(url.pathname==='/api/room'&&typeof input.id==='string'&&typeof input.name==='string'){await options.runtime.saveRoom(context,{id:input.id,name:input.name});result={saved:true};
      } else if (url.pathname === "/api/desk" && typeof input.agentId === "string" && typeof input.x === "number" && typeof input.y === "number") {
        await options.runtime.assignDesk(context, ids.agent(input.agentId), input.x, input.y,typeof input.roomId==='string'&&input.roomId?input.roomId:undefined); result = { saved: true };
      }else if(url.pathname==='/api/rename'&&typeof input.agentId==='string'&&typeof input.name==='string'){await options.runtime.renameAgent(context,ids.agent(input.agentId),input.name);result={saved:true};
      } else if (url.pathname === "/api/retire" && typeof input.agentId === "string") {
        await options.runtime.retireAgent(context, ids.agent(input.agentId)); result = { saved: true };
      } else if (url.pathname === "/api/equipment" && typeof input.id === "string" && typeof input.kind === "string" && typeof input.enabled === "boolean" && typeof input.x === "number" && typeof input.y === "number") {
        await options.runtime.placeEquipment(context, { id: input.id, kind: input.kind as EquipmentKind, enabled: input.enabled, x: input.x, y: input.y,...(typeof input.roomId==='string'&&input.roomId?{roomId:input.roomId}:{}) }); result = { saved: true };
      } else if (url.pathname === "/api/remove-equipment" && typeof input.id === "string") {
        await options.runtime.removeEquipment(context, input.id); result = { saved: true };
      } else if (url.pathname === "/api/workflow" && typeof input.id === "string" && typeof input.name === "string") {
        await options.runtime.saveFloorWorkflow(context,input.id,input.name,input.geometry as FloorGeometry); result = { saved: true };
      } else if (url.pathname === "/api/workflow-run" && typeof input.id === "string" && typeof input.input === "string" && options.run && options.modelEnabled) {
        void executeFloorWorkflow(options.runtime,context,input.id,input.input,async (stage,job)=>await options.run!(stage,job.id) as ExecutionResult,
          { tag: typeof input.tag === "string" ? input.tag : "general" }).catch(() => { sequence++; for (const [client, id] of clients) send(client, id); }); result={accepted:true};
      } else if (url.pathname === "/api/notebook" && typeof input.agentId === "string" && typeof input.key === "string" && typeof input.text === "string") {
        await options.runtime.writeNotebook(context, ids.agent(input.agentId), input.key, input.text); result = { saved: true };
      }else if(url.pathname==='/api/notebook-record'&&typeof input.agentId==='string'&&typeof input.key==='string'&&['pin','unpin','forget'].includes(String(input.action))){
        await options.runtime.manageNotebookRecord(context,ids.agent(input.agentId),input.key,input.action as 'pin'|'unpin'|'forget');result={saved:true};
      } else if (["/api/job", "/api/comms"].includes(url.pathname) && typeof input.agentId === "string" && typeof input.objective === "string" && input.objective.trim() && input.objective.length <= 12000) {
        const agent = options.runtime.snapshot().authority.agents.find(a => a.id === input.agentId && a.businessId === businessId);
        if (!agent || agent.status === "retired") throw new Error("Agent unavailable");
        if (url.pathname === "/api/comms" && (!options.run || !options.modelEnabled)) throw new Error("Execution disabled");
        result = url.pathname==='/api/comms'?await options.runtime.createCommsJob(context,{agentId:agent.id,objective:input.objective.trim(),...(typeof input.workstreamId==='string'?{workstreamId:input.workstreamId}:{}),...(Array.isArray(input.attachmentIds)&&input.attachmentIds.every(id=>typeof id==='string')?{attachmentIds:input.attachmentIds as string[]}:{})}):await options.runtime.createJob(context, { agentId: agent.id, objective: input.objective.trim() });
        if (url.pathname === "/api/comms") {
          const jobId = (result as Awaited<ReturnType<DurableRuntime["createJob"]>>).record.id;
          void options.run!({...context,commandId:commandId(`${context.commandId}:run`)}, jobId).catch(() => { sequence++; for (const [client, id] of clients) send(client, id); });
        }
      } else if(url.pathname==='/api/workstream'&&typeof input.id==='string'&&typeof input.agentId==='string'&&typeof input.title==='string'){await options.runtime.saveWorkstream(context,{id:input.id,agentId:ids.agent(input.agentId),title:input.title,...(typeof input.archived==='boolean'?{archived:input.archived}:{}),...(['todo','active','shipped'].includes(String(input.lane))?{lane:input.lane as 'todo'|'active'|'shipped'}:{})});result={saved:true};
      } else if (url.pathname === "/api/cancel" && typeof input.jobId === "string") result = await options.runtime.cancelJob(context, options.runtime.snapshot().authority.jobs.find(j => j.id === input.jobId && j.businessId === businessId)?.id ?? (() => { throw new Error("Job unavailable"); })());
      else if (url.pathname === "/api/approval" && typeof input.approvalId === "string" && ["approve", "reject"].includes(String(input.decision))) {
        const approval = options.runtime.snapshot().approvals?.find(a => a.id === input.approvalId && a.businessId === businessId);
        if (!approval) throw new Error("Approval unavailable");
        result = input.decision === "approve" ? await options.runtime.approveOperation(context, approval.id) : await options.runtime.rejectOperation(context, approval.id, "Rejected by local operator");
      } else if (url.pathname === "/api/prepare" && options.prepare && typeof input.id === "string" && typeof input.url === "string" && typeof input.material === "string") result = await options.prepare(context, { id: input.id, url: input.url, material: input.material });
      else if (url.pathname === "/api/run" && options.run && typeof input.jobId === "string") {
        const job = options.runtime.snapshot().authority.jobs.find(j => j.id === input.jobId && j.businessId === businessId);
        if (!job) throw new Error("Job unavailable");
        options.runtime.jobInputs(context, job.id);
        const agent = options.runtime.snapshot().authority.agents.find(a => a.id === job.agentId && a.businessId === businessId);
        if (!options.modelEnabled && !agent?.toolIds.includes("artifact.release" as import("@hqoverlord/core").ToolId)) throw new Error("Paid execution disabled");
        // Respond immediately; durable SSE carries progress/outcome. Do not retry jobs on reconnect.
        void options.run(context, job.id).catch(() => { sequence++; for (const [client, id] of clients) send(client, id); });
        result = { accepted: true };
      } else { res.writeHead(404).end(); return; }
      res.setHeader("Content-Type", "application/json"); res.end(wireJson(result));
    } catch { if (!res.headersSent) res.writeHead(409, { "Content-Type": "application/json" }).end(wireJson({ error: "Operation refused or unavailable; inspect authoritative job/approval state" })); else res.destroy(); }
  });
  server.on("close", () => { acp?.close();unsubscribe();unsubscribeText();clearPartials(); clearInterval(heartbeat);clearInterval(routines); });
  return { server, refresh(){sequence++;for(const [res,id]of clients)send(res,id);}, close: async () => { acp?.close();for (const [res] of clients) res.end(); clients.clear(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } };
}
