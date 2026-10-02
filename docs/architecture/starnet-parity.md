# StarNet Reference Parity

## Purpose

StarNet is an architectural reference for HQOverlord, not a codebase to reproduce.

HQOverlord manages multiple isolated businesses that employ agents. StarNet primarily manages agents inside a local-first station metaphor.

This document exists to prevent architectural drift while preserving HQOverlord's own design.

For each useful StarNet capability we choose one of:

- ADOPT — preserve the underlying principle.
- ADAPT — preserve the lesson but redesign it for HQOverlord.
- ALREADY IMPROVED — HQOverlord has intentionally chosen a stronger contract or direction.
- DEFER — useful later, but premature now.
- EXCLUDE — does not belong in generic HQ core.

A difference from StarNet is not automatically a defect.

## Core architectural law

> HQ knows how to operate businesses. It does not know what any particular business does.

Business-specific behaviour belongs in applications, configuration, capabilities, workflows, knowledge and integrations rather than HQ core.

The backend/runtime is authoritative. Frontends and future visual worlds are projections of proven state and events.

## Parity ledger

| Capability | StarNet reference | HQOverlord decision | Target | Status |
|---|---|---|---|---|
| Backend authority | roster/backend lifecycle handling | ALREADY IMPROVED: backend commands and projections only | 003 | Direction established |
| Business isolation | workspace/fs containment | ADAPT: enforce business ownership across all operational resources | 003+ | Domain scope established |
| Event contracts | shared/events.js, schema.js | ADAPT: durable fact schemas with runtime validation | 003 | Compile-time catalog exists |
| Historical event stability | shared event schemas | ADOPT: independent additive-only historical payload contracts | 002 | Implemented |
| Correlation/causation | run/call/recovery IDs | ALREADY IMPROVED: mandatory tracing envelope | 002/003 | Contract exists |
| Event provenance | host/run journal | ADAPT: trusted host-generated actor/producer evidence | 003 | Pending |
| Durable persistence | durable-write/store/domain-store | ADAPT: atomic state + facts + command deduplication | 003 | Pending |
| Command idempotency | reservations/idempotency ledger | ADAPT: business-scoped command identity and conflict detection | 003 | Pending |
| Durable jobs | taskbrief/run stores | ADAPT: keep intended Job separate from execution attempts | 003/004 | Job contract exists |
| Agent loop | loop.js | ADOPT controlled bounded execution | 004 | Pending |
| Provider abstraction | providers/ | ADAPT into backend provider infrastructure | 005 | Core independent |
| Tool registry | tools/registry.js | ADAPT: definition, availability, grant and executor layers | 004 | Metadata only |
| Capability gating | capability/ | ADAPT: backend policy rather than room geometry | 004 | Pending |
| Host permissions | permissions.js | ADOPT fail-closed host enforcement | 004 | Pending |
| Approval/consent | permissions/permgrants | ADAPT: exact operation-bound approvals and scoped standing grants | 004 | Domain contract only |
| Execution journal | run-journal/recovery | ADOPT prepared -> dispatched -> result boundaries | 004 | Pending |
| Cancellation | loop/registry/MCP | ADOPT explicit requested, acknowledged and uncertain outcomes | 004 | Pending |
| Emergency stop | halt.js | ADAPT: run, business and global admission barriers | 004 | Pending |
| Truthful telemetry | run execution state/store | ADOPT evidence-backed execution observations | 004 | Principle established |
| Concurrency | workspace leases | ADAPT: business/resource claims and transactional ownership | 003/004 | Pending |
| Deterministic testing | clock-rng/replay/fault tests | ADOPT injected clock, IDs, providers and storage | 003+ | Pending |
| Context | context/transcripts | DEFER with separate execution-context boundary | 005/007 | Pending |
| Memory | memcore/memory store | ADAPT: business-scoped knowledge and memory with provenance | 007 | Deferred |
| Scheduling | cron subsystem | ADAPT durable schedule occurrences after recovery exists | 007 | Deferred |
| MCP/connectors | mcp/ | ADAPT: business-scoped connections and tool projection | 006 | Deferred |
| Secrets/OAuth | secrets/oauth stores | ADAPT into scoped credential service | 005/006 | Pending |
| API authentication | apiauth/tickets | ADAPT: authenticated principals plus business authorization | Before network exposure | Pending |
| Cost accounting | cost/spend | ADAPT exact usage evidence and provider settlement | 005 | Pending |
| Budgets | budget/budgetcaps | ADAPT business budgets with atomic reservations | 005 | Pending |
| Ledger reconciliation | ledger/spend | ADAPT settlement evidence; economic ledger remains separate | 003/005 | Domain contract exists |
| Station/game mechanics | office/frontend world | EXCLUDE from HQ core; optional presentation/application concern | — | Excluded |

## Build sequence

### Build 003 — Backend authority and durable facts

Implement:

- business-scoped commands
- trusted command context
- ownership validation
- runtime input validation
- atomic persistence of state and corresponding facts
- command idempotency
- independent historical event payloads
- bigint persistence/wire codec
- injected clock and ID generation
- business-scoped fact reading
- concurrency protection

Do not add AI execution yet.

### Build 004 — Controlled execution

Implement:

- execution attempts/runs separate from Jobs
- fake/scripted provider
- tool registry and executors
- capability and permission gates
- exact approval binding
- prepared/dispatched/result execution journal
- cancellation
- uncertain-effect handling
- retries and recovery
- emergency stop
- truthful execution telemetry

Real consequential integrations should not precede these controls.

### Build 005 — Real inference and economics

Implement:

- first real model provider
- context assembly
- exact usage accounting
- provider cost evidence
- business budgets
- atomic spend reservations
- reconciliation

### Build 006 — External integrations

Implement:

- business-scoped connectors
- MCP where useful
- secrets and OAuth
- credential isolation
- external-effect idempotency

### Build 007 — Autonomous operations

Implement:

- durable scheduling
- delegation
- richer memory/context
- business-scoped knowledge
- attenuated delegated authority

## Permanent anti-drift rules

1. Never make frontend state authoritative.
2. Never use presentation geometry as an authorization mechanism.
3. Never share grants, credentials, memory, budgets or connector sessions across businesses implicitly.
4. Never allow a privileged mode to bypass business isolation.
5. Never infer consequential-tool safety solely from a tool name.
6. Never treat a successful unrelated read as proof that an uncertain write did not occur.
7. Never silently drop invalid durable facts.
8. Never interpret unreadable authority or history as fresh empty state.
9. Never fail open when persisting approvals, reservations or consequential execution receipts.
10. Never use floating-point values for the economic ledger.
11. Never let one composition root grow to own routing, execution, recovery and every subsystem.
12. Never treat command allowlisting as a process sandbox.
13. Never embed business-specific or visual-world mechanics in generic HQ core.
14. Never let model-authored claims become authoritative operational facts without host evidence.

## Event-contract rule

Durable event payloads are historical contracts.

They must not directly reuse evolving live domain record interfaces.

Domain models may evolve independently, while an already-recorded event must retain the meaning and shape it had when it was created.

Changes to durable event contracts should therefore be additive and intentional.

## Money rule

Economic domain arithmetic uses exact integer values.

Persistence and wire formats must use an explicit validated representation rather than relying on ordinary JSON serialization of bigint.

Provider metering may require precision below ordinary currency minor units and must remain separate from economic ledger settlement until explicit rounding and reconciliation occur.

## Job versus execution rule

A Job describes intended business work.

Execution attempts, provider failures, retries, interruptions, cancellation acknowledgement, recovery and uncertain external effects belong to separate runtime records.

A transient execution failure must not automatically redefine the business Job itself.

## Truthful telemetry rule

HQ must distinguish:

- a model produced output
- a tool was requested
- a tool was dispatched
- a tool returned
- an external effect was confirmed
- an execution attempt ended
- a Job completed
- economic activity occurred

These are different facts and must never be collapsed into one optimistic status.

## Review cadence

After each major build, compare the new subsystem against the relevant StarNet implementation.

The question is not:

"Did we copy StarNet?"

The questions are:

- Did StarNet already encounter a failure mode we are about to rediscover?
- Have we preserved the useful invariant?
- Does HQOverlord's multi-business architecture require a stronger version?
- Is the difference intentional and documented?
