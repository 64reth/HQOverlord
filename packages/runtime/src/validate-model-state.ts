import type { DurableState } from "./durable-state.ts";
import { RuntimeError } from "./runtime-error.ts";
import { commandFingerprint } from "./command-fingerprint.ts";
import { maximumModelCost, priceModelUsage, validateModelPricing } from "./model-pricing.ts";
import { validModelUsage } from "./model-provider.ts";
import type { Money } from "@hqoverlord/core";

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
    if (!p || typeof p.provider !== "string" || !p.provider || typeof p.model !== "string" || !p.model.trim()
      || ![p.maxInputTokens, p.maxOutputTokens].every(n => Number.isSafeInteger(n) && n > 0)) invalid();
    try { if (p.pricing) validateModelPricing(p.pricing); } catch { invalid(); }
    const maximum = p.pricing && maximumModelCost(p.provider, p.model, p.maxInputTokens, p.maxOutputTokens, p.pricing);
    if (p.budget && (!validMoney(p.budget) || !maximum || maximum.currency !== p.budget.currency)) invalid();
    for (const call of account.invocations) {
      if (!call || typeof call.id !== "string" || !call.id || calls.has(call.id) || !["reserved", "unknown", "settled"].includes(call.status)) invalid();
      calls.add(call.id);
      if (commandFingerprint({ value: call.reservation }) !== commandFingerprint({ value: maximum || undefined })) invalid();
      if (call.usage && (!validModelUsage(call.usage) || call.usage.provider !== p.provider)) invalid();
      const cost = call.usage && p.pricing ? priceModelUsage(call.usage, p.pricing) : undefined;
      if (commandFingerprint({ value: cost }) !== commandFingerprint({ value: call.cost })) invalid();
      if (call.status === "reserved" && (call.usage || call.cost || call.ledgerEntryId)) invalid();
      if (call.status === "settled" && (!call.usage || (p.pricing && !cost))) invalid();
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
}
