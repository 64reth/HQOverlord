# Selected StarNet runtime primitives

Read-only reference revision: fbddbf992f8e7082196f07c3024781fcf1c276fc.
Copyright (c) 2026 Andrew Sims. Full MIT notice: [LICENSE](LICENSE).
No reference artwork, sprites, station assets, branding or third-party packages
were copied. The reference checkout was never modified or launched.

Unchanged source (verified by SHA-256 against the reference checkout):

- sidecar/tools/builtin/{fs,patchparse,fuzzymatch,code,browser,browserchallenge,browser-workflow,browser-proxy}.js
- sidecar/tools/code-worker.js, sidecar/workspace-reserved.js
- tools/builtin/{notebook,skills}.js; sidecar/skills/{catalog,runtime}.js and 74 library/*.md procedures (each declares MIT)
- frontend/app/{pipeline,autopilot,recipes}.js, shared/{schema,specialties}.js
- sidecar/{cron,nightshift,context,memcore,recovery-policy,loopjob,loopjob-store,harness-import,skillstore,task-postconditions,attachments}.js, sidecar/routing/verdict.js
- sidecar/providers/{openai-compatible,anthropic,gemini,openrouter,provider,errorClass,prices,toolschema,sanitize}.js
- sidecar/channels/{hub,telegram.format,discord,discord.transport,discord.gateway,slack,matrix,signal,signal.transport}.js
- sidecar/capability/registry.js
- sidecar/mcp/{client,translate}.js, sidecar/tools/fence.js

Here sidecar/tools/* also appears under tools/* and workspace-reserved.js at the
vendor root to preserve relative imports. Fence has a tools root copy for the
same reason. This layout does not introduce a second runtime/store owner.

Adapted source:

- tools/builtin/toolsearch.js: source deferred scoring/lifecycle; fixes the one-tool shelf case so a granted lone tool remains discoverable.

- tools/builtin/web.js: injected DNS-pinned HTTP transport avoids an unnecessary SDK dependency; host keys remain scoped to business and exact origin.

- sidecar/channels/telegram.js: injected actual transport for durable polling offsets and source mention/observe hooks.
- sidecar/channels/telegram.transport.js: additive knownRejected proof requires actual HTTP 429 plus Bot API ok:false/error_code:429; no inference from network exceptions or 5xx.
- sidecar/channels/adapter.js: awaited durable intake and callback/cursor acknowledgement.
- sidecar/channels/matrix.transport.js: canonical cursor callback and restart resume seam.
- sidecar/routing/chain.js: awaited durable routing/barrier seams and cancellation-aware parked joins.

- frontend/app/specialties.js: injected per-business storage; no browser-global authority.
- frontend/app/personas.js: exports the existing composer to the host adapter.
- sidecar/acp/core.js: HQ metadata/session identity and once-only consent;
  never offers broad persistent editor permission.
- sidecar/channels/adapter.js: awaits durable asynchronous intake before ACK;
  permits HQ to disable automatic retry for uncertain outbound sends.
- sidecar/channels/slack.transport.js: requires actual WebSocket handshake;
  event ACK follows durable intake rather than arrival in RAM.
- sidecar/channels/matrix.transport.js: batch cursor commits only after every
  update is acknowledged by durable intake.
- sidecar/mcp/transport.http.js: bounded response/SSE bodies and request timeout.
- root/sidecar child-env.js: strict environment allowlist; no provider/channel
  secrets into browser or worker processes.
- root/sidecar failopen.js: small HQ auxiliary failure counter; no reference
  credentials/context or model-controlled content logging.

HQ adapters retain owned business/agent identities, private workspace/profile
keys, live grants, exact-operation consent, cancellation, save-before-event
publication and bigint accounting. MCP annotations never authorize effects.
Provider adapters cannot silently buy another generation; original wire usage
is checked before normalizers can turn absent fields into zero. Gemini output
cap is enforced at the host seam. Cache creation requires its explicit tariff.

Only registered/accepted behaviors are exposed. Copied helper source does not
prove every reference tool or lifecycle. Passing proof and remaining limitations:
docs/architecture/starnet-functional-parity.md at the repository root.

- sidecar/openai-compat-helpers.js: source pure request/auth/message/response helpers; HQ model alias, no reference runtime factory or dependency.

Unchanged SOURCE recipe-drift.js, recipefit.js and recipe-catalog/*.js provide advisory portable procedures and history-derived checks; none launches automatically or grants tools.

Unchanged tools/builtin/comms.js supplies known-target resolution, platform chunking and truthful per-file send receipts. HQ injects current business conversations, fresh acting-crew jailed reads and the exact-consent host transport; unknown external effects are never replayed.

SOURCE result-contract.js retains bounded schema guards, local-only resolution and strict result inspection. HQ replaces its Ajv construction seam with result-schema.js, a dependency-free, non-coercing bounded Draft-7 compiler; unknown keywords/dialects/formats are refused. No shared event validator is widened.

Unchanged SOURCE compaction-summarizer.js and compaction-fidelity.js provide bounded dialogue partitions, refusal checks and verbatim user steering. HQ admits every summary through canonical exact-budget invoices, archives original native history before dispatch, preserves Responses native tail groups and retains UNKNOWN overflow commitments. No hidden provider summarizer or automatic paid replay.

telegram.js additionally forwards SOURCE adapter mentionPatterns and observeUnmentioned hooks. HQ persists mention settings and owned observe-only records, learns actual getMe identity/privacy metadata, and never dispatches or downloads media for an observed message.
