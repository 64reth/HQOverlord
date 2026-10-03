import type { DurableState } from "./durable-state.ts";
import { RuntimeError } from "./runtime-error.ts";
import { commandFingerprint } from "./command-fingerprint.ts";
import { maximumMeteredCost, priceMeteredUsage, validNanoUsd } from "./metered-cost.ts";

export function validateMeteredState(state: DurableState): void {
  const invalid = (): never => { throw new RuntimeError("INVALID_STATE", "Invalid versioned metered accounting"); };
  const equal = (a: unknown, b: unknown) => commandFingerprint({ value: a }) === commandFingerprint({ value: b });
  if (state.meteredExpenses !== undefined && !Array.isArray(state.meteredExpenses)) invalid();
  const entries = state.meteredExpenses ?? [];
  const ids = new Set<string>(), linked = new Set<string>();
  for (const entry of entries) {
    const job = state.authority.jobs.find(j => j.id === entry?.jobId);
    if (!entry || typeof entry.id !== "string" || !entry.id || ids.has(entry.id) || !job || job.businessId !== entry.businessId
      || entry.kind !== "expense" || !validNanoUsd(entry.cost) || entry.description !== "Model/API usage" || typeof entry.occurredAt !== "string") invalid();
    ids.add(entry.id);
  }
  for (const account of state.modelAccounts ?? []) {
    for (const call of account.invocations) {
      const p=call.target??account.policy;
      if (!p.meteredPricing) {
        if (call.meteredCost || call.meteredReservation || call.meteredExpenseId) invalid();
        continue;
      }
      if (call.cost || call.reservation || call.ledgerEntryId) invalid();
      const maximum = maximumMeteredCost(p.provider, p.model, p.maxInputTokens, p.maxOutputTokens, p.meteredPricing);
      if (!equal(call.meteredReservation, maximum)) invalid();
      // Older alias responses were retained as unknown. Keep their reservation and do not invent a settlement on reload.
      const legacyUnpricedAlias=call.status==='unknown'&&call.usage?.provider==='openai'&&p.meteredPricing.provider==='openai'&&p.meteredPricing.model==='gpt-5.4-mini'&&call.usage.model==='gpt-5.4-mini-2026-03-17'&&!call.meteredCost&&!call.meteredExpenseId;
      const cost = call.usage&&!legacyUnpricedAlias ? priceMeteredUsage(call.usage, p.meteredPricing) : undefined;
      if (!equal(cost, call.meteredCost)) invalid();
      if (call.status === "settled" && !cost) invalid();
      if (call.status !== "settled" && (cost || call.meteredExpenseId)) invalid();
      if (cost) {
        const entry = entries.find(e => e.id === call.meteredExpenseId);
        if (!entry || linked.has(entry.id) || entry.businessId !== account.businessId || entry.jobId !== account.jobId
          || entry.invocationId !== call.id || !equal(entry.cost, cost)) invalid();
        linked.add(entry!.id);
        const facts = state.facts.filter(f => f.type === "model.expense_recorded.v1" && f.payload.id === entry!.id);
        const fact = facts[0];
        const { businessId: _businessId, ...payload } = entry!;
        const usageFact = state.facts.find(f => f.type === "model.usage_recorded" && f.payload.invocationId === call.id);
        if (facts.length !== 1 || fact?.type !== "model.expense_recorded.v1" || fact.businessId !== account.businessId
          || !equal(fact.payload, payload) || fact.causationId !== usageFact?.id) invalid();
      } else if (call.meteredExpenseId) invalid();
    }
  }
  if (linked.size !== entries.length) invalid();
  for (const fact of state.facts) {
    if (fact.type === "model.expense_recorded.v1" && !linked.has(fact.payload.id)) invalid();
  }
}
