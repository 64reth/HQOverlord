import { money, type CurrencyCode, type Money } from "@hqoverlord/core";
import { validModelUsage, type ModelUsage } from "./model-provider.ts";

/** Exact minor units per configurable token block. No currency scale or provider prices are guessed. */
export interface ModelPricing {
  readonly provider: string;
  readonly model: string;
  readonly currency: CurrencyCode;
  readonly tokensPerBlock: bigint;
  readonly inputMinorUnits: bigint;
  readonly outputMinorUnits: bigint;
  readonly cachedInputMinorUnits?: bigint;
}

export function validateModelPricing(p: ModelPricing): void {
  if (!p || typeof p.provider !== "string" || !p.provider || typeof p.model !== "string" || !p.model
    || !/^[A-Z]{3}$/.test(p.currency) || typeof p.tokensPerBlock !== "bigint" || p.tokensPerBlock <= 0n
    || [p.inputMinorUnits, p.outputMinorUnits, ...(p.cachedInputMinorUnits === undefined ? [] : [p.cachedInputMinorUnits])]
      .some(n => typeof n !== "bigint" || n < 0n)) throw new TypeError("Invalid model pricing");
}

export function priceModelUsage(usage: ModelUsage, pricing: ModelPricing): Money | undefined {
  validateModelPricing(pricing);
  if (!validModelUsage(usage)) throw new TypeError("Invalid model usage");
  if (usage.provider !== pricing.provider || usage.model !== pricing.model) return undefined;
  const cached = BigInt(usage.cachedInputTokens ?? 0);
  const numerator = (BigInt(usage.inputTokens) - cached) * pricing.inputMinorUnits
    + cached * (pricing.cachedInputMinorUnits ?? pricing.inputMinorUnits)
    + BigInt(usage.outputTokens) * pricing.outputMinorUnits;
  // Round the combined call up once to the host's ledger minor unit.
  return money((numerator + pricing.tokensPerBlock - 1n) / pricing.tokensPerBlock, pricing.currency);
}

export function maximumModelCost(provider: string, model: string, input: number, output: number, p: ModelPricing): Money | undefined {
  // Reserve the more expensive input rate even when cached pricing is unusual.
  return priceModelUsage({ provider, model, inputTokens: input, outputTokens: output }, {
    ...p, inputMinorUnits: p.cachedInputMinorUnits !== undefined && p.cachedInputMinorUnits > p.inputMinorUnits
      ? p.cachedInputMinorUnits : p.inputMinorUnits,
  });
}
