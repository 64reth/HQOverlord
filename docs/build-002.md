# Build 002: Core domain and event spine

`@hqoverlord/core` defines provider-independent records. `@hqoverlord/events`
defines facts about those records and depends only on core. Both are private,
source TypeScript workspace packages for Node 24. There are no new third-party
dependencies. Run `npm run typecheck` and `npm test` at the workspace root.
Each package also exposes those scripts for targeted checks.

## Domain boundaries

- **Business** is the operational isolation boundary, with identity, lifecycle,
  and creation/update timestamps.
- **Agent** belongs to one business. Generic capability labels and tool IDs
  describe references, not execution grants or provider/model settings.
- **Tool** describes an executable host capability and its read-only or
  consequential effect. Definitions can be shared; business availability and
  permissions must be resolved by the future host.
- **Job** belongs to one business, has an objective and lifecycle, and may
  reference an agent and workflow. Those references must resolve within the
  same business.
- **Workflow** is a reusable orchestration identity with a description and
  lifecycle. Steps, scheduling, and execution semantics remain future work.
- **Approval** records a requirement for a specific operation, optionally
  attributed to a job. Its pending/approved/rejected/cancelled state must be
  decided and enforced by the host.
- **LedgerEntry** records actual revenue or expense, optionally attributed to
  a job. Amounts are non-negative bigint minor units with an explicit uppercase
  currency code; kind supplies direction. Currency scale and supported codes
  must be validated by the host. No floating-point arithmetic is used.

IDs are opaque branded strings, including operation, event, and correlation IDs.
Factories reject empty values and brand trusted inputs; they do not generate
unique IDs or prove existence, business membership, or permissions. Records and
arrays are readonly to discourage mutation, without claiming runtime freezing.
Timestamps are UTC ISO 8601 strings by contract; runtime validation is future work.

## Recorded facts

The initial catalog has ten events: business/agent/job creation, job start,
completion and failure, approval request/grant/rejection, and ledger recording.
Tool and workflow lifecycle events can be added when runtime operations need
them. A mapped discriminated union associates each event type with its payload,
so switching on `type` narrows the payload. Queued job creation and pending
approval requests also constrain their snapshot status.

Every current event is business-scoped. Each envelope requires a unique event
ID, occurrence timestamp, correlation ID, and causation ID. Correlation groups a
request or operation chain; causation names its immediate predecessor event.
Root events explicitly set causation to null. A future global event should
declare its unscoped envelope explicitly rather than weaken current scope.

Events describe committed facts, never commands, intentions, progress animation,
or inferred success. Only a future authoritative host can establish those facts,
verify matching payload/envelope business IDs, generate unique IDs, and publish
them after the operation actually happens. Completion does not imply revenue;
ledger recording requires separate evidence of real economic activity.

Treat the catalog as additive-only: add event types and compatible optional
fields, preserve existing meanings, and use a new event type for an incompatible
change. Snapshot payloads currently reference domain types; future domain changes
must preserve these historical shapes or introduce explicit versioned event
snapshots. This is an in-memory contract, not a persistence or wire protocol.
Bigints require explicit serialization (for example decimal strings with schema
validation) before JSON transport; never convert monetary values to numbers.

## Current guarantees and future runtime

Compile-time checks cover ID separation, business scope, integer money, event
narrowing, and mandatory tracing. Node tests cover representative records,
exact large amounts, factories, tracing, and core dependency boundaries. The
shared TypeScript library excludes browser globals. No domain record depends on
frontend presentation, a provider, or an integration.

Types alone do not enforce isolation, legal transitions, approvals, immutable
storage, delivery ordering, replay, idempotency, or authenticity of incoming
data. These belong to the future backend/runtime. This slice implements no tool
execution, event bus, agent loop, persistence, frontend, or external integration.
