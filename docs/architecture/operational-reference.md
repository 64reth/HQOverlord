# Operational reference implementation map

StarNet is read-only reference, not an upstream dependency. HQ keeps canonical authority in its runtime.

| Actual StarNet pattern | HQ equivalent | Decision and reason |
| --- | --- | --- |
| `sidecar/loop.js` executeCalls pairs call/result IDs, checks cancellation and funnels tools through dispatch | ExecutionEngine and durable operation checkpoints | Reuse host gating; keep business scope and saved-before-dispatch approvals. No speculative provider retries. |
| `sidecar/tools/registry.js` capability → schema → consent → durable dispatch → execution | ToolRegistry, capability gate, exact-operation approval | Adapt: permissions belong to backend agents, never room layout. |
| `sidecar/tools/builtin/notebook.js` injected store/clock, source run, reference-only memory; `memcore.js` tracks origin | Sources, immutable artifacts, referenced knowledge | Adapt namespaces from station/agent to business; claims remain unverified reference data. No autonomous belief/trust engine. |
| Task-board commands in `tools/builtin/station.js` do not start work; team dispatch runs child work and forwards lifecycle | Explicit dependent jobs with durable upstream output references | Adapt to backend-owned jobs, no browser task board authority or giant workflow engine. |
| `sidecar/durable-write.js` temp-file fsync before atomic rename | FileDurableStore | Reuse barrier; directory sync best effort on Windows. One runtime writer per store. |
| `tools/builtin/web.js` assertSafeUrl → DNS check → pinned connection, manual per-hop redirects | Generic web.read | Reuse guards/pinning; direct HTTP text only, no search fallback, credentials, remote reader or browser claim. |
| `shared/events.js` frozen historical schemas; `channels/sse.js` metadata-only egress, bounded clients, keepalive/replay | Additive HQ facts and scoped SSE projections | Reuse SSE; reconcile full authoritative business projection at each durable transition/reconnect rather than maintain competing browser state. |
| `frontend/app/world.js` run start/end and paired tool events drive work glyphs; disconnect dims stale telemetry | Agent projection from jobs/executions + live in-process ownership | Reuse factual states; interrupted restored runs are labelled interrupted, never animate as live. |
| `frontend/app/stationbake.js` static floor/wall geometry separate from entities; `frontend/js/assets.js` reusable agent assets | One canvas room, cached original workstation geometry and original agent SVG | Adapt to responsive canvas station, no campus engine or branding/assets copied. |
| `frontend/css/interface.css` responsive instrument panels; world reconnect reconciles snapshot | StarNet-style operator cabinet and one EventSource with hydration/stale state | Reuse instrument hierarchy; no frontend-owned roster/localStorage operational state, no fake revenue/work counters. |

All model and web tests inject providers/transports. The UI only starts local preparation and explicit approved local handoffs; it does not contact customers or deploy. Real provider execution remains an explicit operator action via existing tooling.
