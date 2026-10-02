# Operator cabinet

Run `npm run build:web`, then `npm run control-centre`, and open the printed loopback address. The application follows the StarNet crew–world–COMMS cabinet and grouped bottom docks. [Source map, licence findings and parity checklist](starnet-ui-reference.md) explain the reference boundary.

CREW, canvas stations and COMMS share selection. Dossiers expose current permissions and recorded work. COMMS shows durable job activity, not a simulated conversation. Queue a generic job in the composer; starting execution is a separate operator action. WORK opens jobs, knowledge, artifacts, activity and source-backed preparation. SYSTEM contains exact-operation approvals, recorded ledger data, business configuration and licence notices.

Source-backed preparation accepts genuine supplied material and a stable request identifier, creating five dependent jobs without executing them. Research can use public static textual sources; knowledge stays unverified. Review QA and source provenance before granting Delivery's exact operation. Resume an approved operation from Jobs. Delivery produces a local artifact; contact, deployment, payment confirmation and revenue recording remain manual.

The application uses the existing Business 001 durable store and idempotently enables the configured tools. Bootstrap creates no objective/job. Only the obsolete unexecuted bootstrap fixture is removed; cleanup refuses to erase operational/financial/causal history. One runtime/server process must own a file.

The boundary remains `DurableRuntime → scoped projection → station-model adapter → canvas/crew/COMMS/windows`. Saves precede SSE publication. Reconnect sends complete authoritative hydration; after server restart the UI renews the host-minted HttpOnly session. One EventSource and visible heartbeat health drive the view. Disconnection/staleness makes activity unknown and disables mutations. Restored running jobs without ownership are interrupted. No reconnect retries jobs. Pending approvals remain durable.

The canvas has an original static room bake, original agent artwork, live entity/status layers, pointer hit testing, pan/zoom/reset and selection rings. Work/tool lamps require actual live ownership/dispatch. No active job means idle; a latest terminal outcome is separately labelled. There is no simulated walking, customer or delivery animation. Responsive layout retains crew and world, then COMMS, at 390px; desktop uses three columns.

Money is exact recorded data. Ledger revenue aggregates by currency without conversion; an empty GBP revenue ledger displays zero. Model spend retains nanodollar precision and unsettled invocations remain explicit. GBP allocation is labelled configuration, not an enforced aggregate USD budget. Keys stay in the server environment. Paid execution requires explicit `HQ_ENABLE_MODEL_EXECUTION=1` and `OPENAI_API_KEY`; it is disabled by default.

The server binds IPv4 loopback and validates Host/Origin, uses a HttpOnly SameSite cookie, bounds request bodies and slow SSE clients, and enforces an explicit business allowlist before transmission. This is a trusted local operator surface, not remote multi-user authentication. Generic job creation resolves the agent in trusted business scope; event actor and producer come from the backend.

Existing runtime safety remains: immutable artifacts/sources, dependency completion plus durable outputs, exact-operation approvals, capability gates, persisted cancellation, provider-neutral execution, tagged bigint storage and atomic completion/output saves. `web.read` validates every redirect and every DNS answer, pins public connections while preserving TLS identity, limits time/body size and never executes page JavaScript. Deterministic tests inject providers/transports and use no external service.

Verify workspace/business tests, workspace/root typecheck, web build and diff check. `node scripts/control-centre-smoke.mts` uses installed Chrome, isolated temporary state and blocked external page requests to verify both widths, selections, all supported windows, durable job creation and authoritative SSE. Screenshots are in ignored `apps/control-centre/.local/smoke/`.
