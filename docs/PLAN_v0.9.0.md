# PLAN - v0.9.0: THE RELIABILITY PROOF RELEASE

Written 2026-08-02 against `feat/harness-backend` at `606027f6`, after v0.8.5
published. This replaces the 2026-07-31 LEGIBLE / SOLID / UNBLOCKED plan. Most of
that plan's browser, routine, connector, release, and defect work landed before
or during v0.8.5; its surviving beginner-legibility work is retained here.

This document is a queue, not authority. Trunk, the QA ledgers, live app behavior,
and exact-candidate receipts win whenever they disagree with it.

## Mandate

Andrew's release direction:

1. v0.9.0 is the release where StarNet earns confidence as a harness in the same
   class as a mature reference such as Hermes Agent.
2. Field experience says the model output is not the weak link. Extensive dogfood
   has produced exceptional outputs, and roughly 95% of reported problems have
   concerned harness behavior rather than answer quality.
3. Therefore this is not another feature-count sprint or a subjective prose
   contest. Hold model quality steady and attack the machinery around it: work
   starting, continuing, landing, surviving interruption, reaching the intended
   destination, and being reported truthfully.
4. v0.9.0 is the proof release. Once its candidate survives the frozen campaign,
   v1.0.0 should be a promotion of that proven contract, not another feature wave.

## Current position - verified 2026-08-02

### What is already strong

- The static station surface grants 94 tools across compute, memory, files, web,
  terminal, orchestration, media, and Spotify, plus dynamic MCP tools.
- The provider catalog has 17 profiles. Channel adapters exist for Telegram,
  Discord, Slack, Matrix, and Signal.
- The real harness has semantic continuation, a durable run journal, segmented
  transcript history, output parking, code composition, LSP edit diagnostics,
  background subagents with inspect/interrupt/resume, durable channel redelivery,
  verification-before-done, checkpoints, untrusted-content fencing and taint,
  routines, Night Shift, E-STOP, ACP, and an OpenAI-compatible surface.
- The deterministic agent evaluation pack passes 8/8 on current trunk.
- The fresh Guardian on `606027f6` is GREEN. The registered defect authority has
  0 open P0, 0 open P1, and 7 open P2 bugs.
- v0.8.5 received installed-desktop proof at its exact source tag `865d87fb`.
  Current trunk correctly fails `qa:ready` only because later release-workflow
  commits invalidate the candidate-bound Beginner and installed receipts.

### What is not yet proven

- The eight active agent evaluations are deterministic StarNet scenarios. They
  prove mechanisms, not comparative real-task outcomes.
- No one frozen candidate has survived the entire fault, concurrency, integration,
  beginner, performance, installed-build, and soak campaign.
- `qa:product-perfect --status` still stops at W0. Several advertised claims are
  partial, experimental, excluded, or awaiting exact-candidate live proof.
- Performance is not release-gated: time to first token, time to useful artifact,
  long-transcript responsiveness, memory growth, and recovery time lack a shared
  candidate-bound scorecard.
- Beginner explanation remains incomplete: the tour is one-shot, only 29
  `data-hint` uses exist, and the glossary contains several missing or conflicting
  everyday nouns.
- Public release truth is split: the source repository's latest Release is older
  than the updater repository, and the published v0.8.5 notes still call the build
  a candidate being staged before publication.
- The raw finding ledger contains 350 open P2 findings. Many will be duplicates,
  stale, non-product, or low-confidence Janitor output, but that classification has
  not been completed on a frozen candidate.

## What "equivalent harness" means

Parity is an outcome contract, not identical topology.

StarNet does NOT need every reference-harness channel, hosted deployment mode,
password-manager integration, HPC backend, or CLI flag. Those are product breadth.
They become release requirements only when StarNet advertises them or when a
shared workload cannot succeed without them.

StarNet DOES need mature behavior in these critical categories:

1. Agent loop and context continuity.
2. Tool correctness, artifact integrity, and verification.
3. Cancellation, E-STOP, timeout, and spend enforcement.
4. Crash/restart recovery without lost work or replayed mutations.
5. Parallel and background delegation with durable, correctly routed results.
6. Routine and channel delivery with exact-once outcome accounting.
7. Provider, OAuth, connector, and credential lifecycle reliability.
8. Historical recall, compaction, and long-session stability.
9. Prompt-injection containment and truthful capability authority.
10. An installed first-user journey that reaches useful work without stranding.
11. Performance and cost that stay usable under real load.
12. UI telemetry that never outruns backend proof.

## Non-goals for v0.9.0

- No feature-for-feature clone of Hermes Agent.
- No new channel or execution backend solely to improve a comparison table.
- No subjective model-answer bake-off as the main release gate.
- No claim of literal mathematical certainty. "100% confidence" means every
  defined critical contract passed on one immutable installed candidate, all
  observed failures were explained, and the residual exclusions are explicit.
- No v1.0.0 feature pile after the v0.9 proof candidate freezes.

---

# Track 0 - Freeze the contract and evidence format

This blocks the rest. Without it, each lane proves a slightly different product.

## 0.1 Freeze the comparison target

- Reference: Hermes Agent tag `v2026.7.30` (v0.19.1), never moving `main`.
- Record the exact reference commit and installed/runtime version in every report.
- Use the reference as a failure-class and shared-workload oracle, not as design
  authority over StarNet's product decisions.

## 0.2 Freeze the StarNet scope

Create one machine-readable v0.9 contract derived from the existing product-perfect
claims ledger. Every material promise must be one of:

- `required` - blocks the release;
- `experimental` - visibly labelled at its point of use and tested to fail safely;
- `excluded` - not advertised and absent from the release comparison;
- `differentiator` - StarNet-specific behavior tested on its own terms.

No vague `partial` claim may survive the candidate freeze.

## 0.3 One receipt schema

Every behavioral receipt records:

- StarNet commit, version, source-tree hash, executable hash, platform;
- scenario id, seed, model/provider, run id, start/end timestamps;
- requested outcome and machine-checkable grader result;
- tool calls, turns, retries, tokens, reconciled cost, first-token time, wall time;
- artifact hashes and post-mutation verification hashes;
- interruption/fault injected and exact recovery outcome;
- transcript/session/delivery destination;
- console, sidecar, and provider errors;
- redacted evidence paths.

Extend `scripts/eval` rather than inventing a second evaluation format.

## 0.4 Repair public release truth now

- Make the public v0.8.5 notes describe a published release, not a staged candidate.
- Decide and document why source releases and updater releases are separate, then
  ensure every download path points at the current version.
- Rewrite the stale v1.0 draft before it can be reused: it still describes unsigned
  Windows binaries, unproved platforms, and an older feature contract.

Done means: a machine can name exactly what v0.9 promises, what it excludes, and
which immutable artifact each receipt proves.

---

# Track 1 - The harness reliability gauntlet

The gauntlet is primarily deterministic fault injection. It should be cheap enough
to run repeatedly before provider-backed confirmation.

## 1.1 Run-boundary crash matrix

Kill and restart the sidecar at each boundary:

1. accepted request, before provider dispatch;
2. during provider streaming;
3. tool intent journaled, before a read tool dispatch;
4. tool intent journaled, before a mutating tool dispatch;
5. mutation completed, before result checkpoint;
6. tool result checkpointed, before the next model turn;
7. final text generated, before transcript acknowledgement;
8. transcript durable, before UI/channel delivery acknowledgement;
9. compaction or history-segment rotation in progress;
10. routine/subagent finalization in progress.

Critical invariants:

- a mutation is never automatically dispatched twice;
- completed text and artifacts are never silently lost;
- uncertain mutation state becomes an explicit review state;
- a safe read-only boundary may resume automatically;
- every recovered run remains attached to its original agent, session, trigger,
  routine/subagent identity, and cost ledger.

## 1.2 Transport and credential matrix

Exercise every supported live family through connect, success, failure, restart,
revoke, and secret removal:

- provider: 401/403, 402/quota, 408/timeout, 429, 5xx, malformed stream, truncated
  stream, connection drop, rotation and fallback;
- connector: OAuth callback cancellation, expired access token, refresh rotation,
  refresh refusal, MCP timeout, schema drift, removal while down;
- channel: disconnected socket, partial multi-chunk send, rate limit, block/kick,
  restart with outbox pending, redelivery exhaustion;
- browser/web: challenge page, navigation timeout, popup, download, attached-profile
  refusal, reader fallback, host cooldown cancellation;
- desktop UI: SSE disconnect/reconnect, stale token, suspended tab, sidecar restart.

No empty state may be rendered from a failed read. No old credential may be deleted
until its replacement is durably read back.

## 1.3 Concurrency matrix

Run representative collisions rather than isolated happy paths:

- two sessions on one agent;
- foreground run plus channel run;
- foreground run plus routine fire;
- background named workers plus ephemeral fan-out;
- routine plus Night Shift;
- connector refresh while another run uses the connector;
- E-STOP and per-run cancel during each combination;
- app close/reopen while work is in flight.

Grade result routing, capability authority, cancellation reach, spend accounting,
and artifact ownership. A result in the wrong session is a failed scenario even if
the underlying model work succeeded.

## 1.4 Persistence and migration matrix

- forward-version refusal;
- corrupt primary plus valid backup;
- corrupt primary and backup;
- locked legacy file during migration;
- disk-full/short-write simulation;
- full-agent export and restore;
- project grant, revoke, forget, and restart;
- update over a populated real station;
- 10,000+ transcript rows with repeated restart/search/compaction.

## 1.5 Repeat bar

- Every deterministic critical scenario: 100 consecutive passes.
- Every platform-sensitive scenario: 25 passes on Windows and 25 on macOS.
- Every real-provider/integration scenario: at least 5 success/failure/restart
  cycles per supported family on the candidate.
- Any unexplained flake resets that scenario's count after the fix.

Done means: all critical matrices are green, no ambiguous outcome remains, and the
gauntlet emits one candidate-bound report consumed by the release gate.

---

# Track 2 - Shared StarNet/reference workload comparison

This is deliberately smaller than the fault gauntlet because output quality is not
the observed problem. It answers whether the harness can successfully carry the
same work with the same model.

## 2.1 Fair-run controls

- Same model build and provider account where both harnesses support it.
- Same clean fixture workspace and network authorization.
- Equivalent tool families and permissions; unsupported extras stay disabled.
- Same task text and completion grader.
- Three fresh runs per ordinary scenario; more only when variance is material.
- Judge artifacts and observable results, never writing style.

## 2.2 Workload pack - 32 scenarios

- 6 coding/file tasks: inspect, edit, patch, run checks, produce verified artifact.
- 4 research/browser tasks: multi-source answer, page interaction, download/PDF,
  honest challenge escalation.
- 4 document/data tasks: parse and transform common files, preserve exact output.
- 4 memory/history tasks: old-decision recall, long transcript, compaction, restart.
- 6 orchestration tasks: named delegation, parallel fan-out, background continuation,
  interruption, resume, synthesis and destination routing.
- 4 routine/channel tasks: create/manage/run, delivery, partial failure, redelivery.
- 4 recovery/security tasks shared where injection seams permit: timeout, provider
  drop, prompt-injection content, and post-tool interruption.

## 2.3 Comparison gate

- 100% pass on critical safety, mutation, recovery, and delivery scenarios.
- At least 95% overall StarNet pass rate.
- StarNet within 5 percentage points of the frozen reference on shared scenarios.
- Zero StarNet-only false-done, wrong-destination, duplicate-mutation, or authority
  escape events.
- Every loss is explained and either fixed or turned into an explicit release
  exclusion. Statistical variance is rerun, not hand-waved.

The comparison is a release input, not marketing copy. Public parity language is
allowed only after the installed StarNet candidate reproduces the result.

---

# Track 3 - Performance and cost truth

Hermes has made performance a product feature. StarNet needs its own measured bar.

## 3.1 Measurements

- cold boot to interactive station;
- send to first visible token;
- send to first tool activity;
- send to verified useful artifact;
- final provider token to durable transcript and visible delivery;
- session-switch time at 100, 1,000, and 10,000 turns;
- streaming render responsiveness for a large answer and large diff;
- idle and active memory/CPU over 48 hours;
- restart recovery time with large history;
- tokens, cache reads/writes, reconciled USD, and auxiliary-model spend.

## 3.2 Initial release thresholds

Set the exact numbers from a v0.8.5 baseline before optimizing. Until then:

- no v0.9 regression greater than 10% on StarNet's median baseline without an
  explicit quality/reliability tradeoff;
- no shared-workload wall-time or cost more than 25% worse than the reference
  without an explained product difference;
- no visible streaming stall longer than five seconds without truthful activity;
- memory must remain bounded during the 48-hour soak.

Optimize only measured bottlenecks. Do not sacrifice recovery or truthful telemetry
to win a latency number.

---

# Track 4 - Beginner legibility and recovery

This is the surviving high-value portion of the earlier v0.9 plan.

## 4.1 Replayable onboarding

- `Tutorial.firstCommand` can restart from the Field Manual after completion.
- A refresh/crash mid-tour offers Resume or Start Over.
- FIRST STEPS and coachmarks are re-openable and resettable.
- The first useful result remains reachable when the user skips the ceremony.

## 4.2 Deploy the glossary

- Every first use of a station noun on a beginner-reachable surface has a working
  explanation.
- Add the missing everyday terms: agent, session, project, specialist, provider,
  key, effort, voice, focus, deliverable, intake, and outbox.
- Choose one user-facing word for the same object. Do not expose session/workstream
  or capability/toolset collisions without explaining the distinction.
- Searchable Field Manual, keyboard sheet, and relevant docs links.

## 4.3 Failure recovery language

Every visible failure must state:

- what failed;
- what StarNet did and did not preserve;
- one concrete recovery action;
- whether retry is safe;
- where diagnostics/support live.

## 4.4 Beginner gate

On the exact installed candidate, five people unfamiliar with the current build
must independently:

- understand what StarNet is before supplying credentials;
- connect a provider;
- create or enter a station;
- complete one real task and open its result in under ten minutes;
- recover from one planted failure;
- find help or diagnostics without being told where it is.

Every hesitation, wrong expectation, and misleading label becomes a finding, not
just a stalled-step count.

---

# Track 5 - Defect and claim closure

## 5.1 Registered bugs

Close or evidence-dismiss the seven current P2 bugs. Re-run the register on the
frozen candidate; zero P0/P1 is necessary but not sufficient for 1.0 promotion.

## 5.2 Raw ledger

Triage the 350 open P2 findings into:

- reproduced product defect;
- duplicate of a registered bug;
- stale against current source;
- test/detector defect;
- non-product maintenance finding;
- accepted, visible release limitation.

Only reproduced release-surface defects block v0.9, but no unclassified P2 may
remain at candidate freeze.

## 5.3 Product-perfect waves

Use the existing W0-W7 machinery as the release spine rather than creating another
readiness program:

- W0-W5 are implementation/reconciliation waves.
- W6 is the full integration proof on one candidate.
- W7 is the frozen soak and external validation.

Adjust a claim only when the advertised product contract changes. Never weaken a
gate merely because the current candidate cannot pass it.

---

# Track 6 - Immutable candidate, soak, and 1.0 promotion

## 6.1 Candidate freeze

After Tracks 0-5 are green:

1. Freeze one clean commit.
2. Bump version before gating.
3. Build signed Windows and signed/notarized macOS installers.
4. Record installer, executable, embedded frontend, sidecar, updater, and source
   hashes.
5. Install those exact bytes on clean machines.
6. Run all release gates without rebuilding.

Any code change creates a new candidate and invalidates candidate-bound receipts.

## 6.2 Forty-eight-hour v0.9 soak

The same artifact must survive:

- representative real-provider interactive work;
- background delegation;
- channel traffic and redelivery;
- connector refresh and restart;
- routine and Night Shift activity;
- cancellation and E-STOP;
- app/sidecar restart;
- large transcript growth;
- update check and clean relaunch;
- zero unexplained process death, data loss, duplicate mutation, false telemetry,
  or P0/P1 event.

## 6.3 v1.0.0 promotion

Promote the proven v0.9 contract only after:

- W7 passes on the immutable artifact;
- five attended beginner sessions pass;
- ten clean-machine installs pass across supported platforms;
- a minimum seven-day field window produces no unresolved P0/P1 or truth escape;
- every support report is classified and no recurring harness failure is open;
- release notes, website, updater feed, source repository, and support path all name
  the same current version and supported platforms.

The promotion may contain version/notes/release metadata only. A feature or behavior
change returns the candidate to the relevant proof wave.

---

# Execution order and lane map

## Wave A - start immediately

1. Contract/claims freeze and release-surface truth repair.
2. Eval receipt schema and fault-runner foundation.
3. v0.8.5 performance baseline.
4. Registered P2 bug closure.
5. Replayable onboarding and glossary deployment.

These lanes can proceed independently. None should edit shared events/schema without
the owner lane; new evaluation events should remain evaluation-local where possible.

## Wave B - reliability attacks

1. Crash-boundary matrix.
2. Transport/credential matrix.
3. Concurrency/routing matrix.
4. Persistence/migration matrix.
5. Platform installed-build scenarios.

Each lane first reproduces a red scenario, then fixes the smallest responsible seam,
then proves the live installed behavior where applicable.

## Wave C - comparative proof and measured fixes

1. Run the frozen 32-scenario shared pack.
2. Classify every difference.
3. Fix task-success, reliability, safety, and material efficiency gaps.
4. Do not build breadth-only parity features.
5. Re-run the complete pack after the last fix.

## Wave D - candidate campaign

1. W0-W6 terminal on one source candidate.
2. Signed/notarized installed builds.
3. Five beginner sessions and integration lifecycle proofs.
4. Forty-eight-hour soak.
5. Publish v0.9.0 only after the exact artifact remains green.

## Wave E - v1.0 promotion

No new feature wave. Seven-day field window, ten clean installs, final support and
release-surface reconciliation, then promote.

---

# v0.9.0 shipping bar

v0.9.0 ships only when all are true:

1. The finite release contract contains no vague partial claims.
2. All critical deterministic fault scenarios pass 100 consecutive times.
3. Shared workload success is at least 95%, within five points of the frozen
   reference, with 100% critical recovery/security/delivery success.
4. The exact candidate has zero open P0/P1 and zero unclassified P2 findings.
5. Performance and cost have candidate-bound baselines with no unexplained material
   regression.
6. Five beginner journeys reach and open useful work in under ten minutes and
   recover from a planted failure.
7. Every advertised integration is proven through connect/success/failure/restart/
   revoke/secret-removal or visibly experimental at its point of use.
8. Windows and macOS installed candidates are exact-source proven; macOS is signed,
   notarized and stapled, and Windows signatures verify.
9. The immutable artifact survives the 48-hour soak.
10. `qa:ready` is READY and product-perfect is terminal through the required release
    wave on that exact candidate.

## The stop rule

Once these gates are green, stop adding things. A harness earns 1.0 by remaining
correct under use, not by moving the finish line with another feature.
