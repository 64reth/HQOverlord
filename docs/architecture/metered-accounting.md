# Versioned provider expenses

Ordinary `Money.minorUnits` keeps its existing currency-minor-unit semantics. USD budgets and historical ledger expenses remain cents; no state or historical event is rescaled or repriced.

New jobs can opt into `meteredPricing`. This is exclusive with legacy `pricing`, and a job cannot change its admitted policy. `NanoUsd` carries `version: 1`, `currency: USD`, `unit: nanodollar`, and a non-negative bigint `nanodollars`. One dollar is 1,000,000,000 nanodollars; one cent is 10,000,000. Nanodollars preserve fractional microdollars at the configured inexpensive model rates.

The input/output/cached rates are explicit bigint nanodollars per token block. Calculation uses integer multiplication and division. An indivisible rate rounds the combined call up by less than one nanodollar; it never rounds a new metered call up to a cent. Actual calls accumulate in `modelMeteredTotals` without cent conversion. At the supplied $0.10/$0.50 per million rates, 448 input and 37 output tokens cost 63,300 nanodollars: $0.000063300.

Admission converts an existing USD cent budget explicitly to nanodollars, reserves the conservative configured input/output maximum (including a higher cached rate if present), and compares the sum against that limit. Known actual usage reconciles the reservation after the provider returns. Uncertain usage/pricing retains its reservation and prevents further calls. A provider violating its caps yields a controlled failure while preserving the reported cost; HQ never hides actual spend to make a budget appear satisfied.

New expenses are stored in `DurableState.meteredExpenses`, with a corresponding additive `model.expense_recorded.v1` fact, saved atomically alongside usage and invocation reconciliation. `inspectMeteredExpenses` is scoped to the business/job. Historical `ledger.entry_recorded` payloads and `inspectLedger` are unchanged; new metered calls do not also create cent expenses. Consumers must include the new metered records when reporting provider expenses and must not count them twice.

`nanoUsdToCentsCeiling` is an explicit optional reporting boundary for an accumulated total; it does not create a second ledger entry. `usdCentsToNanoUsd` rejects non-USD currency rather than inventing FX. `formatNanoUsd` uses integer quotient/remainder for human-readable dollar display. Legacy and new records continue to use the existing bigint JSON codec and restore validation. Old jobs remain on their original policy and pricing; a new job is required to opt into finer metering.

The real ignition entry point is `.mts`, so Node treats just that script as an ES module without changing the repository's module system. Automated tests use fake providers or mocked transport and never invoke real models.
