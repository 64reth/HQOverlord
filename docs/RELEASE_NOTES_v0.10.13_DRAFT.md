# StarNet v0.10.13

This is the full release list for the 214 commits shipped since v0.10.12. It is a large feature-and-reliability update, not a narrowly scoped hotfix.

## LINES: a complete automation library

- The LINES shelf expanded from 4 starter layouts to **19 compiled, one-click systems**.
- The library is grouped into **Chains, Sorters, Crews, Quality Gates, and Flagships**, with short explanations that make the progression easier to understand.
- Every Line uses the same floor compiler and routing mechanics as a Line built manually. Stamps are validated as a whole and remain one-step undoable.
- **FRONT DESK** provides the complete INBOX → agent → OUTBOX round trip in one row.
- **ALLOWANCE DESK** adds a hard per-day and per-message spending ceiling directly to the intake.
- **TWO DOORS** lets two independently named and budgeted intake lines share one crew member and one shipping door.
- **RESEARCH LINE** hands work from a researcher to a writer before shipping it.
- **SHIP-OUT LOOP** is the smallest useful Line: one crew member connected directly to an OUTBOX.
- **ASSEMBLY LINE** runs a four-stage research → analysis → writing → shipping handoff.
- **SORTING OFFICE** routes code work to an engineer and everything else to a generalist.
- **TRIAGE DESK** sorts code, research, and general work into three specialist lanes and merges the results into one OUTBOX.
- **PARALLEL CREW** distributes incoming jobs across three crew members.
- **SECOND OPINION** sends the same job to two crew members and joins both independent answers.
- **RESEARCH SWARM** fans one job out to three researchers, waits for every branch, and gives their combined work to an analyst.
- **LOAD BALANCER** alternates jobs between two desks instead of duplicating the work, then funnels both result paths into one OUTBOX.
- **REVISION LOOP** sends a draft through a reviewer and back to the writer until it is approved, with a three-pass ceiling.
- **CODE FOUNDRY** sorts code into an engineer/reviewer revision loop while general work takes a separate lane.
- **FIRE ESCAPE** adds a third escalation exit: approved work ships, rejected work loops, and work that exhausts its passes goes to a fixer instead of ending as a bare failure.
- **THE GAUNTLET** combines fan-out, join, analysis, review, and a verdict-gated revision loop.
- **THE CRUCIBLE** uses two separate approval gates: one for the draft and another for the polished result.
- **MISSION CONTROL** gives code, research, and general work distinct multi-stage routes before merging everything into one shipping door.
- **THE DEEP DIVE** runs a three-researcher swarm through analysis, writing, review, and revision before shipping.
- Cascaded fan-out now launches every promised branch instead of stopping after the first layer.
- Loop back lanes render and simulate from the compiled route, including their re-entry tile, so a working Line no longer looks frozen or broken.
- Loop gates gained the real third escalation lane used by FIRE ESCAPE.
- The conveyor simulator now follows the compiled done/back/escalation lanes instead of reconstructing a different route.
- Blueprint roles now include Reviewer, Analyst, and Fixer, so one-click crew suggestions match the actual stage being staffed.
- Footprint checks, routing validation, powered-belt checks, and no-room warnings were expanded across the entire 19-Line catalog.

## Found work and smarter recommendations

- The new **FOUND ON YOUR PROJECTS** shelf can surface useful work already present in projects you explicitly blessed.
- Discovery is deterministic and local: it scans only approved roots and uses exact project text as the citation behind each finding.
- Every discovery card shows why it exists and lets you hand the cited task to a crew member without automatically starting work.
- Dismissals are arm-confirmed, durable, and denylisted so the same finding does not immediately return.
- Discovery respects pause state, cooldowns, trust boundaries, and finding expiry.
- Discovery decisions are recorded in the recommendation ledger instead of becoming invisible background behavior.
- Night Shift can cite the same project findings as evidence, but discovery never changes Night Shift scoring or grants itself access to another project.
- Completed runs now fold into a support-gated station track record.
- Recommendations, quests, and Night Shift can use literal success counts from that track record without overstating sparse history.
- Ranking uses a conservative prior until enough evidence exists, rather than treating one lucky result as certainty.
- `/api/insights` exposes the same evidence counts used by the recommendation system.
- Track-record evidence yields to more immediate activity when the recommendation evidence budget is full.
- Discovery refreshes when its bay opens, persisted sweep results survive restart, expired ledger rows fall away, and repeated track-record reads are memoized.
- Previously dead recommendation seams now record declines, outcomes, seed/routine answers, and expiring impressions correctly.

## Connector and KEYS expansion

- Added **18 live-probed OAuth connectors**: Todoist, ClickUp, Railway, Grafana, PostHog, Cloudflare Bindings, Cal.com, Fireflies, Algolia, Buildkite, Datadog, Globalping, Honeybadger, Jam, Sanity, Semgrep, Close CRM, and Ramp.
- Added a keyless **OpenAI DevDocs** connector.
- Added **23 specialized KEYS directory entries**: Supliful, Fourthwall, ShineOn, SPOD, Teemill, Zazzle, Gumroad, Lemon Squeezy, CJ Dropshipping, Keepa, Discogs, Lob, Lulu, Duffel, Porkbun, ElevenLabs, HeyGen, Bannerbear, Shotstack, Bland, Vapi, DeepL, and Transistor.
- The new catalog entries were live-probed before inclusion instead of being added as unverified placeholders.

## Billing, providers, and tool execution

- Bring-your-own-key runs on a linked station no longer require StarNet credits and are never charged against the StarNet wallet.
- Managed runs that cross a reservation now settle the real spend at that reservation instead of being refused after the work already happened.
- Billing leak-guard replays settle against the remembered real spend on every exit path.
- Gemini 3 thought signatures are preserved when function calls are replayed.
- Gemini usage is emitted before completion, matching the ordering used by other providers.
- Index-less parallel OpenAI-compatible tool calls keep distinct identities instead of collapsing into one slot.
- Name-echoing continuation deltas remain part of one tool call instead of creating duplicates.
- Durable tool results resume correctly after an interruption.
- Orphaned pristine transcript segments are no longer created during recovery.
- Short verification reads run to completion instead of being mistaken for truncated output.
- Tight output budgets retain the do-not-repeat instruction and no longer grow while trying to explain their own truncation.
- Ollama receives a realistic cold-start window for local models that take longer than 30 seconds to load.
- An MCP server's own tools named `resources` or `prompts` are no longer shadowed by StarNet's auxiliary browsing definitions.
- A clean but unexpected exit from an MCP stdio server is treated as a transport failure rather than a healthy idle state.
- LSP startup can retry after a spawn failure.
- Skill-exchange handlers return a real 400 for malformed JSON instead of leaving the socket hanging.
- Tool registry capability and schema refusals remain contained as tool errors rather than escaping the dispatcher.
- Protected mutations wait for their idempotency record before a loop advances.

## Routines, schedules, and loops

- Completed one-shot routines now show truthful finished controls instead of a dead ENABLE action.
- One-shot routines can be explicitly re-armed.
- RUN NOW takes a real lease, settles its execution record, and cannot double-launch from repeated clicks.
- Pausing or deleting a routine aborts its active run and releases the associated state cleanly.
- A failure between loop context creation and process launch now settles the iteration instead of orphaning it.
- A Line advances only after its entry run is actually completed.
- One routine throwing during a scheduler tick no longer prevents the remaining routines from firing.
- Reclaimed zombie jobs record an outcome and release their concurrency slot.
- Retry anchors are cleared whenever a schedule is deliberately re-anchored.
- Transient retry backoff no longer permanently shifts an interval schedule.
- Backward system-clock changes no longer wedge an in-flight lease.
- DST spring-forward gaps that cross local midnight are detected correctly.
- Malformed and NaN schedule values are rejected or normalized instead of poisoning the scheduler.
- Impossible day/month combinations return immediately, and sparse-date searches skip by day instead of blocking the event loop minute by minute.
- Empty-prompt routine creation is refused.
- Routine creation, loop creation, and paid automation buttons have in-flight guards against double submission.
- Running badges, pause/resume state, RUN NOW state, and creation refusals now reflect the scheduler's proven state.
- Schedule guard sanitization strips GitHub-auth constructs before guarded work is launched.

## Saves, recovery, and durable state

- Durable saves now loop until every byte is written; a partial `writeSync` can no longer replace a good save with a valid-looking JSON prefix.
- An absent main store with an empty or corrupt orphan `.bak` is quarantined and healed instead of permanently returning `ESTORE_CORRUPT`.
- Recovery quarantines the actual damaged generation and can initialize the key again in the same operation.
- A dead pre-boot recovery lock is recognized as dead instead of permanently bricking launch with exit 73.
- START FRESH drains every state-file page instead of stopping after the first 40 entries.
- Recovery bundles captured over a torn save promote the last-known-good `.bak`.
- Checkpoint reads do not rebuild from Git after a transient index failure.
- Checkpoint size-ceiling reinitialization builds the replacement repository before removing the old history.
- Incomplete checkpoint restores now fail instead of being reported as successful.
- Durable JSONL append operations write every byte.
- Rejected output appends roll back instead of leaving a partial record.
- Cloud save drains overlapping writes before an update and waits for active writes to finish.
- Failed update preparation can thaw and retry rather than leaving the station stuck in preparation mode.
- Imported permission grants are verified as persisted.
- Credential removal is transactional and cannot resurrect a key after a crash.
- Codex logout, OAuth logout, and FORGET remain signed in when the required deletion cannot be proven, rather than claiming success while credentials remain on disk.
- Rotated Spotify token writes retry rather than silently losing the new token.
- Failed skill KEEP/EDIT writes retain the proposal for retry and no longer turn the route into a generic 500.
- Roster replacements, model changes, and agent deletions roll back or abort when their durable write is rejected.
- Workspace owner claims and their read-back markers are removed when persistence fails.
- Rejected SSH working-directory changes roll back.
- Attachment uploads are verified after persistence; rejected files are cleaned without deleting a pre-existing collision target, and cleanup failures are surfaced.
- Process receipts remain live across transient errors and failed cleanup receipts retry.
- Orphan cleanup retries when the first attempt fails.

## Messaging, browsers, and process cleanup

- Failed merged channel batches now propagate failure to every affected bubble's durable inbox receipt.
- Partial outbox deliveries persist exact progress across restart.
- Outbox retries rebuild the remainder from the original raw splits, so already-delivered chunks are not counted as failures or sent twice.
- Outbox identifiers remain unique across restarts.
- Discord reconnects wait instead of entering a zero-delay storm; persistent close code 9 escalates into exponential backoff.
- Windows process cleanup inspects the live child tree before the leader exits.
- Windows `taskkill` waits are bounded so an execution promise cannot hang forever.
- POSIX background cleanup targets the process group rather than leaving descendants alive.
- Process-ledger pressure evicts only provably dead receipts, with bounded and rate-limited PID probes.
- stdout and stderr now use separate streaming UTF-8 decoders so a character split across chunks is not corrupted.
- Browser profile teardown is awaited before the profile is reused.
- If a headed login browser cannot close and restore cleanly, browser work for that run is quarantined instead of falling through to an unshimmed visible browser.
- Failed browser activation rolls back to the last proven mode.

## Interface and onboarding polish

- Starting a new Commander clears the saved tutorial completion marker and re-arms the tour, coachmarks, and FIRST STEPS guidance.
- The unreachable-station screen distinguishes a stale-window save refusal (`SAVE-403`) from a lost save request (`SAVE-NET`).
- Recovery diagnosis is copyable from the unreachable screen, making a screenshot useful for support.
- The connect screen includes an in-app route to use a different StarNet account.
- Stage dragging releases on window mouse-up, blur, and pointer cancellation instead of remaining stuck to the cursor.
- A stale snapshot can no longer relight a run that already ended.
- COMMS composer listeners no longer stack when repeatedly entering the same session.
- Double-emitted tool results are deduplicated before XP/state handling.
- Spotify-connect and account-credit polling stop when their panels close.
- Background refreshes preserve current drafts and form values.
- Minimized windows are not measured and rewritten from zero-sized geometry.
- DISCARD confirmation is wired once, preventing a single confirmation from causing two irreversible deletes.
- Routing samples are labeled as proof traffic rather than customer work.
- Run-end UI vetoes expire when read instead of suppressing updates permanently.
- File-edit stale-write baselines re-arm after edit, append, and patch operations.

## Release validation

- The final tree contains **214 commits** beyond v0.10.12.
- The exact release tree passed **691/691 fast-test steps**, **87/87 HTTP groups**, **130/130 journeys**, the claims lock, Beginner Run, and Green Guardian.
- The Windows installer passed signing, Authenticode verification, clean-install T0, legacy broken-uninstaller upgrade proof, packaged lifecycle G1, and a public 0.10.12 → 0.10.13 updater/relaunch canary.
- Apple Silicon and Intel macOS artifacts were signed, notarized, and accepted by Gatekeeper; the Intel package also completed installed launch/recovery acceptance.
- The hosted updater manifest and every Windows, Apple Silicon, and Intel asset were verified after publication.

Already running StarNet? Update from inside the app. Your crew, sessions, keys, and station remain in place.
