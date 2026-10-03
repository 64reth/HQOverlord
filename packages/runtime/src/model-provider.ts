import type { ToolId } from "@hqoverlord/core";
import type { AgentAction } from "./execution-contracts.ts";
import type { AgentObservation } from "./execution-contracts.ts";

export interface ModelUsage {
  readonly provider: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens?: number;
  readonly cacheCreationInputTokens?: number;
  readonly requestId?: string;
}

export interface ModelToolDefinition {
  readonly id: ToolId;
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface ModelRequest {
  readonly inputContent?:readonly ({readonly type:'text';readonly text:string}|{readonly type:'image_url';readonly image_url:{readonly url:string}})[];
  readonly reasoningEffort?:string;
  /** Host-scoped conversation identity and completed observations; no provider identifiers. */
  readonly context?: {
    readonly conversationId: string;
    /** Host-only fresh history on a durably admitted provider switch; observations remain reference data. */
    readonly startFromObservations?:true;
    readonly observationImageCount?:number;
    readonly observations: readonly AgentObservation[];
    readonly continuation?: unknown;
  };
  readonly model: string;
  readonly instructions: string;
  readonly input: string;
  readonly tools: readonly ModelToolDefinition[];
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
}

export type ModelDecision = AgentAction | {
  readonly kind: "failure";
  readonly code: "PROVIDER_FAILED" | "MODEL_CONFIGURATION_INVALID" | "MODEL_INPUT_LIMIT" | "MODEL_DECISION_INVALID";
};

export interface ModelResult {
  readonly allowedMaxOutputTokens?:number;
  readonly failureReason?:import('./model-recovery.ts').RecoveryReason;
  readonly continuation?: unknown;
  readonly decision: ModelDecision;
  /** Absent means unknown, never zero. Usage can accompany a failed decision. */
  readonly usage?: ModelUsage;
}

export interface ModelProvider {
  readonly name: string;
  /** Pure native-history cut. Applying a successful paid summary must preserve exact pending tool linkage. */
  planCompaction?(request:ModelRequest,force?:boolean):{readonly older:readonly unknown[];readonly beforeBytes:number;apply(summary:string):unknown}|undefined;
  /** Drain an already paid tool batch using actual observations. Must never perform network I/O. */
  nextFromContinuation?(request:ModelRequest):ModelResult|undefined;
  /** Implementations must enforce both request limits before/while generating. No automatic retries. */
  invoke(request: ModelRequest, signal?: AbortSignal, onText?:(delta:string)=>void): Promise<ModelResult>;
}

/** Source attachment guard: 12MiB decoded images and bounded textual blocks per invocation. */
export function validInputContent(value:unknown):value is NonNullable<ModelRequest['inputContent']>{
  if(!Array.isArray(value)||value.length>32)return false;let imageBytes=0,textBytes=0;
  for(const b of value){if(!b||typeof b!=='object')return false;
    if(b.type==='text'&&typeof b.text==='string'){textBytes+=Buffer.byteLength(b.text);if(textBytes>512*1024)return false;}
    else if(b.type==='image_url'&&b.image_url&&typeof b.image_url.url==='string'){const match=/^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+=*)$/.exec(b.image_url.url);if(!match)return false;imageBytes+=Buffer.byteLength(match[2]!,'base64');if(imageBytes>12*1024*1024)return false;}
    else return false;
  }return true;
}
/** Native conversation is bounded plain JSON. Invalid adapter state must never discard an invoice. */
export function validModelContinuation(value:unknown):boolean{
  const seen=new Set<object>();const visit=(v:unknown,depth:number):boolean=>{if(depth>40)return false;if(v===null||typeof v==='string'||typeof v==='boolean')return true;if(typeof v==='number')return Number.isFinite(v);if(typeof v!=='object'||!v||seen.has(v)||(!Array.isArray(v)&&Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null))return false;seen.add(v);const ok=Object.entries(v).every(([key,child])=>!['__proto__','prototype','constructor','$hq.bigint'].includes(key)&&visit(child,depth+1));seen.delete(v);return ok;};
  try{return visit(value,0)&&Buffer.byteLength(JSON.stringify(value))<=32*1024*1024;}catch{return false;}
}

export function validModelUsage(value: unknown): value is ModelUsage {
  if (!value || typeof value !== "object") return false;
  const u = value as ModelUsage;
  const count = (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0;
  return typeof u.provider === "string" && u.provider.length > 0 && typeof u.model === "string" && u.model.length > 0
    && count(u.inputTokens) && count(u.outputTokens)
    && (u.cachedInputTokens === undefined || (count(u.cachedInputTokens) && u.cachedInputTokens <= u.inputTokens))
    && (u.cacheCreationInputTokens === undefined || (count(u.cacheCreationInputTokens) && u.cacheCreationInputTokens + (u.cachedInputTokens ?? 0) <= u.inputTokens))
    && (u.requestId === undefined || typeof u.requestId === "string");
}

/** Select only HQ fields, even when an adapter returns extra provider data at runtime. */
export function normalizeModelUsage(value: unknown): ModelUsage | undefined {
  if (!validModelUsage(value)) return undefined;
  return { provider: value.provider, model: value.model, inputTokens: value.inputTokens, outputTokens: value.outputTokens,
    ...(value.cachedInputTokens !== undefined ? { cachedInputTokens: value.cachedInputTokens } : {}),
    ...(value.cacheCreationInputTokens !== undefined ? { cacheCreationInputTokens: value.cacheCreationInputTokens } : {}),
    ...(value.requestId !== undefined ? { requestId: value.requestId } : {}),
  };
}


/** OpenAI's documented alias resolves to this snapshot; other model mismatches remain unpriced. */
export function modelUsageMatchesPricing(usage:ModelUsage,pricing:{provider:string;model:string}):boolean{
  return usage.provider===pricing.provider&&(usage.model===pricing.model||usage.provider==='openai'&&pricing.model==='gpt-5.4-mini'&&usage.model==='gpt-5.4-mini-2026-03-17');
}
