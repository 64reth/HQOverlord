import { currencyCode, money, type BusinessId, type JobId, type Money } from "@hqoverlord/core";
import { modelUsageMatchesPricing, validModelUsage, type ModelUsage } from "./model-provider.ts";

/** Provider accounting only. Legacy Money.minorUnits and ledger facts are never rescaled. */
export interface NanoUsd {
  readonly version: 1;
  readonly currency: "USD";
  readonly unit: "nanodollar";
  readonly nanodollars: bigint;
}
export const NANODOLLARS_PER_USD = 1_000_000_000n;
export const NANODOLLARS_PER_CENT = 10_000_000n;
export function nanoUsd(nanodollars: bigint): NanoUsd {
  if (typeof nanodollars !== "bigint" || nanodollars < 0n) throw new TypeError("Nanodollars must be a non-negative bigint");
  return { version: 1, currency: "USD", unit: "nanodollar", nanodollars };
}
export function validNanoUsd(value: unknown): value is NanoUsd {
  const v = value as NanoUsd | undefined;
  return !!v && v.version === 1 && v.currency === "USD" && v.unit === "nanodollar" && typeof v.nanodollars === "bigint" && v.nanodollars >= 0n;
}
export function usdCentsToNanoUsd(value: Money): NanoUsd {
  if (value.currency !== "USD") throw new TypeError("USD metering cannot convert another currency without FX");
  return nanoUsd(value.minorUnits * NANODOLLARS_PER_CENT);
}
/** Explicit reporting boundary; apply once to an accumulated total, not to each call. */
export function nanoUsdToCentsCeiling(value: NanoUsd): Money {
  if (!validNanoUsd(value)) throw new TypeError("Invalid scaled cost");
  return money((value.nanodollars + NANODOLLARS_PER_CENT - 1n) / NANODOLLARS_PER_CENT, currencyCode("USD"));
}
export function formatNanoUsd(value: NanoUsd): string {
  if (!validNanoUsd(value)) throw new TypeError("Invalid scaled cost");
  return `$${value.nanodollars / NANODOLLARS_PER_USD}.${(value.nanodollars % NANODOLLARS_PER_USD).toString().padStart(9, "0")} USD`;
}
export interface MeteredPricing {
  readonly version: 1;
  readonly currency: "USD";
  readonly unit: "nanodollar";
  readonly provider: string;
  readonly model: string;
  readonly tokensPerBlock: bigint;
  readonly inputNanodollars: bigint;
  readonly outputNanodollars: bigint;
  readonly cachedInputNanodollars?: bigint;
  readonly cacheCreationInputNanodollars?: bigint;
}
export function validateMeteredPricing(p: MeteredPricing): void {
  if (!p || p.version !== 1 || p.currency !== "USD" || p.unit !== "nanodollar" || typeof p.provider !== "string" || !p.provider
    || typeof p.model !== "string" || !p.model || typeof p.tokensPerBlock !== "bigint" || p.tokensPerBlock <= 0n
    || [p.inputNanodollars, p.outputNanodollars, ...(p.cachedInputNanodollars === undefined ? [] : [p.cachedInputNanodollars]), ...(p.cacheCreationInputNanodollars === undefined ? [] : [p.cacheCreationInputNanodollars])]
      .some(n => typeof n !== "bigint" || n < 0n)) throw new TypeError("Invalid nanodollar pricing");
}
export function priceMeteredUsage(u: ModelUsage, p: MeteredPricing): NanoUsd | undefined {
  validateMeteredPricing(p);
  if (!validModelUsage(u)) throw new TypeError("Invalid model usage");
  if (!modelUsageMatchesPricing(u,p)) return undefined;
  const cached = BigInt(u.cachedInputTokens ?? 0);
  const created = BigInt(u.cacheCreationInputTokens ?? 0);
  if(created>0n&&p.cacheCreationInputNanodollars===undefined)return undefined;
  const numerator = (BigInt(u.inputTokens) - cached - created) * p.inputNanodollars
    + created * (p.cacheCreationInputNanodollars ?? p.inputNanodollars) + cached * (p.cachedInputNanodollars ?? p.inputNanodollars) + BigInt(u.outputTokens) * p.outputNanodollars;
  // At most one nanodollar of conservative rounding per call; never a whole cent.
  return nanoUsd((numerator + p.tokensPerBlock - 1n) / p.tokensPerBlock);
}
export function maximumMeteredCost(provider: string, model: string, input: number, output: number, p: MeteredPricing): NanoUsd | undefined {
  const maximum=[p.inputNanodollars,p.cachedInputNanodollars??0n,p.cacheCreationInputNanodollars??0n].reduce((a,b)=>a>b?a:b);
  return priceMeteredUsage({ provider, model, inputTokens: input, outputTokens: output }, { ...p,inputNanodollars:maximum });
}
export interface MeteredExpense {
  readonly id: string;
  readonly businessId: BusinessId;
  readonly jobId: JobId;
  readonly invocationId: string;
  readonly kind: "expense";
  readonly cost: NanoUsd;
  readonly description: "Model/API usage";
  readonly occurredAt: string;
}
