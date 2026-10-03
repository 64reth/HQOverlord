import type { BusinessId, JobId, LedgerEntryId, Money } from "@hqoverlord/core";
import type { ModelUsage } from "./model-provider.ts";
import type { ModelPricing } from "./model-pricing.ts";
import type { MeteredPricing, NanoUsd } from "./metered-cost.ts";

export interface ModelPolicy extends ModelTargetPolicy {
  readonly maxRetries?:number;
  readonly fallbackTargets?:readonly ModelTargetPolicy[];
  readonly budget?:Money;
}
export interface ModelTargetPolicy {
  readonly reasoningEffort?:string;
  readonly provider: string;
  readonly model: string;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly pricing?: ModelPricing;
  readonly meteredPricing?: MeteredPricing;
}

export interface ModelInvocation {
  readonly recoveryOf?:string;
  readonly purpose?:'compaction';
  readonly allowedMaxOutputTokens?:number;
  readonly retryOf?:string;
  readonly target?:ModelTargetPolicy;
  readonly failureReason?:import('./model-recovery.ts').RecoveryReason;
  /** Local transcript of the admitted turn. Credentials are not part of ModelRequest. */
  readonly transcript?: {readonly instructions:string;readonly input:string;readonly inputContent?:import('./model-provider.ts').ModelRequest['inputContent'];readonly decision?:unknown};
  readonly id: string;
  /** Unknown calls retain their reservation across cancellation/restart. */
  readonly status: "reserved" | "unknown" | "settled";
  readonly reservation?: Money;
  readonly usage?: ModelUsage;
  readonly cost?: Money;
  readonly ledgerEntryId?: LedgerEntryId;
  readonly meteredReservation?: NanoUsd;
  readonly meteredCost?: NanoUsd;
  readonly meteredExpenseId?: string;
}

export interface JobModelAccount {
  readonly activeTarget?:number;
  readonly continuation?: unknown;
  readonly businessId: BusinessId;
  readonly jobId: JobId;
  readonly policy: ModelPolicy;
  readonly invocations: readonly ModelInvocation[];
}

export function modelAccountTotals(account: JobModelAccount): { spent: bigint; reserved: bigint } {
  if (account.policy.meteredPricing) throw new TypeError("Use modelMeteredTotals for nanodollar accounts");
  return account.invocations.reduce((totals, call) => ({
    spent: totals.spent + (call.cost?.minorUnits ?? 0n),
    reserved: totals.reserved + (call.status === "settled" ? 0n : call.reservation?.minorUnits ?? 0n),
  }), { spent: 0n, reserved: 0n });
}

export function modelMeteredTotals(account: JobModelAccount): { spentNanodollars: bigint; reservedNanodollars: bigint } {
  if (!account.policy.meteredPricing) throw new TypeError("This account uses legacy money, not nanodollars");
  return account.invocations.reduce((totals, call) => ({
    spentNanodollars: totals.spentNanodollars + (call.meteredCost?.nanodollars ?? 0n),
    reservedNanodollars: totals.reservedNanodollars + (call.status === "settled" ? 0n : call.meteredReservation?.nanodollars ?? 0n),
  }), { spentNanodollars: 0n, reservedNanodollars: 0n });
}
