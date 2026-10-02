declare const currencyBrand: unique symbol;
export type CurrencyCode = string & { readonly [currencyBrand]: "CurrencyCode" };

export interface Money {
  /** Exact integer minor units, e.g. 1234n means GBP 12.34. Never a JS number. */
  readonly minorUnits: bigint;
  readonly currency: CurrencyCode;
}

/** Checks code shape only; supported currencies and minor-unit scales belong to the host. */
export function currencyCode(value: string): CurrencyCode {
  if (!/^[A-Z]{3}$/.test(value)) throw new TypeError("Currency must be a three-letter uppercase code");
  return value as CurrencyCode;
}

/** Ledger amounts are magnitudes; revenue/expense supplies their economic direction. */
export function money(minorUnits: bigint, currency: CurrencyCode): Money {
  if (typeof minorUnits !== "bigint" || minorUnits < 0n) {
    throw new TypeError("Money must use non-negative bigint minor units");
  }
  return { minorUnits, currency };
}
