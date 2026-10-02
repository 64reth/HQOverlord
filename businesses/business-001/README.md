# Business 001

Neutral identity: affordable AI website assistants for small businesses. This directory is a customer of HQ; generic packages do not import it. No permanent brand has been chosen.

The first mission is **First £10 Customer**, due **Sunday 4 October 2026 (Europe/London)**. Success means a genuine external customer pays £10, supported by human-confirmed payment evidence. Drafts, invoices, internal transfers and simulated sales are not revenue.

`manifest.ts` owns the offer, mission, workflow dependencies, five workforce roles, routing and authority rules. `load.ts` loads it through the existing generic authority store and durable commands, creating five agents and one queued analysis job. The workflow remains a manifest, not an implemented scheduler. Supply a prospect and source material before executing the analysis job. No web-fetch/contact/deployment tools are registered.

Human approval/manual handoff is mandatory before customer contact, publication, deployment, changing prices, purchases or spend outside admitted model budgets. The Delivery worker drafts handoff material; it does not perform external delivery. Human payment confirmation and ordinary GBP revenue recording are manual handoffs: HQ currently has no revenue-recording command. This configuration never creates a revenue entry or customer.

The £5 allocation is GBP configuration metadata, not an enforced aggregate budget or a USD conversion. The user-stated £20 funding context is not OpenAI account telemetry. Each model job has a separate enforced **five-cent USD hard limit**, using versioned nanodollar pricing through `executeModelJob`; no exchange rate is assumed. Track the aggregate GBP allocation manually until HQ has the necessary currency/budget primitive.

`jobModelOptions()` chooses the inexpensive default `gpt-6-luna` for a job; agent identity carries no model. A different model requires explicit matching pricing. Provider credentials remain the caller's environment concern, outside this directory.

Run `npm run business:001:bootstrap` to instantiate the business in `.local/state.json` (ignored by Git). It does not invoke any model or external integration. Run `npm run business:001:preview` for a disposable, offline load demonstration and `npm run test:business-001` for deterministic acceptance. For an operator-selected durable store, call `loadBusiness001(store, clock, ids)` once at bootstrap; it is idempotent for identical configuration and must not run concurrently against the same store. No permanent state is created by the preview or tests. Deleting this directory leaves HQ packages and runtime intact.
