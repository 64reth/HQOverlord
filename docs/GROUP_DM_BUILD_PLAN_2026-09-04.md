# Group DM sessions — build plan

Date: 2026-09-04. Status: planned, not implemented or live verified.
Planning workspace: `agent/group-dm-plan-0904`, based on trunk `dd4e33bee`.
Recheck current code before implementation; trunk moves continuously.

## Product intent

Create a session, add the agents you want, and talk and work with them in one shared
conversation. Example: Overseer, Researcher, and Engineer collaborating on whatever
the user asks. The group is user-selected and the workflow is user-directed.

This replaces the product framing and build sequence of the earlier
`HANDOFF_ROOMS_2026-09-04.md` proposal. That document was read in the integration tree
and was untracked at planning time. Keep its useful source pointers as hypotheses.
Use “group chat” or “group session” in the interface. Physical rooms, a Briefing Table,
templates, and station placement are not prerequisites for using group chat.

The user has confirmed the group DM concept and requested this plan. Defaults below
are implementation recommendations, not newly locked entries in DECISIONS.md.

## Experience and scope

The initial complete release includes:

- New session → choose participants from the existing roster → start talking.
- Add agents to an existing session without losing its history.
- One transcript, one composer, attributed agent messages, and participant controls.
- Mention autocomplete and direct replies; address one or several selected agents.
- An ordinary unaddressed message goes to the selected lead. Prefer the overseer if
  selected; otherwise use the first selected agent. Let the user change the lead.
- Participants receive relevant session context when they run. Silent participants
  incur no model calls merely by being members.
- Explicit agent-to-agent handoffs, including review-and-revision cycles.
- Shared attachments and versioned deliverables that participants can actually inspect.
- Session instructions, reliable stop/pause, corrections, and restart recovery.

Keep the UI compact: participants and lead at the top; transcript in the center;
composer below; collapsible files and pinned instructions. Session history remains
in the existing session rail. Do not require a workflow builder or a task brief form.
An objective and workflow can emerge naturally from conversation.

## Interaction contract

| User action | Result |
| --- | --- |
| Send with no explicit recipient | Lead responds; other members do not automatically run. |
| Mention one or several members | Those members are queued once each, in mention order. |
| Reply to an agent bubble | That agent is the recipient unless the user explicitly selects mentions instead; show recipients before send. |
| Ask everyone | Each selected member gets one turn; any requested lead summary is an additional visible turn. |
| Add a member | Show that the member will receive this session's relevant history, pins, and shared files; membership does not start a run. |
| Remove a member | Preserve attributed history; cancel their pending turns, stop their active session run, and retain access only where separately granted. |
| Remove the lead | Require a replacement in the same member-edit interaction when other members remain. |
| Stop an agent | Abort that session run and its descendant work; keep other independent queued work. |
| Pause group | Freeze dispatch and request cancellation of active group work; show stopping until acknowledged. Resume is explicit. |
| Send while work is running | Persist the message immediately; visibly queue it. Offer an explicit “Interrupt and send” action. |
| Interrupt and send | Cancel superseded work, invalidate obsolete queued turns, and dispatch against the new context after cancellation is acknowledged. |

Resolve mentions to stable roster IDs, not display names. Handle duplicate names,
renames, deleted agents, unavailable providers, and literal mentions in code/quotes.
Unknown recipients get an inline correction, never a guessed dispatch or automatic summon.
Agent prose containing an @name is text, not execution authority.

Do not show “read by” or “observing” as if silent agents have processed messages.
“Context included through message X” is supportable when a real turn is assembled.
Use queued, connecting, running, waiting for approval, stopping, stopped, failed, and
completed only from actual backend state. A completed run is not proof its task succeeded.

## Architecture and source grounding

Reuse the single sidecar and `runOnce`; do not introduce another agent execution loop.
Create a small backend coordinator that schedules ordinary runs and owns group state.
The frontend sends intent and renders state; it does not own the hop loop.

Observed source seams during review:

- `frontend/app/workstreams.js`: one `agentId`, existing `roomId`, and `kind` restricted
  to chat/task. Preserve those meanings. Add a separate participation field such as
  `conversationMode: 'direct' | 'group'`; do not use `kind: 'room'`.
- `frontend/app/chat.js`: speaker rendering and work-line orchestration are useful
  integration points, but verify event attribution and stream selection end to end.
- `sidecar/transcriptstore.js`: durable stream-scoped entries with agent attribution.
  Extend additively where stable message/reply identifiers are needed; do not assume
  its existing shape already supports context cursors or idempotent message ingestion.
- `sidecar/routing/chain.js`: existing limit and accounting patterns; reuse principles,
  not its visited-agent restriction for conversations that must permit revisions.
- `sidecar/index.js`: browser-commanded runs currently pass `lead: true`. Separate
  user-originated requests from peer-originated handoffs before using this seam.
- `sidecar/threads-store.js`: an idea ledger, not the session store. Reuse its durable
  storage helper pattern only, not its domain semantics.
- `sidecar/tools/builtin/orchestration.js`: preserve existing worker-prose forwarding
  behavior outside groups; group-visible replies get explicit group attribution.

Before coding, trace the current message → run → transcript → cost → render path,
including stop, per-agent concurrency, project access, approvals, and artifact access.
The earlier “shared stream means free shared memory” assertion is insufficient:
explicitly build and verify the context each participant receives.

### Authoritative state

Use one backend-owned group record keyed by the existing stream ID. Frontend session
metadata is a projection, not a competing membership or policy authority. Use the
existing durable-store helpers, authenticated routes, and event replay conventions.

Minimum concepts (final names follow repository conventions):

- Group: stream ID, member IDs, lead ID, instruction version, policy, revision.
- Message: stable ID, author kind/ID, recipient IDs, reply target, origin, sequence.
- Turn: ID, origin message ID, participant ID, parent turn, context cutoff/version,
  queue state, run ID, cancellation reason, outcome and measured usage references.
- Artifact reference: owning artifact ID, version/hash, producer run, display name,
  and authorized read route or checked copy reference.

Persist intent before dispatch, use idempotency keys on sends and handoffs, and recover
from events or state reads after reconnect. Deduplicate repeated completion events.
On restart, reconcile in-flight turns as interrupted unless existing run evidence
proves otherwise. Never silently replay a possibly completed external side effect.
Present interrupted work for explicit resume/retry; retain the pending queue.
Membership edits use revision checks so two open windows cannot overwrite each other.

Existing direct sessions migrate without changing history, task kind, model, board
placement, or artifact links. Groups may have one member and later grow. Archived or
deleted groups must not resurrect from late events; stop their group work on deletion.

### Context and authority

Construct each turn from pinned session instructions, relevant shared history,
referenced messages, and authorized artifact references. Preserve sender identities
and separate user instructions from peer requests, tool output, and quoted content.
Record the context cutoff and summary source span; never label a lossy summary “full history.”
New members receive session context, not other participants' private DM history or memories.

Peer handoffs use a structured host-validated action scoped to group membership and
the user's session request. The recipient keeps its own model, credentials, tool grants,
execution profile, and approval mode. Group membership does not mint Commander authority,
grant unrestricted peer filesystem access, or change standing Full Access semantics.

### Scheduling, limits, and costs

Dispatch sequentially within a group for the first release. Respect the existing
per-agent scheduler when an agent is already busy elsewhere; report waiting honestly.
Do not hold a group lock while awaiting a provider or user approval.

Allow A → B → A. Use an origin-scoped configurable turn limit and repeated-failure
detection, not a ban on revisiting agents. Proposed automatic handoff allowance: six
turns per user message; reaching it pauses automatic continuation with the pending
work visible and a Continue action. Direct user messages remain available.

Keep user work quotas off by default. Distinguish loop protection from financial caps.
Use existing provider/account spending policies, show measured usage, and never
present unavailable cost as $0. Any optional per-group spending cap is user-selected.
Reverify managed-wallet reservation rules on current trunk: sequential dispatch must
release/reconcile each reservation before the next. If parallel execution later needs
per-run reservations, expose the allocation instead of inventing a default dollar quota.
Account for delegated child runs and lead summaries without double-counting.

### Shared work products

Reuse the existing artifact/conveyor system after tracing its access model. Sharing
must resolve to an actual version the reviewer can read in its own execution context.
Do not pass a private absolute path and assume it works. Prefer immutable review
versions and explicit revisions; edits must not silently overwrite a peer's new version.
Retain normal host grants and artifact validation. Sharing a reference never expands
filesystem authority by itself. Show latest output with Open as the primary action.

## Implementation sequence

### Phase 0 — contracts and migration

Own one isolated implementation worktree. Confirm current source seams and define
the group state machine, context contract, authority provenance, and additive schemas.
Request shared-event changes from the contract owner only if existing events cannot
represent the required state. Do not edit the owned shared files independently.

Exit: reviewed API/state contracts, concrete migration fixtures, identified artifact
read path, and an implementation map without a duplicate session authority.

### Phase 1 — usable group DM

Implement durable membership, lead selection, session conversion, participant picker,
mentions, direct replies, attributed rendering, and explicit context assembly. Backend
queue owns dispatch from day one. Include basic stop and reconnect behavior here.

Exit, observed in a seeded app: create Overseer + Researcher + Engineer; unaddressed
message runs only the lead; @Researcher runs only Researcher; reply targets Engineer;
members can reference earlier shared context on their next turn; silent members make
no calls. Reload and restart preserve membership and history without duplicate runs.

### Phase 2 — real collaboration and shared files

Add structured peer handoffs, bounded revision cycles, artifact sharing/versioning,
session pins, member addition with catch-up, and complete removal semantics.

Exit: Engineer produces an artifact; QA reads that exact version, reports a real
defect, and sends it back; Engineer revises it; QA reads the revision. Each message and
artifact maps to its actual run. Add Researcher mid-session and prove relevant context
was supplied without starting an unsolicited run or exposing private conversations.

### Phase 3 — interruption and recovery hardening

Finish interrupt-and-send, pause/resume, obsolete queue invalidation, cancellation of
descendant work, approval waits, budget reconciliation, cross-session agent contention,
and recovery after sidecar termination. Keep uncertain side effects visible.

Exit: interrupt during tool work; new instructions govern the next dispatched turn;
obsolete queued work never starts; late completions remain historical and cannot
restart the chain. Stop/restart during a handoff and retry without duplicate dispatch.

Phases 1–3 together are the first complete group-chat release. Do not call the
Phase 1 shell the finished multi-agent workflow feature.

### Phase 4 — useful expansions

After the core is proven, add in this order:

1. Ask everyone independently: all participants use the same context cutoff and do
   not see each other's new answers until their own answer is complete. Sequential
   execution still works. An optional lead comparison cites the actual responses.
2. Save a group: reusable selected agent IDs and pins; fresh sessions get fresh history.
   Missing/deleted agents require an explicit replacement, never silent substitution.
3. Branch a discussion: copy an explicit context snapshot and authorized artifact
   references into a new session; no implicit shared queue or mutable history.
4. Optional compact catch-up: decisions and open work linked to source messages,
   user-editable and distinguished from verified task completion.

External channels, scheduled posts, physical props, and parallel dispatch are later
extensions with separate acceptance criteria. They do not block the group DM release.

## Verification and integration

Test behavior at the seams, not only parser output:

- Migration; duplicate names/renames; unknown and quoted mentions; reply precedence.
- Idempotent send/reconnect/retry; membership revision races; removed/deleted agents.
- Context attribution, catch-up cutoff, summary provenance, and private-history isolation.
- Peer text cannot mint direct-user privileges; ordinary @text cannot dispatch a run.
- A → B → A succeeds; runaway handoffs pause; accounting includes summaries and children.
- Stop/approval races; two groups sharing an agent; deletion and late events; restart.
- Reviewer reads exact artifact version; missing/denied artifacts fail visibly.
- Ordinary direct chats, work lines, task cards, and channel dispatch remain intact.

Use mock providers for deterministic loop/failure tests. Then prove a representative
real-provider collaboration with the configured test credentials; do not claim real
model usefulness from mock replies. Seed an isolated data root with `node dev/seed.js
--keep`; verify provider selection first and never reuse production data accidentally.

Run required focused checks, `npm run test:fast`, and `npm run test:http` for sidecar
changes. Sync the website mirror and perform required claims re-lock for frontend
changes. Follow the merge ritual: Codex branches merge trunk, never rebase; pathspec
commits with human-only authorship; explicit public-safe merge message and post-merge gate.
Prove the installed candidate before making installed-app claims. Public release is
a separate operation under the existing release gates.

Final live acceptance: create a chosen group, produce/review/revise a real deliverable,
add a participant, interrupt with a changed requirement, restart, resume, and open the
correct final artifact. Capture actual run IDs, observed state transitions, artifact
versions, accounting, and any limitations. No synthetic chatter or unverifiable success.

## Implementation status

The local group DM build is implemented in `agent/group-dm-plan-0904`.
See [the verification record](GROUP_DM_VERIFICATION_2026-09-04.md) for the real-provider
collaboration, exact artifact hashes, tested interactions, regression results, and
scope of the local preview. The preview runs at http://127.0.0.1:9137.
