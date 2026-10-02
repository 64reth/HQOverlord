import {
  currencyCode,
  money,
  type Money,
} from "@hqoverlord/core";

export interface StoredMoney {
  /**
   * Base-10 integer string.
   *
   * JSON has no bigint type, so durable money must never pass through
   * JavaScript number serialization.
   */
  readonly minorUnits: string;
  readonly currency: string;
}

export function encodeMoney(value: Money): StoredMoney {
  return {
    minorUnits: value.minorUnits.toString(10),
    currency: value.currency,
  };
}

export function decodeMoney(value: StoredMoney): Money {
  if (!/^(0|[1-9][0-9]*)$/.test(value.minorUnits)) {
    throw new TypeError("Stored money minor units must be a non-negative base-10 integer");
  }

  return money(
    BigInt(value.minorUnits),
    currencyCode(value.currency),
  );
}
