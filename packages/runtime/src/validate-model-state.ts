import {recoveryReasons,retryDelay} from './model-recovery.ts';
import type { DurableState } from "./durable-state.ts";
import { RuntimeError } from "./runtime-error.ts";
import { commandFingerprint } from "./command-fingerprint.ts";
import { maximumModelCost, priceModelUsage, validateModelPricing } from "./model-pricing.ts";
import { validModelUsage,validInputContent,validModelContinuation } from "./model-provider.ts";
import type { Money } from "@hqoverlord/core";
import { maximumMeteredCost, validateMeteredPricing } from "./metered-cost.ts";
import { validateMeteredState } from "./validate-metered-state.ts";

export function validateModelState(state: DurableState): void {
  const invalid = (): never => { throw new RuntimeError("INVALID_STATE", "Invalid durable model accounting"); };
  const validMoney = (m: Money) => m && typeof m.minorUnits === "bigint" && m.minorUnits >= 0n && /^[A-Z]{3}$/.test(m.currency);
  if (state.modelAccounts !== undefined && !Array.isArray(state.modelAccounts)) invalid();
  if (state.ledger !== undefined && !Array.isArray(state.ledger)) invalid();
  const accounts = state.modelAccounts ?? [];
  const ledger = state.ledger ?? [];
  const jobs = new Set<string>(), calls = new Set<string>(), entries = new Set<string>(), linked = new Set<string>();
  for (const entry of ledger) {
    const job = state.authority.jobs.find(j => j.id === entry?.jobId);
    if (!entry || typeof entry.id !== "string" || !entry.id || entries.has(entry.id) || !job
      || job.businessId !== entry.businessId || entry.kind !== "expense" || !validMoney(entry.amount)
      || entry.description !== "Model/API usage" || typeof entry.occurredAt !== "string") invalid();
    entries.add(entry.id);
  }
  for (const account of accounts) {
    const job = state.authority.jobs.find(j => j.id === account?.jobId);
    if (!account || jobs.has(account.jobId) || !job || job.businessId !== account.businessId
      || !state.executions?.some(e => e.jobId === account.jobId) || !Array.isArray(account.invocations)) invalid();
    jobs.add(account.jobId);
    const p = account.policy;
    if(p?.reasoningEffort&&!['none','minimal','low','medium','high','xhigh','max'].includes(p.reasoningEffort))invalid();
    if(account.continuation!==undefined&&!validModelContinuation(account.continuation))invalid();
    if (!p || typeof p.provider !== "string" || !p.provider || typeof p.model !== "string" || !p.model.trim()
      || ![p.maxInputTokens, p.maxOutputTokens].every(n => Number.isSafeInteger(n) && n > 0)) invalid();
    try { if (p.pricing) validateModelPricing(p.pricing); } catch { invalid(); }
    try { if (p.meteredPricing) validateMeteredPricing(p.meteredPricing); } catch { invalid(); }
    if (p.pricing && p.meteredPricing) invalid();
    const maximum = p.pricing && maximumModelCost(p.provider, p.model, p.maxInputTokens, p.maxOutputTokens, p.pricing);
    const meteredMaximum = p.meteredPricing && maximumMeteredCost(p.provider, p.model, p.maxInputTokens, p.maxOutputTokens, p.meteredPricing);
    if (p.budget && (!validMoney(p.budget) || (p.meteredPricing ? !meteredMaximum || p.budget.currency !== "USD" : !maximum || maximum.currency !== p.budget.currency))) invalid();
    if(p.fallbackTargets){if(!Array.isArray(p.fallbackTargets)||p.fallbackTargets.length>8||!p.budget)invalid();for(const t of p.fallbackTargets){
      if(!t||typeof t.provider!=='string'||!t.provider||typeof t.model!=='string'||!t.model||![t.maxInputTokens,t.maxOutputTokens].every(n=>Number.isSafeInteger(n)&&n>0)||!!t.meteredPricing!==!!p.meteredPricing||!!t.pricing!==!!p.pricing)invalid();
      try{if(t.pricing)validateModelPricing(t.pricing);if(t.meteredPricing)validateMeteredPricing(t.meteredPricing);}catch{invalid();}
      if(t.pricing&&(!maximumModelCost(t.provider,t.model,t.maxInputTokens,t.maxOutputTokens,t.pricing)||t.pricing.currency!==p.budget.currency)||t.meteredPricing&&!maximumMeteredCost(t.provider,t.model,t.maxInputTokens,t.maxOutputTokens,t.meteredPricing))invalid();
    }}
    if(account.activeTarget!==undefined&&(!Number.isSafeInteger(account.activeTarget)||account.activeTarget<0||account.activeTarget>(p.fallbackTargets?.length??0)))invalid();
    if(p.maxRetries!==undefined&&(!Number.isSafeInteger(p.maxRetries)||p.maxRetries<1||p.maxRetries>6||!p.budget||!p.pricing&&!p.meteredPricing))invalid();
    const {fallbackTargets:_targets,budget:_budget,maxRetries:_retryLimit,...primaryTarget}=p;
    for (const call of account.invocations) {
      const target=call.target??p;
      const sameWithoutOutput=(a:import('./model-state.ts').ModelTargetPolicy,b:import('./model-state.ts').ModelTargetPolicy)=>{const {maxOutputTokens:_a,...left}=a,{maxOutputTokens:_b,...right}=b;return commandFingerprint(left)===commandFingerprint(right);};
      const priorCalls:readonly import('./model-state.ts').ModelInvocation[]=account.invocations.slice(0,account.invocations.indexOf(call));
      const capParent=call.retryOf&&priorCalls.find(c=>c.id===call.retryOf&&c.failureReason==='output_cap'&&c.allowedMaxOutputTokens===target.maxOutputTokens&&sameWithoutOutput(c.target??primaryTarget,target));
      const provenCap=!!capParent||priorCalls.some(c=>c.target&&sameWithoutOutput(c.target,target)&&c.target.maxOutputTokens===target.maxOutputTokens&&c.retryOf&&priorCalls.some(parent=>parent.id===c.retryOf&&parent.failureReason==='output_cap'&&parent.allowedMaxOutputTokens===target.maxOutputTokens));
      if(call.target&&![primaryTarget,...(p.fallbackTargets??[])].some(t=>commandFingerprint(t)===commandFingerprint(call.target)||p.budget&&provenCap&&sameWithoutOutput(t,target)&&target.maxOutputTokens<t.maxOutputTokens))invalid();
      if(call.purpose!==undefined&&call.purpose!=='compaction')invalid();
      if(call.recoveryOf){const position=account.invocations.indexOf(call),parent=account.invocations.slice(0,position).find((c:import("./model-state.ts").ModelInvocation)=>c.id===call.recoveryOf);if(call.purpose!=='compaction'||parent?.failureReason!=='context_overflow'||commandFingerprint(parent.target??primaryTarget)!==commandFingerprint(call.target??primaryTarget))invalid();}
      if(call.allowedMaxOutputTokens!==undefined&&(call.failureReason!=='output_cap'||!Number.isSafeInteger(call.allowedMaxOutputTokens)||call.allowedMaxOutputTokens<1||call.allowedMaxOutputTokens>=target.maxOutputTokens))invalid();
      if(call.failureReason&&(!recoveryReasons.includes(call.failureReason)||(call.transcript?.decision as {kind?:string})?.kind!=='failure'))invalid();
      if(call.retryOf){const index=account.invocations.indexOf(call),parent=account.invocations.slice(0,index).find((c:import('./model-state.ts').ModelInvocation)=>c.id===call.retryOf);if(!parent?.failureReason||(!capParent&&(retryDelay(parent.failureReason,0,p.maxRetries??0)===undefined||commandFingerprint(parent.target??primaryTarget)!==commandFingerprint(call.target??primaryTarget)))||commandFingerprint({instructions:parent.transcript?.instructions,input:parent.transcript?.input,inputContent:parent.transcript?.inputContent??null})!==commandFingerprint({instructions:call.transcript?.instructions,input:call.transcript?.input,inputContent:call.transcript?.inputContent??null}))invalid();let depth=capParent?0:1,ancestor=parent;while(ancestor?.retryOf){ancestor=account.invocations.slice(0,index).find((c:import('./model-state.ts').ModelInvocation)=>c.id===ancestor!.retryOf);if(ancestor?.failureReason!=='output_cap')depth++;if(depth>6)invalid();}if(!capParent&&depth>(p.maxRetries??0))invalid();}
      const callMaximum=target.pricing&&maximumModelCost(target.provider,target.model,target.maxInputTokens,target.maxOutputTokens,target.pricing);
      if(call.transcript&&(typeof call.transcript.instructions!=='string'||typeof call.transcript.input!=='string'||call.transcript.instructions.length+call.transcript.input.length>2_000_000))invalid();
      if(call.transcript?.inputContent!==undefined&&!validInputContent(call.transcript.inputContent))invalid();
      if (!call || typeof call.id !== "string" || !call.id || calls.has(call.id) || !["reserved", "unknown", "settled"].includes(call.status)) invalid();
      calls.add(call.id);
      if (commandFingerprint({ value: call.reservation }) !== commandFingerprint({ value: callMaximum || undefined })) invalid();
      if (call.usage && (!validModelUsage(call.usage) || call.usage.provider !== target.provider)) invalid();
      const cost = call.usage && target.pricing ? priceModelUsage(call.usage, target.pricing) : undefined;
      if (commandFingerprint({ value: cost }) !== commandFingerprint({ value: call.cost })) invalid();
      if (call.status === "reserved" && (call.usage || call.cost || call.ledgerEntryId)) invalid();
      if (call.status === "settled" && (!call.usage || (target.pricing && !cost))) invalid();
      if (call.status === "unknown" && cost) invalid();
      const usageFacts = state.facts.filter(f => f.type === "model.usage_recorded" && f.payload.invocationId === call.id);
      if (usageFacts.length !== (call.usage ? 1 : 0)) invalid();
      if (call.usage) {
        const fact = usageFacts[0]!;
        if (fact.type !== "model.usage_recorded" || fact.businessId !== account.businessId
          || commandFingerprint(fact.payload) !== commandFingerprint({ jobId: account.jobId, invocationId: call.id, ...call.usage })) invalid();
      }
      if (cost) {
        const entry = ledger.find(e => e.id === call.ledgerEntryId);
        if (!entry || linked.has(entry.id) || entry.businessId !== account.businessId || entry.jobId !== account.jobId
          || commandFingerprint(entry.amount) !== commandFingerprint(cost)) invalid();
        linked.add(entry!.id);
        const facts = state.facts.filter(f => f.type === "ledger.entry_recorded" && f.payload.entry.id === entry!.id);
        const fact = facts[0];
        if (facts.length !== 1 || fact?.type !== "ledger.entry_recorded" || fact.businessId !== account.businessId
          || commandFingerprint(fact.payload.entry) !== commandFingerprint(entry) || fact.causationId !== usageFacts[0]!.id) invalid();
      } else if (call.ledgerEntryId) invalid();
    }
  }
  if (linked.size !== ledger.length) invalid();
  for (const fact of state.facts) {
    if (fact.type === "model.usage_recorded" && !calls.has(fact.payload.invocationId)) invalid();
  }
  validateMeteredState(state);
}
