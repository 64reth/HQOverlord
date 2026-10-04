# StarNet 0.10 final Hermes parity map

**Audit baseline:** StarNet `0.9.0` at `fc4522309bd20d936e0d4dec351c5ff7936fc61e`; Hermes Agent
`origin/main` at `10a2b3d7a27ab2957ea12136506a5fdf7b7dd4fa` (2026-08-07). The prior
2026-07-25 audit is useful history but is not current authority: StarNet's merged Hermes execution-parity
work and thousands of newer Hermes commits changed both sides of the comparison.

## Executive verdict

StarNet is no longer missing a Hermes-class core agent loop. Its tool surface, compaction and provider
recovery, approvals, durable schedules, background delegation, local/Docker/SSH execution, skills authoring,
checkpoints, and station recovery are credible peer capabilities. The remaining risk is
concentrated in **failure recovery, operability, extension lifecycle, and cross-surface continuity**.

Do not claim “100% Hermes parity” for 0.10 until gates G0-G4 below are proven in the shipped application.
G5-G9 are the remaining parity lanes; either close them or constrain the corresponding marketing claim.
The later breadth list is not a reason to hold the release if StarNet says plainly what it does not offer.

Parity here means that a normal user can complete the same class of work, survive the common failure modes,
diagnose a failure without reading source, and recover without duplicate side effects or lost evidence. It
does not mean copying every provider, chat adapter, research mode, or cloud sandbox Hermes exposes.

### Cross-domain completion/refusal audit (2026-08-14)

The attended-login defect exposed a broader prompt conflict, not a LinkedIn-specific integration problem.
The main operating doctrine told an agent whose dedicated integration answered `not connected` to explain
Settings and ask before trying a “louder” route. That instruction could hand work back on any platform even
when a safe, already-authorized browser, request, shell, or other tool route was live. The repair candidate now
requires automatic escalation through safe authorized alternatives; a question is permitted only when the next
route itself needs Commander authentication, exact consent, or a genuinely material decision. Connection setup
is reported only when it remains the final blocker after those alternatives are exhausted.

Task admission had a second cross-domain brake: a selected model that the live catalog definitively marked as
tool-less caused an immediate refusal before the configured fallback-model chain could run. Task runs now promote
the first same-provider configured fallback that is not definitively tool-less, emit a `provider.fallback` receipt
with reason `tool_support`, and proceed. A cold catalog remains fail-open. Admission refuses only when the primary
and every configured fallback are definitively incapable of tool calling.

The audit found no other default artificial completion ceiling on an ordinary capability-equipped task:
per-run iteration, spend, delegated-worker, and concurrent-agent caps default to unlimited; long output is parked
durably and can be read in focused ranges; context compacts and re-injects the active plan; transient model calls
retry with backoff and configured failover; truncated answers continue; empty/announcement-only turns are nudged;
failed tools receive bounded alternate-path recovery; and task classification defaults ambiguous user requests to
tool-enabled work rather than tool-less chat.

This is not a promise that every call executes. The remaining refusals are authority or reality boundaries, not
fallback policy: an explicit denial/cancel/E-STOP; absent or disabled capability; missing authentication/MFA or no
configured credential/provider; user-configured spend/turn/concurrency/hook limits; protected paths, secret access,
SSRF or prompt-injection/taint floors; an external outage after retries/fallbacks; and an unattended run attempting
an effect that requires a watched confirmation without a recorded per-routine grant. Ordinary local agent runs also
do not receive arbitrary physical mouse/keyboard or general visible-desktop control. `browser.login` is the narrow
attended visible-window exception for account authentication, and its dedicated profile can then be reused by
headless work. Do not market “will never refuse”; the correct claim is “will exhaust safe, authorized alternatives
and stop only at a specific, truthful human/authority/capability/external boundary.”

### P0 attended browser-login release blocker (2026-08-13)

**Status: RED for the soaked 0.10.0 candidate and every later candidate without an installed receipt.** The
soaked Windows build globally set `STARNET_BROWSER_HEADLESS=1` on its sidecar. That made the advertised
`browser.login` path refuse before it could open the visible sign-in window, then pushed the user toward a
manually launched remote-debugging Chrome. Source-level browser-login mechanics and mock tests do not make that
shipped behavior a peer capability.

The repair candidate removes only the desktop-wide environment pin. Ordinary agent browsing remains explicitly
headless and synthetic-input-only, arbitrary shell commands remain unable to open visible windows or inject input,
and `browser.login` remains the narrow, two-consent attended exception on the persistent station profile.

This row turns GREEN only when the exact installed Windows candidate passes the natural-language journey: ask
StarNet to open LinkedIn for sign-in; approve the attended window; observe a normal visible browser at the requested
LinkedIn URL without launching Chrome or supplying a debug port; sign in; click Done; prove headless agent work
continues on that profile; restart the sidecar/desktop; and prove the authenticated profile is reused. The receipt
must name the candidate SHA/version, installer digest, OS, profile path identity, consent events, headed-to-headless
transition, restart, and observed authenticated result. Until that receipt exists, do not claim browser-login or
LinkedIn account-session parity for 0.10.

**Partial repair receipt (`agent/finish-line-browser` at `9868c9661`, 2026-08-13; remains RED):** the watched
StarNet UI accepted the natural-language LinkedIn request, displayed the two-phase attended consent, and opened a
responsive visible Chromium window titled `LinkedIn Login, Sign in | LinkedIn` at
`https://www.linkedin.com/login/` on the dedicated `.browser-profile`; the user was never asked to launch Chrome
or provide a debugging port. With no Done confirmation, the wait failed closed after 618.2 seconds, closed the
headed browser, retained any cookies, and reported the login as unconfirmed. Therefore authenticated navigation
and restart reuse were not claimed. Source evidence is `test:fast` 621/621, `test:http` 74/74 (including the real
Chromium gauntlet 88 assertions), and `cargo check` green. A local Windows 0.10.1 NSIS bundle was produced with
SHA-256 `3CBD5A39C740AD19ABA56E97BF69D1B6D2DBCB6336D78C9FA62EB5418F35F684`, but it is not an installed release
receipt: release signing correctly stopped because the private updater/signing key was absent, and Authenticode
reported `NotSigned`.

## 0.10 release-confidence gates

| ID | Priority | Confirmed delta at the audit baseline | Observable exit test |
| --- | --- | --- | --- |
| **G0 Operator run recovery** | **MUST** | StarNet's hash-chained run journal identifies resumable checkpoints and uncertain mutations, but trunk exposes only `GET /api/run-recoveries`; there is no operator review/resolution/resume product path. Hermes persists interrupted session state and can auto-continue after crash. A dirty, unmerged `codex/operator-run-recovery` worktree is actively adding conservative operator resolution; it is evidence of work in progress, not a landed capability. | Kill the sidecar once after tool intent and once after tool result. On reboot, the UI distinguishes safe replay from uncertain mutation, requires an explicit outcome for every uncertain call, durably records the decision, and resumes from the last provider-valid checkpoint without re-running a mutation. Repeat after a second reboot and prove no duplicate side effect. |
| **G1 Shipped lifecycle proof** | **MUST (evidence)** | The supervised desktop lifecycle, tray behavior, close-to-background decision, durable halt, and launch-at-login implementation are merged. `docs/NEXT.md` still records the six installed-executable lifecycle scenarios and macOS runtime proof as open. This is an evidence gap, not a request for another lifecycle architecture. | On packaged Windows and macOS builds, exercise idle close, armed close, tray reopen, launch at login, durable E-STOP, reboot while armed, and update/restart. Archive receipts that name build SHA, OS, process state, armed state, and observed delivery. No source/dev-server run can satisfy this gate. |
| **G2 Live doctor and support receipt** | **MUST** | StarNet's diagnostics panel produces a useful sanitized snapshot and individual setup routes can probe some providers. It has no one-shot, opt-in live diagnostic that actively proves the selected model, execution backend, configured MCP server, and connected messaging path. Hermes added `hermes doctor --live` real-call backend probes at `1006faa6f`. | One user action runs bounded, opt-in live probes for the selected model, current execution profile, each enabled MCP transport, and each enabled channel without leaking secrets. The result separates not configured / refused / unreachable / authenticated / round-trip proven and exports a paste-ready receipt with timestamps and latency. |
| **G3 MCP process lifecycle** | **MUST** | StarNet has OAuth refresh, timeouts, bounded reconnect, HTTP health degradation, and Safe Cell stdio ownership. Its stdio transport starts eagerly and has no fingerprinted on-disk schema cache, lazy startup, idle/max-lifetime recycling, boot orphan sweep, or watchdog-based child reaping. Hermes landed schema caching and lazy startup at `135a29452` / `1d5ecad56` and has the richer process lifecycle. | With a fault-injection MCP server, prove warm boot can project unchanged schemas without starting the child; first call starts it; crash triggers bounded reconnect; idle and max lifetime recycle it; sidecar death leaves no orphan after next boot; changed command/env/package invalidates the cache; stale schemas are never called as current. |
| **G4 Complete skill distribution lifecycle** | **MUST for ecosystem-parity claims** | StarNet's inspect-first URL flow safely installs and updates one `SKILL.md`, while local skills can contain support files. It cannot install a complete remote multi-file package, browse/search a registry, preserve update generations, roll back, or export/re-import a standards-compatible package. Hermes exposes Skills Hub list/browse/search/inspect/install and complete packaged skills. | Install a multi-file package from direct GitHub and a registry; bind one digest to `SKILL.md` plus references/scripts/assets/templates; refuse partial fetches; show provenance and quarantine; update only after exact-byte review; roll back offline after upstream disappears; export and re-import without byte or metadata loss. |

### G0 candidate receipt (lane commit `65b90b78`)

G0's observable exit test is closed on `agent/hermes-final-gap-audit`; integration into trunk remains pending.
The implementation appends operator verdict and continuation-ready/start/finish records to the existing hash-chained
journal, requires current ownership-bound snapshots and two explicit consent steps, reconstructs only a provider-valid
checkpoint plus verified results, and blocks canonical-fingerprint mutation replay before consent, leases, new intent,
or registry dispatch. The live in-app fixture showed the verified mutation continue to `done`, kept the deterministic
counter at exactly one, retained the finished source/continued-run linkage, and showed the same linkage after a real
sidecar restart with no retry action. The same panel kept unknown outcomes non-continuable and corrupt repaired prefixes
forensic-only. Automated evidence: focused recovery matrix 190 assertions; complete fast receipt 574/574; recovery HTTP
26/26; remaining HTTP tail 38/38 after the aggregate wrapper exceeded its time budget and one loop-check timing case
passed 33/33 isolated. This receipt closes the lane acceptance test, not the shipped-application claim before merge.

### G1 packaged-lifecycle baseline receipt (published `0.9.0`)

The baseline receipt is
`C:\Users\andro\gen-trees\release-090-final\.dogfood\g1-packaged-lifecycle\20260807T175943\g1-packaged-lifecycle-receipt.json`
(SHA-256 `827D9A5C11290293EA845D58547F834CEF7B6D03260F96AA46AD79D3E3425C57`). Its outcome is
`partial_blocked`: package integrity and public update delivery pass, while interactive Windows lifecycle is
`blocked_not_run` and macOS lifecycle is `unverified_no_mac_host`. The public `0.9.0` installer SHA-256
`2FEE98EFC9D1C01BD9711C7196F82EB3B814572A8A3574EAD63CE7180A963ADE` matches the GitHub asset digest;
Authenticode is valid; the detached updater signature verifies; extraction yields 7,114 files; and the embedded
desktop reports `0.9.0` with a signed bundled Node runtime. Live `latest.json` delivery passes for Windows x64 and
both macOS architectures with reachable version-pinned assets.

Idle close, armed close, tray reopen, launch at login, durable E-STOP, reboot/relaunch while armed, and updater
restart were not exercised. A healthy qualifying 48-hour provider soak owns the installed path, canonical workspace,
and single-instance identity; controlling or rebooting it would invalidate that evidence, and no VM/Sandbox/separate
Windows host was available. No real Mac host was connected. This receipt is baseline evidence for the already-
published package only, not release authority for an eventual `0.10` candidate.

### G2 candidate receipt (lane commits `14e256ba` + `712b0de0`)

G2's lane acceptance test is closed; integration and exact-candidate packaged proof remain pending. The authenticated
`POST /api/diagnostics/live` refuses absent explicit consent, runs independent probes concurrently under a per-probe
deadline, and exports a sanitized timestamped receipt. The selected model must return content to earn
`round-trip-proven`; the execution sentinel travels through the agent's effective local/Docker/SSH router; every
enabled MCP server is freshly initialized/listed; Telegram receives a fresh non-delivery authentication request; and
other channel adapters are classified from live gateway/poll evidence. No doctor probe sends a message, and no
channel earns delivery round-trip without a real successful delivery receipt.

The in-app browser proof exercised the actual SETTINGS → RUNTIME panel. An unchecked RUN LIVE DOCTOR was refused;
after explicit opt-in the rendered receipt showed the selected model and effective local backend as
`round-trip-proven`, left absent MCP/channels `not-configured`, reset consent, exposed COPY RECEIPT, and produced zero
browser warnings/errors. The real-host E2E then made the matrix non-vacuous with an enabled HTTP MCP server and
enabled Telegram adapter: a fresh MCP initialize/list completed, a fresh Telegram `getMe` completed and remained
only `authenticated`, and the fake transport observed zero sends. Focused doctor coverage is 8/8; the touched
boot-level host suite is 471 assertions; generated website parity is green (3,883 mirrored + 2 embed-only). The full
fast gate passed both new fast entries and stopped at the pre-existing candidate-bound claims seal (step 228/576,
10 problems / 54 ok), which this isolated lane intentionally did not rewrite.

### G3 candidate receipt (`agent/mcp-process-lifecycle`)

G3's lane acceptance test is closed; integration into trunk remains pending. Enabled stdio connectors now persist a
size-bounded schema record under a canonical SHA-256 fingerprint of command, arguments/package spec, cwd, environment,
and Safe Cell owner. A matching record projects tools/resources/prompts at boot in an honest `cached` state without
preparing a cell or spawning a child. The first projected call performs a fresh initialize/list handshake before
dispatch; a tool, resource, or prompt removed by that live handshake is refused before the stale operation can run.
Command, environment, package argument, or owner changes invalidate or withdraw the projection.

The manager recycles stdio children after idle and maximum-lifetime limits, retains the verified projection while the
process is stopped, and preserves bounded crash reconnect. Every spawned child is recorded in StarNet's durable PID
ledger and released on clean exit. The Windows probe now falls back from denied CIM access to exact `Get-Process`
creation identity for pinned receipts; an identity-only result can never kill or discard an unpinned receipt. A real
Windows fault test force-terminated the owner of a detached MCP child and proved the next ledger boot killed exactly
that owned child with none remaining. The seeded live app showed `G3 Cached Proof` as
`idle · starts on use · 1 tool` with `cached_probe`, unchanged after a later status poll and without a child launch.

Focused evidence: schema lifecycle 22 assertions, real stdio/ledger 38 assertions, orphan recovery 6 assertions,
process ledger 38 assertions, and existing MCP connector E2E 91 assertions. The exact lane tree passed the complete
fast gate at 586/586 and the complete HTTP gate at 70/70. This closes the isolated lane acceptance test, not the
shipped-app claim before merge.

## Remaining parity lanes

| ID | Priority | Confirmed delta at the audit baseline | Observable exit test |
| --- | --- | --- | --- |
| **G5 Cross-surface session continuity and ingress** | **P1** | StarNet has durable desktop sessions and separate channel histories for Telegram, Discord, Slack, Matrix, and Signal, but no explicit handoff that continues one durable conversation between desktop/CLI and a messaging surface. Its local-only process intentionally excludes webhook-only platforms. Hermes has CLI-to-platform handoff/home routing, a relay/plugin platform model, WhatsApp and other push adapters, and signed outbound lifecycle webhooks. | Continue one conversation desktop → channel → desktop with one transcript identity, ordering, tool state, attachments, and no duplicate final. Then prove an authenticated relay can add a push-only adapter without exposing the local sidecar directly, plus signed/replay-protected outbound lifecycle events. |
| **G6 Delegation control and result contracts** | **CLOSED 2026-08-08; steering reach + context handoff completed 2026-08-17** | The 2026-08-08 closure was one-sided: steering existed but reached only background workers via a lead tool the delegation prompt never mentioned, the Commander's only control was STOP, and a worker's opening message was the bare prompt string. Completed 2026-08-17: `POST /api/subagents/steer` (Commander steers any running background worker; origin-stamped `[from the Commander]` in the durable steerHistory), a STEER control beside STOP in the LIVE HELPERS panel, `team.steer` named in the lead delegation prompt, and a bounded `context` handoff field on team.dispatch/team.spawn that rides first in the worker's opening message, replays through structured-result repair, and survives restart on the durable record. Original 2026-08-08 evidence: `3979605b4` (generation-bound steering in `sidecar/subagents.js` — steer/drainSteer accept a follow-up only for the exact live generation, persisted in steerHistory) surfaced as the `team.steer` tool, and structured result contracts in `sidecar/tools/builtin/orchestration.js` (bounded `resultSchema` validation with one repair attempt; an invalid result is never accepted as done). | Covered: `test/orchestration.test.js` (spawn quality gate, stale-generation refusal, invalid-result reject/repair) and `test/subagents.test.js`. |
| **G7 Autonomous monitor operations** | **P1 when marketing unattended work** | StarNet's routines have durable single-fire claims, time zones, capability checks, delivery finalization, and E-STOP. It lacks Hermes's explicit pre-dispatch `blocked_config` + alert-once state, hash-suppressed monitor mode, and per-job durable notepad (`ed903f953`, `6dff2109a`, `04e8a661f`). | Break a required provider/channel/config before dispatch and prove one actionable alert, no spend, and no alert storm. Poll an unchanged source repeatedly and prove no model call/delivery until the content hash changes. Preserve bounded per-job working state across restart without leaking it into other jobs. |
| **G8 Remote execution fidelity** | **P1 if remote work is advertised; otherwise P2** | StarNet now has local, persistent Docker, and SSH profiles with interactive terminal support and non-deleting sync. It does not claim remote background/PTY process continuity, remote checkpoints/rewind, or delta/conflict-aware sync. Hermes supports more backends (including Singularity, Modal, Daytona, and Vercel Sandbox) and graceful remote-backend failure fallback. | For every advertised remote profile, disconnect during foreground and background work, restart StarNet, reattach or report the exact lost boundary, preserve cwd/process identity, checkpoint and rewind remote mutations, and detect two-sided sync conflicts without deleting either copy. If not closed, market SSH as bounded remote command execution—not equivalent remote workspace continuity. |
| **G9 Recoverable output and mutation receipts** | **P2, P1 for reliability claims** | StarNet automatically continues model answers stopped by an output limit and gives pagination hints for several bounded tools, but oversized shell/code/tool output can still be truncated without a durable full-output artifact. Ordinary `fs.write` / `fs.append` / `fs.edit` / `fs.patch` return success after the write call without byte-for-byte read-back, unlike StarNet's stronger durable control stores. Hermes spills full terminal output for later recovery (`80631c4ae`). | Force every output ceiling and prove the full bytes are saved once, surfaced with exact pre-truncation size, and retrievable without re-running the command. Fault-inject workspace writes and require receipts to distinguish attempted, written, read-back verified, partially applied, and failed; never emit “wrote” when the intended bytes cannot be re-read. |

## Confirmed peer capabilities — do not reopen as generic gaps

- Core multi-turn tool loop, bounded provider retry/fallback, context-overflow recovery, semantic output
  continuation, compaction, and prompt caching.
- Broad built-in tool surface: filesystem/search, shell and interactive terminal, browser, web, media, code mode,
  office/document extraction, MCP resources/prompts/tools, communication, memory, skills, and orchestration.
- Ask/full-access approval postures, durable per-agent Full Access, danger-class grants, routine-scoped grants,
  protected physical-input floors, and E-STOP.
- Durable routines and loops, one-shot claims, restart reconciliation, delivery finalization, host-run checks,
  budgets, and quality review.
- Background named/ephemeral delegation with concurrency limits, durable registry, status/cost, interrupt, stale
  marking, and resume-by-restart.
- Session search, rename, pin, archive, delete, Markdown/JSON export, durable transcript, checkpoint/rewind,
  authorized project roots, and complete-station recovery bundles.
- Persistent per-agent Docker environments, local/SSH routing, project discovery/grants, idle cleanup,
  interactive PTY, and non-deleting sync. Attended browser-login is excluded pending the P0 installed receipt.
- Skills creation/editing/curation, progressive loading, multi-file local packages, exact-byte risk gates, and
  staged single-document community install/update.
- Major provider coverage through native Anthropic/Gemini/OpenAI/Codex and a broad OpenAI-compatible registry.
  Missing provider-native enterprise auth is breadth, not proof that StarNet lacks a provider abstraction.

## Hermes breadth that should constrain claims, not automatically block 0.10

These are real Hermes advantages, but they are optional product-scope choices unless StarNet markets the same
capability. Give each an explicit **build / partner / defer / do-not-claim** decision:

- Serverless/GPU/container backend breadth beyond local, Docker, and SSH.
- Push-channel breadth beyond StarNet's five supported channel families.
- Provider-native enterprise surfaces such as Bedrock/Azure/Vertex rather than custom-compatible endpoints.
- A2A protocol support, mixture-of-agents/reference fanout, and batch trajectory/research workflows.
- Local audio wake word, bulk-corpus `/learn`, on-demand `/refine`, and portable profile import/export.

Deferring one of these is compatible with a full release. Advertising it as present without a shipped proof is
not.

## Recommended sequence

1. Land and live-prove conservative operator recovery (G0), including safe resume after review.
2. Run the packaged Windows/macOS lifecycle matrix (G1) while building the unified live doctor (G2).
3. Harden MCP lifecycle and boot behavior (G3); it is both a reliability and startup-time gate.
4. Complete the already-defined skill ecosystem S2-S4 contract (G4).
5. Close G5-G7 as the cross-surface/autonomy release slice.
6. Either close G8-G9 or narrow the corresponding 0.10 marketing claims.

The final go/no-go review should use this matrix as a receipt index: every green row links to a packaged live
run or fault-injection artifact at the exact release candidate SHA. Unit tests alone cannot turn a row green.
