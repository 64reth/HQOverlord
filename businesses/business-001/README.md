# Business 001

Configured business: AI website assistant service. This directory is a customer of HQ; generic packages do not import it. Its workforce is Prospect Research, Knowledge Builder, Assistant Builder, QA and Delivery.

`manifest.ts` supplies workforce, workflow dependencies, routing and authority rules. Bootstrap creates five agents and no jobs. Operator-supplied sources create durable jobs through `prepareWork`; generic jobs can also be queued from COMMS. No customer, payment or revenue is created by preparation.

Research may use the guarded public-text `web.read` tool. Sources remain untrusted reference data. Knowledge remains explicitly unverified. Delivery requires exact human approval and produces a local packet; contact, publication, deployment and payment confirmation remain manual.

The GBP allocation and user-stated funding are configuration metadata, not provider telemetry or an enforced aggregate budget. Each model job separately enforces a five-cent USD hard limit with exact nanodollar accounting. There is no currency conversion.

`jobModelOptions()` selects the configured provider/model per job, independently of agent identity. Credentials stay in the host environment. Paid model execution is disabled by default.

Run `npm run business:001:bootstrap` for the ignored local store, `npm run business:001:preview` for an offline disposable preview, and `npm run test:business-001` for deterministic acceptance. One runtime writer must own a store.

Startup removes only the obsolete, never-executed development fixture identified by its original bootstrap command. It refuses cleanup if execution, accounting, artifacts, dependencies or surviving causal history exist. All genuine work and financial history are retained. The cleanup is idempotent and business-scoped.
