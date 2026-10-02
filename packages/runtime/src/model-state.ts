import type { BusinessId, JobId, LedgerEntryId, Money } from "@hqoverlord/core";
import type { ModelUsage } from "./model-provider.ts";
import type { ModelPricing } from "./model-pricing.ts";

export interface ModelPolicy {
  readonly provider: string;
  readonly model: string;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly pricing?: ModelPricing;
  readonly budget?: Money;
}

export interface ModelInvocation {
  readonly id: string;
  /** Unknown calls retain their reservation across cancellation/restart. */
  readonly status: "reserved" | "unknown" | "settled";
  readonly reservation?: Money;
  readonly usage?: ModelUsage;
  readonly cost?: Money;
  readonly ledgerEntryId?: LedgerEntryId;
}

export interface JobModelAccount {
  readonly businessId: BusinessId;
  readonly jobId: JobId;
  readonly policy: ModelPolicy;
  readonly invocations: readonly ModelInvocation[];
}

export function modelAccountTotals(account: JobModelAccount): { spent: bigint; reserved: bigint } {
  return account.invocations.reduce((totals, call) => ({
    spent: totals.spent + (call.cost?.minorUnits ?? 0n),
    reserved: totals.reserved + (call.status === "settled" ? 0n : call.reservation?.minorUnits ?? 0n),
  }), { spent: 0n, reserved: 0n });
}
